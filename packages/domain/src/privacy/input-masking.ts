import { isAadhaarNumber } from './identity-numbers';
import { findPersonalNumbers, lastFourOnly, normalise, replaceNumbers } from './number-shapes';

// An Aadhaar number typed into a command's input (a note, a lead's notes, a reason, an address)
// keeps only its last four digits before the command sees it (SECURITY §5, DECISIONS 09-11-2026).
// The runner applies `maskInputIdentity()` to every command's parsed input, so the stored row, the
// audit trail, the outbox event and the idempotency record all hold the masked text.
//
// A number is read as the imports, the logs and the audit trail read it (`findPersonalNumbers`):
// twelve digits, the first 2 to 9, in any grouping, in any script's digits, with any separator
// people use or an invisible character between, touching letters or not; a number after a `+`
// that is a phone (an E.164 number, as every phone input is stored) is a phone and is kept. Then,
// unlike the import's cell masking, the twelve digits must carry a valid Verhoeff check digit, so
// a reference, a serial or a misread number that is not an Aadhaar number stays as it was typed.

/** A text with fewer digits than this holds no Aadhaar number; it is passed over unread. */
const AADHAAR_DIGITS = 12;

/** A decimal amount (`234567890124.00`): one run of digits, a point and one or two decimals. */
const DECIMAL_AMOUNT = /^\d+\.\d{1,2}$/;

/**
 * Whether a run the finder read as Aadhaar-shaped holds a valid Aadhaar number: some of its
 * consecutive digit groups, the first beginning 2 to 9, hold exactly twelve digits with a valid
 * check digit (the run may carry a group before or after it, a plot number or a phone, which the
 * mask then covers too). A decimal amount is never one.
 */
function holdsValidAadhaar(written: string): boolean {
  const read = normalise(written).text.trim();
  if (DECIMAL_AMOUNT.test(read)) return false;
  const groups = read.match(/\d+/g) ?? [];
  for (let i = 0; i < groups.length; i++) {
    if (!/^[2-9]/.test(groups[i] ?? '')) continue;
    let digits = '';
    for (let j = i; j < groups.length && digits.length < AADHAAR_DIGITS; j++) {
      digits += groups[j] ?? '';
    }
    if (digits.length === AADHAAR_DIGITS && isAadhaarNumber(digits)) return true;
  }
  return false;
}

/** `text` with every Aadhaar number in it masked to its last four digits, and how many were. */
export function maskTypedIdentity(text: string): { text: string; masked: number } {
  if ((text.match(/[\p{Nd}\p{No}]/gu)?.length ?? 0) < AADHAAR_DIGITS) return { text, masked: 0 };
  const found = findPersonalNumbers(text).filter(
    (n) => n.kind === 'aadhaar' && holdsValidAadhaar(text.slice(n.start, n.end)),
  );
  if (found.length === 0) return { text, masked: 0 };
  return {
    text: replaceNumbers(text, found, (_, written) => lastFourOnly(written)),
    masked: found.length,
  };
}

/** A plain object (a parsed input's), not a `Date`, a buffer or any other class's instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Whether `path` is an exempt path or lies under one. */
function exempt(path: string, unmasked: readonly string[]): boolean {
  return unmasked.some((field) => path === field || path.startsWith(`${field}.`));
}

/**
 * A command's parsed input with every Aadhaar number in its strings masked to its last four
 * digits, in objects and arrays at any depth, and how many numbers were masked. `unmasked` names
 * the fields left whole (`Command.unmaskedFields`): dot paths of object keys, arrays passed
 * through (`bankDetails.accountNumber`, `rows`), each covering everything under it. Numbers,
 * booleans, dates, null and every other value pass through untouched; an object or array in which
 * nothing changed is returned as it came. Masking twice changes nothing.
 */
export function maskInputIdentity<T>(
  input: T,
  unmasked: readonly string[] = [],
): { value: T; masked: number } {
  let masked = 0;
  const walk = (value: unknown, path: string): unknown => {
    if (path !== '' && exempt(path, unmasked)) return value;
    if (typeof value === 'string') {
      const result = maskTypedIdentity(value);
      masked += result.masked;
      return result.text;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item: unknown) => {
        const next = walk(item, path);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : value;
    }
    if (isPlainObject(value)) {
      let changed = false;
      // Built from entries, so a key named `__proto__` stays an own key, as the input had it.
      const out = Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const next = walk(item, path === '' ? key : `${path}.${key}`);
          if (next !== item) changed = true;
          return [key, next];
        }),
      );
      return changed ? out : value;
    }
    return value;
  };
  return { value: walk(input, '') as T, masked };
}
