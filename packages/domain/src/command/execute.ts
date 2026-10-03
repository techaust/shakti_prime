import { DomainError, newId, type Principal } from '@shakti/contracts';
import {
  readerConfigured,
  withRequestContext,
  type RequestContext,
  type RequestScope,
} from '@shakti/db';
import type { z } from 'zod';
import { redactForAudit } from '../audit/redact';
import { databaseAuditSink, type AuditRecord } from '../audit/sink';
import { databaseOutboxSink, type OutboxRecord, type OutboxSink } from '../outbox/sink';
import { jsonLogger, type Logger } from '../ports/logger';
import type { Command } from './define-command';
import { auditBase, auditedInput, failureOf, runCommand, type RunOptions } from './run-command';
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
 * (docs/design/backend-weeks-3-5.md §3.2). Input that does not parse is not recorded: nothing ran.
 *
 * The whole call, refusal row and outbox nudge included, is timed into one log line with the
 * command's name, outcome, duration and request id (`command.completed`).
 */
export async function executeCommand<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scope: RequestScope,
  command: Command<I, O>,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<z.output<O>> {
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
  const { logger = defaultLogger, onCommitted, ...runOptions } = options;
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
    input: refusedInput(command, ran, ran ? failure.input : rawInput),
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
 * The input a refusal row records. A command with an audit summary records only the summary;
 * raw input it never parsed is then left out rather than stored whole.
 */
function refusedInput<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  parsed: boolean,
  input: unknown,
): unknown {
  if (command.auditInput === undefined) return redactForAudit(input);
  if (parsed) return auditedInput(command, input as z.output<I>);
  const reparsed = command.input.safeParse(input);
  return reparsed.success ? auditedInput(command, reparsed.data) : null;
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
 * holds `select` only under the same policies (docs/DATABASE.md §3), so a write is refused for
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
