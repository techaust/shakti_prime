import { z } from 'zod';

/** Stored form of every phone number (docs/DATABASE.md §2). */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;
export const E164Schema = z.string().regex(E164_REGEX);
export type E164 = z.infer<typeof E164Schema>;

/**
 * Turns what a caller types into E.164 for an Indian number: strips spaces, dashes and
 * brackets, accepts a leading 0 or 91, and returns null when the digits do not form a
 * 10-digit Indian mobile or landline number or an already valid international number.
 */
export function normaliseIndianPhone(raw: string): E164 | null {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (E164_REGEX.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 10 && /^[1-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
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
