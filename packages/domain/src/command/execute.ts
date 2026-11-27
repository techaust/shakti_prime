import { DomainError, newId, type Principal } from '@shakti/contracts';
import {
  readerConfigured,
  withRequestContext,
  type RequestContext,
  type RequestScope,
} from '@shakti/db';
import type { z } from 'zod';
import { redactForAudit, withoutPersonalDetails } from '../audit/redact';
import { databaseAuditSink, type AuditRecord } from '../audit/sink';
import { readFront, writeFront } from '../idempotency/front';
import { inputHash } from '../idempotency/hash';
import { databaseOutboxSink, type OutboxRecord, type OutboxSink } from '../outbox/sink';
import type { KeyValue } from '../ports/key-value';
import { jsonLogger, type Logger } from '../ports/logger';
import { maskInputIdentity } from '../privacy/input-masking';
import type { Command } from './define-command';
import { isRegistered } from './registry';
import {
  auditBase,
  auditedInput,
  checkedInput,
  failureOf,
  runCommand,
  storedAnswer,
  type RunOptions,
} from './run-command';
import { monotonicClock, timed, type Clock, type TimingOptions } from './timing';

export interface ExecuteOptions extends Omit<RunOptions, 'context' | 'audit' | 'outbox'> {
  /** Where a failure to record a refusal is reported; it never replaces the refusal itself. */
  logger?: Logger;
  /**
   * Runs after the transaction commits when the command stored events; the web app nudges the
   * outbox publisher here. Its failure is logged and never fails the command, which committed.
   */
  onCommitted?: (events: readonly OutboxRecord[]) => Promise<void> | void;
  /** The clock the call's duration is measured with; tests pass a fake one. */
  clock?: Clock;
  /**
   * The key-value store in front of `idempotency_keys` for a call with a key (the field app's
   * mutations): a repeat of a committed call is answered from it without a transaction
   * (`idempotency/front.ts`). The table stays the authority.
   */
  idempotencyFront?: KeyValue;
}

export interface QueryOptions {
  /** The query's name in its log line; the function's own name when left out. */
  name?: string;
  /**
   * The pool the query reads on: `app_reader`'s when `DATABASE_URL_READER` is set, otherwise
   * `app_user`'s in a read-only transaction. Tests name one to compare the two.
   */
  pool?: 'reader' | 'app_user';
  logger?: Logger;
  clock?: Clock;
}

const defaultLogger = jsonLogger();

/**
 * Every call writes one timing line (BLUEPRINT §6.4, p95 < 300 ms). A test run makes thousands of
 * calls, so the default logger keeps only the slow ones there; a logger passed in gets every line.
 */
function timingOptions(logger: Logger | undefined, clock: Clock | undefined): TimingOptions {
  return {
    logger: logger ?? defaultLogger,
    clock: clock ?? monotonicClock,
    quiet: logger === undefined && process.env.NODE_ENV === 'test',
  };
}

/**
 * The one way the web app changes data (AUDIT M12): a request context for the caller, then the
 * command runner with its guard, strict DTO, audit and outbox hooks. `apps/web` cannot import
 * `withRequestContext` or the schema, so a write that skips the runner does not pass lint.
 *
 * A refused or failed call rolls its transaction back, audit row included, so the row that
 * records the refusal is written afterwards in a short transaction of its own
 * (docs/03-roadmap-appendix/backend-weeks-3-5.md §3.2). Input that does not parse is not recorded: nothing ran.
 *
 * The whole call, refusal row and outbox nudge included, is timed into one log line with the
 * command's name, outcome, duration and request id (`command.completed`).
 *
 * Only a command of the registry runs (audit ARCH-1): one defined anywhere else would escape the
 * agent refusal sweep, the audit label check and the registry test, so it is refused before any
 * connection is opened, as a fault in the code, not the caller's.
 */
export async function executeCommand<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scope: RequestScope,
  command: Command<I, O>,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<z.output<O>> {
  if (!isRegistered(command)) {
    throw new DomainError('internal', `${command.name} is not a command of the registry`, {
      command: command.name,
    });
  }
  const { clock, ...rest } = options;
  const requestId = scope.requestId ?? newId();
  return timed('command', command.name, requestId, timingOptions(options.logger, clock), () =>
    runInContext(principal, { ...scope, requestId }, command, input, rest),
  );
}

async function runInContext<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scoped: RequestScope,
  command: Command<I, O>,
  input: unknown,
  options: Omit<ExecuteOptions, 'clock'>,
): Promise<z.output<O>> {
  const { logger = defaultLogger, onCommitted, idempotencyFront, ...runOptions } = options;
  const key = runOptions.idempotencyKey;
  const front =
    idempotencyFront !== undefined && key !== undefined
      ? fronted(command, principal, input)
      : undefined;
  if (front !== undefined && idempotencyFront !== undefined && key !== undefined) {
    const kept = await readFront(idempotencyFront, principal.id, key, logger);
    // Only an exact repeat is answered here, as the runner would answer it from the table; a
    // refusal of the stored answer is left to the runner, which records it.
    if (kept?.command === command.name && kept.inputHash === front.hash) {
      try {
        return storedAnswer(
          command,
          scoped.entityIds ?? principal.entityIds,
          kept.response,
          front.data,
        );
      } catch {
        // falls through to the table
      }
    }
  }
  const stored: OutboxRecord[] = [];
  const outbox: OutboxSink = {
    async write(tx, records) {
      await databaseOutboxSink.write(tx, records);
      stored.push(...records);
    },
  };
  let result: z.output<O>;
  try {
    result = await withRequestContext(principal, scoped, (context) =>
      runCommand(command, { ...runOptions, audit: databaseAuditSink, outbox, context }, input),
    );
  } catch (error) {
    await recordRefusal(principal, scoped, command, input, error, runOptions, logger);
    throw error;
  }
  if (front !== undefined && idempotencyFront !== undefined && key !== undefined) {
    await writeFront(
      idempotencyFront,
      principal.id,
      key,
      { command: command.name, inputHash: front.hash, response: result },
      logger,
    );
  }
  if (onCommitted !== undefined && stored.length > 0) {
    try {
      await onCommitted(stored);
    } catch (hookError) {
      logger.log('warn', 'outbox.nudge_failed', {
        command: command.name,
        requestId: scoped.requestId,
        error: hookError,
      });
    }
  }
  return result;
}

/**
 * The checked input and its hash, as the runner computes them, for the idempotency front; undefined
 * when the call does not pass the runner's first steps, which then refuse and record it.
 */
function fronted<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  principal: Principal,
  input: unknown,
): { data: z.output<I>; hash: string } | undefined {
  try {
    const data = checkedInput(command, principal, input);
    return { data, hash: inputHash(command.name, data) };
  } catch {
    return undefined;
  }
}

async function recordRefusal<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scope: RequestScope,
  command: Command<I, O>,
  rawInput: unknown,
  error: unknown,
  options: Omit<RunOptions, 'context' | 'audit' | 'outbox'>,
  logger: Logger,
): Promise<void> {
  const failure = failureOf(error);
  if (failure?.stage === 'input') return;
  const code = error instanceof DomainError ? error.code : 'internal';
  const requestId = scope.requestId ?? newId();
  // Without a stage the runner never started: the request scope was refused, or the commit
  // failed. The row is then written in the caller's own scope and belongs to no entity.
  const requested = scope.entityIds ?? principal.entityIds;
  const ran = failure !== undefined;
  const record: AuditRecord = {
    ...auditBase(principal, command.name, requestId, options.client),
    outcome: code === 'forbidden' ? 'denied' : 'failed',
    entityId: ran && requested.length === 1 ? (requested[0] ?? null) : null,
    aggregateType: null,
    aggregateId: null,
    errorCode: code,
    input: withoutPersonalDetails(refusedInput(command, ran, ran ? failure.input : rawInput)),
    before: null,
    after: null,
  };
  try {
    await withRequestContext(
      principal,
      ran ? scope : { requestId, entityIds: principal.entityIds },
      ({ tx }) => databaseAuditSink.write(tx, [record]),
    );
  } catch (writeError) {
    logger.log('error', 'audit.write_failed', {
      command: command.name,
      requestId,
      outcome: record.outcome,
      error: writeError,
    });
  }
}

/**
 * The input a refusal row records, before its personal fields are removed
 * (`withoutPersonalDetails`). A command with an audit summary records only the summary; raw input
 * it never parsed is then left out rather than stored whole.
 */
function refusedInput<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  parsed: boolean,
  input: unknown,
): unknown {
  // The runner masked what it parsed; input it never reached is masked here alike
  // (docs/07-security.md §5).
  const masked = (value: unknown) =>
    parsed ? value : maskInputIdentity(value, command.unmaskedFields).value;
  if (command.auditInput === undefined) return redactForAudit(masked(input));
  if (parsed) return auditedInput(command, input as z.output<I>);
  const reparsed = command.input.safeParse(input);
  return reparsed.success ? auditedInput(command, masked(reparsed.data) as z.output<I>) : null;
}

/**
 * The one way the web app reads data: a query from this package inside the caller's context,
 * timed into one log line (`query.completed`) like a command.
 *
 * The request context is read-only (`readOnly`) before the query's first statement. The function
 * is handed the transaction, and a write made through it would skip the guard, the audit trail and
 * the outbox, so Postgres refuses any insert, update, delete or sequence step there (SQLSTATE
 * 25006). A function that ends the transaction itself (`commit`) loses the RLS settings with it,
 * so a write after that is refused by row security instead (SQLSTATE 42501).
 *
 * Where `DATABASE_URL_READER` is set the query runs on the `app_reader` pool instead, whose role
 * holds `select` only under the same policies (docs/05-database.md §3), so a write is refused for
 * want of the privilege too, whatever the function does with its transaction.
 */
export function executeQuery<T>(
  principal: Principal,
  scope: RequestScope,
  query: (context: RequestContext) => Promise<T>,
  options: QueryOptions = {},
): Promise<T> {
  const requestId = scope.requestId ?? newId();
  return timed(
    'query',
    options.name ?? (query.name === '' ? 'anonymous' : query.name),
    requestId,
    timingOptions(options.logger, options.clock),
    () =>
      withRequestContext(principal, { ...scope, requestId }, query, {
        readOnly: true,
        reader: (options.pool ?? (readerConfigured() ? 'reader' : 'app_user')) === 'reader',
      }),
  );
}
