import { randomInt } from 'node:crypto';

/** Lower-case letters and digits that cannot be misread for one another (no 0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 10;
const COUNT = 10;

/**
 * The backup codes given at enrolment (AUDIT M51): ten codes of ten characters, shown as
 * `xxxxx-xxxxx`, easy to copy by hand and to read out.
 */
export function generateBackupCodes(): string[] {
  return Array.from({ length: COUNT }, () => {
    let code = '';
    for (let i = 0; i < LENGTH; i += 1) code += ALPHABET.charAt(randomInt(ALPHABET.length));
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/**
 * What someone types, brought to the form the codes are stored in: a phone's capital first
 * letter, spaces or a missing dash do not cost one of their attempts.
 */
export function normaliseBackupCode(raw: string): string {
  const compact = raw.toLowerCase().replaceAll(/[\s-]/g, '');
  return compact.length === LENGTH ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
}
