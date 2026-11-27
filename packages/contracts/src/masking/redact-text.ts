import { findPersonalNumbers, replaceNumbers } from './number-shapes';

// The text scrub of the logs and the audit trail (`@shakti/domain/redaction` keeps the field rules
// around it), here because `maskForModel()` ends with it and the voice worker masks with that
// (SECURITY §3.4). No Node API: the edge runtime and the browser's error reporting use it too.

/** The last four digits of a phone number, the rest starred. */
const lastFour = (digits: string): string => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;

/**
 * Link, token and personal-address shapes that may appear inside free text. Personal numbers are
 * found after them, by the finder `maskForModel()` uses too (`findPersonalNumbers`).
 */
const SECRET_TEXT: readonly ((text: string) => string)[] = [
  (t) => t.replace(/reset-password[:/][\w-]+/g, 'reset-password:[redacted]'),
  (t) => t.replace(/\bparams:[\s\S]*$/, 'params: [redacted]'),
  (t) => t.replace(/(token|secret|password)=[^\s&'"]+/gi, '$1=[redacted]'),
  // The field app's bearer and any signed token written out whole (F1): a JWT is three base64url
  // parts, the first starting `eyJ` (a JSON header).
  (t) => t.replace(/\bBearer\s+[\w.~+/=-]+/g, 'Bearer [redacted]'),
  (t) => t.replace(/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, '[token]'),
  // Starting only where a word starts: the same matches, but a long word is read once, not once
  // from each of its letters.
  (t) => t.replace(/(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'),
  // A UPI address (`rekha@oksbi`, `9876543210@ybl`) has no dot after the @, so the email rule
  // above misses it, and it often carries the payer's name or number.
  (t) => t.replace(/(?<![\w.+-])[\w.-]{2,256}@[a-z]{2,64}(?![\w.@-])/gi, '[upi]'),
];

/**
 * `text` as the logs and the audit trail keep it: links, tokens, passwords, email and UPI
 * addresses replaced; a run of digits that holds an Aadhaar-shaped number (twelve digits, the
 * first 2 to 9, in any grouping) replaced whole by `[number]`; a mobile or landline number
 * (`isPhone`), or a phone number after a `+` (`plusPhone`), kept only by its last four digits
 * (with its `+` when written without spaces). Numbers are read as `maskForModel()` reads them
 * (`findPersonalNumbers`, the same runs): in any script's digits, joined by any separator people
 * use, with invisible characters dropped, touching letters or not; UUIDs, dates, times, amounts,
 * quantities, product codes and document numbers standing alone are left as they are, and so is
 * any number of another length (an order number, a time in milliseconds).
 */
export function redactText(text: string): string {
  let out = text;
  for (const scrub of SECRET_TEXT) out = scrub(out);
  return replaceNumbers(out, findPersonalNumbers(out), (n, written) => {
    // Twelve digits written as 91 and a mobile number in groups read as the phone they look like.
    if (n.kind === 'aadhaar' && !(n.alsoPhone && n.grouped)) return '[number]';
    // A number written `+` and its digits alone keeps its `+`, as the logs have always shown it.
    return `${/^\+\p{Nd}+$/u.test(written) ? '+' : ''}${lastFour(n.digits)}`;
  });
}
