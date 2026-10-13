import { jsonLogger, type Logger } from '@shakti/domain';
import { randomInt } from 'node:crypto';
import { reportErrorLine } from './observability/error-reports';
import { sentryDsnSet } from './observability/sentry-on';
import { REFERENCE_ALPHABET, REFERENCE_LENGTH } from './reference';

const lines = jsonLogger();

/**
 * The application's logger: JSON lines, redacted before they are written (AUDIT M10, M35). With
 * `SENTRY_DSN` set, every `error` line also goes to Sentry (`reportErrorLine`), so a failure the
 * code handled (a server action's `internal`, a scheduled job's 500) reaches the owner rather
 * than only a log nobody reads (audit 2026-10, OPS-3).
 */
export const logger: Logger = {
  log(level, event, fields = {}) {
    lines.log(level, event, fields);
    if (level === 'error' && sentryDsnSet()) reportErrorLine(event, fields);
  },
};

/**
 * A fresh reference a person reads to support after an unexpected failure that the screen
 * handles itself (docs/08-design-system.md §11), for example `8F3K2Q`. Logged with the failure.
 */
export function newReference(): string {
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    out += REFERENCE_ALPHABET.charAt(randomInt(REFERENCE_ALPHABET.length));
  }
  return out;
}

/** Logs an unexpected failure and answers the reference to show the person. */
export function reportUnexpected(
  event: string,
  error: unknown,
  fields: Readonly<Record<string, unknown>> = {},
): string {
  const reference = newReference();
  logger.log('error', event, { reference, ...fields, error });
  return reference;
}
