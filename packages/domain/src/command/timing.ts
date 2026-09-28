import { DomainError } from '@shakti/contracts';
import type { Logger } from '../ports/logger';

/**
 * BLUEPRINT §6.4 sets the p95 of an interaction under 300 ms. A command or query slower than
 * this logs at `warn`, so the slow calls can be found in the logs without a tracing service.
 */
export const SLOW_CALL_MS = 300;

export type CallKind = 'command' | 'query';

/** `denied` when the caller lacked the permission, `failed` for any other error. */
export type CallOutcome = 'ok' | 'denied' | 'failed';

/** A monotonic clock in milliseconds; tests pass a fake one. */
export type Clock = () => number;

export const monotonicClock: Clock = () => performance.now();

export interface TimingOptions {
  logger: Logger;
  clock: Clock;
  /** Drop the `info` lines and keep the slow ones (the default logger under a test run). */
  quiet?: boolean;
}

/**
 * Runs `fn` and writes one line for it: `command.completed` or `query.completed` with the name,
 * the outcome, the error code when it failed, the duration and the request id. Nothing from the
 * input or the answer is logged. A logger that throws never changes the call's own result.
 */
export async function timed<T>(
  kind: CallKind,
  name: string,
  requestId: string,
  options: TimingOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const start = options.clock();
  let outcome: CallOutcome = 'ok';
  let errorCode: string | undefined;
  try {
    return await fn();
  } catch (error) {
    errorCode = error instanceof DomainError ? error.code : 'internal';
    outcome = errorCode === 'forbidden' ? 'denied' : 'failed';
    throw error;
  } finally {
    const durationMs = Math.round((options.clock() - start) * 10) / 10;
    const level = durationMs > SLOW_CALL_MS ? 'warn' : 'info';
    if (level === 'warn' || options.quiet !== true) {
      try {
        options.logger.log(level, `${kind}.completed`, {
          // `name`, not `query`: the logger drops a `query` field as a possible SQL text.
          name,
          outcome,
          ...(errorCode === undefined ? {} : { errorCode }),
          durationMs,
          requestId,
        });
      } catch {
        // A log line is never worth failing a call that has already finished.
      }
    }
  }
}
