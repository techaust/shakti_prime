import { jsonLogger, type Logger } from '@shakti/domain';
import { randomInt } from 'node:crypto';
import { REFERENCE_ALPHABET, REFERENCE_LENGTH } from './reference';

/** The application's logger: JSON lines, redacted before they are written (AUDIT M10, M35). */
export const logger: Logger = jsonLogger();

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
