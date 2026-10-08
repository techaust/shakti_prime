import { z } from 'zod';

/** Stored form of every phone number (docs/05-database.md §2). */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;
export const E164Schema = z.string().regex(E164_REGEX);
export type E164 = z.infer<typeof E164Schema>;

/** A 10-digit Indian number after an optional trunk 0, first digit 1 to 9. */
function indianNational(national: string): E164 | null {
  const digits = national.startsWith('0') ? national.slice(1) : national;
  return /^[1-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/**
 * Turns what a caller types into E.164 (AUDIT M23). Strips spaces, dashes, dots and brackets and
 * reads a leading `00` as `+`. A number for India (`+91`, `91`, or no country code) must come to
 * exactly 10 digits after an optional trunk 0, so one line is always stored one way; a number
 * with another country code must be valid E.164. Anything else answers null.
 */
export function normaliseIndianPhone(raw: string): E164 | null {
  let cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    if (digits.startsWith('91')) return indianNational(digits.slice(2));
    return E164_REGEX.test(cleaned) ? cleaned : null;
  }
  if (!/^\d+$/.test(cleaned)) return null;
  if (cleaned.length === 12 && cleaned.startsWith('91')) return indianNational(cleaned.slice(2));
  return indianNational(cleaned);
}

/** Input schema that accepts what people type and outputs E.164. */
export const PhoneInputSchema = z
  .string()
  .trim()
  .min(6)
  .max(20)
  .transform((value, ctx) => {
    const e164 = normaliseIndianPhone(value);
    if (e164 === null) {
      ctx.addIssue({ code: 'custom', message: 'phone is not a valid number' });
      return z.NEVER;
    }
    return e164;
  });
