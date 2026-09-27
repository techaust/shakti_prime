import type { Principal } from '@shakti/contracts';
import { withRequestContext, type RequestContext, type RequestScope } from '@shakti/db';
import type { z } from 'zod';
import type { Command } from './define-command';
import { runCommand, type RunOptions } from './run-command';

/**
 * The one way the web app changes data (AUDIT M12): a request context for the caller, then the
 * command runner with its guard, strict DTO, audit and outbox hooks. `apps/web` cannot import
 * `withRequestContext` or the schema, so a write that skips the runner does not pass lint.
 */
export function executeCommand<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  scope: RequestScope,
  command: Command<I, O>,
  input: unknown,
  options: Omit<RunOptions, 'context'> = {},
): Promise<z.output<O>> {
  return withRequestContext(principal, scope, (context) =>
    runCommand(command, { ...options, context }, input),
  );
}

/** The one way the web app reads data: a query from this package inside the caller's context. */
export function executeQuery<T>(
  principal: Principal,
  scope: RequestScope,
  query: (context: RequestContext) => Promise<T>,
): Promise<T> {
  return withRequestContext(principal, scope, query);
}
