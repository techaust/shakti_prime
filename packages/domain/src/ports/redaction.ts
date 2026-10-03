/**
 * The redaction every log line, audit row and Sentry event passes through (AUDIT M10,
 * docs/design/phase1.md §5.2): secret-named keys dropped, identity numbers hidden, and text
 * scrubbed of links, tokens, emails, UPI addresses, phones and Aadhaar-like numbers. No Node API,
 * so the edge runtime and the browser's error reporting use it too (`@shakti/domain/redaction`).
 */

/** What a failed query or an auth error carries that must never reach a log line. */
const SECRET_KEYS = new Set([
  'params',
  'parameters',
  'args',
  'query',
  'token',
  'password',
  'secret',
  'cookie',
  'authorization',
  'identifier',
  'backupCodes',
]);

/**
 * Identity-number fields, compared without case or separators, that never reach a log line or the
 * audit trail (AGENTS.md §9): Aadhaar, PAN, bank account and IFSC, under the spellings and short
 * forms people give them.
 */
export const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'aadhaar',
  'aadhar',
  'aadhaarnumber',
  'aadharnumber',
  'aadhaarno',
  'aadharno',
  'uid',
  'pan',
  'pannumber',
  'panno',
  'accountnumber',
  'accountno',
  'bankaccountnumber',
  'bankaccountno',
  'ifsc',
  'ifsccode',
]);

/** A field name without case or separators, as the key lists compare it. */
export const normaliseKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.has(key) || IDENTITY_KEYS.has(normaliseKey(key));

/**
 * Fields, compared without case or separators, whose value is an identifier or a business code
 * rather than text a person typed. The logs and the audit trail keep such a value whole only
 * when it also looks like a code (`keepsAsCode`): one short word of letters, digits and
 * `. / _ -`, and no Aadhaar-like or phone-like run, which is scrubbed as in any other field.
 * The document numbers are named one by one.
 */
export const CODE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'ids',
  'code',
  'codes',
  'sku',
  'hsn',
  'hsncode',
  'sac',
  'gstin',
  'pin',
  'pincode',
  'barcode',
  'ewaybillno',
  'ewaybillnumber',
  'serialno',
  'buyerorderno',
  'documentno',
  'invoiceno',
  'quoteno',
  'orderno',
  'voucherno',
  'pono',
  'challanno',
  'receiptno',
]);

/** Any other field named as an id or a code, as written: `leadId`, `entity_ids`, `stageCode`. */
const CODE_KEY_PATTERN = /(?:Id|Ids|Code)$|_(?:id|ids|code)$/;

/**
 * Words in a field name that mark a personal value, which is never passed through as a code
 * however the field ends (`phoneId`, `aadhaarId`, `upiId`).
 */
const PERSONAL_KEY_PATTERN = /phone|mobile|whatsapp|e164|email|aadha?ar|passport|voter|ifsc/;

/** Short words that mark a personal value only as a whole part of a name (`upiId`, `upi_ref`). */
const PERSONAL_KEY_PARTS: ReadonlySet<string> = new Set(['upi']);

/** The parts of a field name, split at capitals and separators, in lower case. */
function keyParts(key: string): string[] {
  return key
    .split(/[_\-\s]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase());
}

/** Whether a field's name marks a personal value (`phoneId`, `aadhaarId`, `upiId`, not `groupId`). */
function isPersonalKey(key: string): boolean {
  return (
    PERSONAL_KEY_PATTERN.test(normaliseKey(key)) ||
    keyParts(key).some((part) => PERSONAL_KEY_PARTS.has(part))
  );
}

/**
 * Document numbers, which may be long numbers of their own (an order or voucher number given as a
 * number): kept when they look like a code. Any other id or code field hides a number of ten
 * digits or more, as a text field does.
 */
const NUMERIC_CODE_KEYS: ReadonlySet<string> = new Set([
  'documentno',
  'invoiceno',
  'quoteno',
  'orderno',
  'voucherno',
  'pono',
  'challanno',
  'receiptno',
  'serialno',
  'buyerorderno',
]);

/** Fields named like a code that hold free text all the same, such as a lead source's name. */
const TEXT_KEYS: ReadonlySet<string> = new Set(['sourcecode']);

/** Whether a field holds an identifier or a business code (CODE_KEYS). */
export function isCodeKey(key: string): boolean {
  const k = normaliseKey(key);
  if (IDENTITY_KEYS.has(k) || TEXT_KEYS.has(k) || isPersonalKey(key)) return false;
  return CODE_KEYS.has(k) || CODE_KEY_PATTERN.test(key);
}

/** Fields that hold a time or an amount (`createdAt`, `exp`, `amountPaise`, `lineTotal`). */
const MEASURE_KEY_PATTERN = /(?:At|Paise|Amount|Total)$|_(?:at|paise|amount|total)$/;
const MEASURE_KEYS: ReadonlySet<string> = new Set([
  'exp',
  'iat',
  'expires',
  'paise',
  'amount',
  'total',
]);

/** Whether a field holds a time or an amount, whose long numbers are no one's phone. */
export function isMeasureKey(key: string): boolean {
  return MEASURE_KEYS.has(normaliseKey(key)) || MEASURE_KEY_PATTERN.test(key);
}

/**
 * A number of ten digits or more: typed where a number goes, it may be a phone or an Aadhaar
 * number, so it is hidden whole unless its field holds a time or an amount.
 */
export function isLongNumber(value: number | bigint): boolean {
  return typeof value === 'bigint'
    ? value >= 1_000_000_000n || value <= -1_000_000_000n
    : Math.abs(value) >= 1_000_000_000;
}

/** What a field's value is taken for: typed text, an id or code, or a time or an amount. */
export type FieldKind = 'text' | 'code' | 'documentNo' | 'measure';

export function fieldKind(key: string): FieldKind {
  if (isCodeKey(key)) return NUMERIC_CODE_KEYS.has(normaliseKey(key)) ? 'documentNo' : 'code';
  return isMeasureKey(key) ? 'measure' : 'text';
}

/** One short word of letters, digits and `. / _ -`, as ids and codes are written. */
const CODE_SHAPE = /^[\w./-]{1,64}$/;

/**
 * Whether a value in an id or code field is kept whole: it has a code's shape and holds nothing
 * the text scrub would change (an Aadhaar-like or phone-like run, an email address).
 */
export function keepsAsCode(value: string): boolean {
  return CODE_SHAPE.test(value) && redactText(value) === value;
}

/** A string or number as the logs and the audit trail store it, by the kind of its field. */
export function scrubValue(
  value: string | number | bigint,
  kind: FieldKind,
): string | number | bigint {
  const code = kind === 'code' || kind === 'documentNo';
  if (typeof value === 'string') return code && keepsAsCode(value) ? value : redactText(value);
  if (kind === 'measure') return value;
  // A long number is hidden in any field but a document number, which is kept if it looks like one.
  if (kind !== 'documentNo' && isLongNumber(value)) return '[number]';
  if (code) return keepsAsCode(String(value)) ? value : '[number]';
  return value;
}

/** The last four digits of a phone number, the rest starred. */
const lastFour = (digits: string): string => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;

/**
 * Link, token and personal-number shapes that may appear inside free text. A phone number keeps
 * its last four digits; twelve digits, as Aadhaar numbers are printed, are replaced in full. The
 * number shapes must stand alone, so the digit runs inside ids are left intact: a UUID's last
 * group, whatever its digits, is passed over after the four groups before it, and nothing else
 * (`Rekha-9876543210` is still a phone).
 * International numbers go first, so `+91` and ten digits is not read as twelve digits. A mobile
 * number is also found as people write it: spaced after five digits, and after a 0, 91 or +91
 * (`98765 43210`, `098765 43210`, `91 98765 43210`, `+91-98765-43210`).
 */
/** The four groups of a UUID before its last one, which may be all digits. */
const UUID_HEAD = '[\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-';

const SECRET_TEXT: readonly ((text: string) => string)[] = [
  (t) => t.replace(/reset-password[:/][\w-]+/g, 'reset-password:[redacted]'),
  (t) => t.replace(/\bparams:[\s\S]*$/, 'params: [redacted]'),
  (t) => t.replace(/(token|secret|password)=[^\s&'"]+/gi, '$1=[redacted]'),
  (t) => t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'),
  // A UPI address (`rekha@oksbi`, `9876543210@ybl`) has no dot after the @, so the email rule
  // above misses it, and it often carries the payer's name or number.
  (t) => t.replace(/(?<![\w.+-])[\w.-]{2,256}@[a-z]{2,64}(?![\w.@-])/gi, '[upi]'),
  (t) => t.replace(/(?<![\w+])\+\d{8,15}(?!\w)/g, (m) => `+${lastFour(m.slice(1))}`),
  (t) =>
    t.replace(
      new RegExp(`(?<!\\w|${UUID_HEAD})\\d{4}[ -]?\\d{4}[ -]?\\d{4}(?!\\w|-[\\da-f])`, 'gi'),
      '[number]',
    ),
  (t) =>
    t.replace(
      new RegExp(`(?<![\\w+]|${UUID_HEAD})(?:\\+?91[ -]?|0)?[6-9]\\d{4}[ -]?\\d{5}(?!\\w)`, 'gi'),
      (m) => lastFour(m.replace(/\D/g, '')),
    ),
];

export function redactText(text: string): string {
  let out = text;
  for (const scrub of SECRET_TEXT) out = scrub(out);
  return out;
}

/**
 * A plain, redacted copy of any value: secret-named keys dropped, and every string and number
 * stored by the kind of its field (`scrubValue`): an id or code kept whole when it looks like one,
 * a time or an amount kept, and anything else scrubbed as text, a number of ten digits or more
 * hidden.
 */
export function redact(value: unknown, depth = 0, kind: FieldKind = 'text'): unknown {
  if (depth > 4) return '[deep]';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return scrubValue(value, kind);
  }
  if (value instanceof Error) return redactError(value, depth);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1, kind));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? '[redacted]' : redact(v, depth + 1, fieldKind(key));
    }
    return out;
  }
  return value;
}

/** The parts of an error worth logging: name, scrubbed message, codes and the cause chain. */
export function redactError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: redact(error, depth + 1) };
  const out: Record<string, unknown> = { name: error.name, message: redactText(error.message) };
  const e = error as Error & Record<string, unknown>;
  for (const key of ['code', 'status', 'statusCode', 'constraint_name', 'digest'] as const) {
    if (typeof e[key] === 'string' || typeof e[key] === 'number') out[key] = e[key];
  }
  if ('details' in e && e.details !== undefined) out.details = redact(e.details, depth + 1);
  if (e.cause !== undefined && depth < 4) out.cause = redactError(e.cause, depth + 1);
  return out;
}
