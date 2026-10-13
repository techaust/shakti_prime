import { redact, redactError } from '@shakti/domain/redaction';
import { after } from 'next/server';
import { ALERT_NAMES, SENTRY_FLUSH_MS } from './sentry-on';

/**
 * Error lines Sentry already receives another way, so they are not sent twice: the alerts
 * (`sentryAlertSink`) and the errors no request handled (`onRequestError`).
 */
const REPORTED_ELSEWHERE: ReadonlySet<string> = new Set<string>([
  ...ALERT_NAMES,
  'request.failed',
]);

/** Sends still on their way, so a caller outside a request can wait for them. */
const pending = new Set<Promise<void>>();

/**
 * The error a line names, rebuilt from its redacted form: the same name and the scrubbed message,
 * with the original stack frames (code locations only; the first line, which repeats the message,
 * is replaced), so Sentry groups and shows it like the error itself without its text.
 */
function errorOf(event: string, raw: unknown): Error {
  if (!(raw instanceof Error)) return Object.assign(new Error(event), { name: 'LoggedError' });
  const safe = redactError(raw);
  const message = typeof safe.message === 'string' ? safe.message : event;
  const error = new Error(message);
  error.name = raw.name;
  const frames = (raw.stack ?? '').split('\n').slice(1).join('\n');
  error.stack = frames === '' ? `${raw.name}: ${message}` : `${raw.name}: ${message}\n${frames}`;
  return error;
}

/**
 * Sends one `error` line to Sentry (audit 2026-10, OPS-3): its error with `captureException`, or the
 * event's name when it has none, grouped by the event's name, with the line's other fields as they
 * were logged (already redacted, and scrubbed again by `beforeSend`). In a request the send is
 * kept alive past the answer with `after()`, so the function is not frozen with it still queued;
 * outside one, `flushErrorReports()` waits for it.
 */
export function reportErrorLine(event: string, fields: Readonly<Record<string, unknown>>): void {
  if (REPORTED_ELSEWHERE.has(event)) return;
  const { error, ...rest } = fields;
  const extra = redact(rest) as Record<string, unknown>;
  const requestId = typeof extra.requestId === 'string' ? extra.requestId : undefined;
  const send = (async () => {
    try {
      const sentry = await import('@sentry/nextjs');
      sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setFingerprint([event]);
        scope.setTag('event', event);
        if (requestId !== undefined) scope.setTag('requestId', requestId);
        scope.setExtras(extra);
        sentry.captureException(errorOf(event, error));
      });
      await sentry.flush(SENTRY_FLUSH_MS);
    } catch {
      // Reporting is best effort: the line is in the log already.
    }
  })();
  pending.add(send);
  void send.finally(() => pending.delete(send));
  try {
    after(() => send);
  } catch {
    // Outside a request (a script, a test): the process outlives the send, or the caller flushes.
  }
}

/** Waits for every error line still being sent; for code that runs outside a request. */
export async function flushErrorReports(): Promise<void> {
  await Promise.allSettled([...pending]);
}
