import { DomainError, newId, type Principal } from '@shakti/contracts';
import { withRequestContext, type RequestContext, type RequestScope } from '@shakti/db';
import type { z } from 'zod';
import { redactForAudit } from '../audit/redact';
import { databaseAuditSink, type AuditRecord } from '../audit/sink';
import { jsonLogger, type Logger } from '../ports/logger';
import type { Command } from './define-command';
import { auditBase, failureOf, runCommand, type RunOptions } from './run-command';

export interface ExecuteOptions extends Omit<RunOptions, 'context' | 'audit'> {
  /** Where a failure to record a refusal is reported; it never replaces the refusal itself. */
  logger?: Logger;
}

const defaultLogger = jsonLogger();

/**
 * The one way the web app changes data (AUDIT M12): a request context for the caller, then the
 * command runner with its guard, strict DTO, audit and outbox hooks. `apps/web` cannot import
 * `withRequestContext` or the schema, so a write that skips the runner does not pass lint.
 *
 * A refused or failed call rolls its transaction back, audit row included, so the row that
 * records the refusal is written afterwards in a short transaction of its own
 * (docs/design/backend-weeks-3-5.md §3.2). Input that does not parse is not recorded: nothing ran.
 */
export async function executeCommand<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scope: RequestScope,
  command: Command<I, O>,
  input: unknown,
  options: ExecuteOptions = {},
): Promise<z.output<O>> {
  const { logger = defaultLogger, ...runOptions } = options;
  const scoped: RequestScope = { ...scope, requestId: scope.requestId ?? newId() };
  try {
    return await withRequestContext(principal, scoped, (context) =>
      runCommand(command, { ...runOptions, audit: databaseAuditSink, context }, input),
    );
  } catch (error) {
    await recordRefusal(principal, scoped, command.name, input, error, runOptions, logger);
    throw error;
  }
}

async function recordRefusal(
  principal: Principal,
  scope: RequestScope,
  commandName: string,
  rawInput: unknown,
  error: unknown,
  options: Omit<RunOptions, 'context' | 'audit'>,
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
    ...auditBase(principal, commandName, requestId, options.client),
    outcome: code === 'forbidden' ? 'denied' : 'failed',
    entityId: ran && requested.length === 1 ? (requested[0] ?? null) : null,
    aggregateType: null,
    aggregateId: null,
    errorCode: code,
    input: redactForAudit(ran ? failure.input : rawInput),
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
      command: commandName,
      requestId,
      outcome: record.outcome,
      error: writeError,
    });
  }
}

/** The one way the web app reads data: a query from this package inside the caller's context. */
export function executeQuery<T>(
  principal: Principal,
  scope: RequestScope,
  query: (context: RequestContext) => Promise<T>,
): Promise<T> {
  return withRequestContext(principal, scope, query);
}
