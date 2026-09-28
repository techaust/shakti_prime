/**
 * Structured logging (AUDIT M35): one JSON line per event with a level, an event name and the
 * request id, so an incident leaves something to diagnose. Everything logged passes through the
 * redaction below first (AUDIT M10): a set-password link, a session token or the bound values of a
 * failed query are ways into an account for anyone who can read the logs.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

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

const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.has(key) || IDENTITY_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));

/** The last four digits of a phone number, the rest starred. */
const lastFour = (digits: string): string => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;

/**
 * Link, token and personal-number shapes that may appear inside free text. A phone number keeps
 * its last four digits; twelve digits, as Aadhaar numbers are printed, are replaced in full. The
 * number shapes must stand alone, so the digit runs inside ids (a UUID's groups) are left intact.
 * International numbers go first, so `+91` and ten digits is not read as twelve digits. A mobile
 * number is also found as people write it: spaced after five digits, and after a 0, 91 or +91
 * (`98765 43210`, `098765 43210`, `91 98765 43210`, `+91-98765-43210`).
 */
const SECRET_TEXT: readonly ((text: string) => string)[] = [
  (t) => t.replace(/reset-password[:/][\w-]+/g, 'reset-password:[redacted]'),
  (t) => t.replace(/\bparams:[\s\S]*$/, 'params: [redacted]'),
  (t) => t.replace(/(token|secret|password)=[^\s&'"]+/gi, '$1=[redacted]'),
  (t) => t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'),
  (t) => t.replace(/(?<![\w+])\+\d{8,15}(?!\w)/g, (m) => `+${lastFour(m.slice(1))}`),
  (t) => t.replace(/(?<!\w|[\da-f]-)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\w|-[\da-f])/gi, '[number]'),
  (t) =>
    t.replace(/(?<![\w+])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\w)/g, (m) =>
      lastFour(m.replace(/\D/g, '')),
    ),
];

export function redactText(text: string): string {
  let out = text;
  for (const scrub of SECRET_TEXT) out = scrub(out);
  return out;
}

/** A plain, redacted copy of any value: strings are scrubbed, secret-named keys dropped. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (typeof value === 'string') return redactText(value);
  if (value instanceof Error) return redactError(value, depth);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? '[redacted]' : redact(v, depth + 1);
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

/** JSON lines on standard output (Vercel collects them); `error` and `warn` on standard error. */
export function jsonLogger(
  write: (level: LogLevel, line: string) => void = (level, line) => {
    if (level === 'error' || level === 'warn') console.error(line);
    else process.stdout.write(`${line}\n`);
  },
): Logger {
  return {
    log(level, event, fields = {}) {
      const line = JSON.stringify({
        level,
        event,
        time: new Date().toISOString(),
        ...(redact(fields) as Record<string, unknown>),
      });
      write(level, line);
    },
  };
}

/** Keeps every entry, already redacted, for assertions. */
export function memoryLogger(): Logger & {
  entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[];
} {
  const entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
  return {
    entries,
    log(level, event, fields = {}) {
      entries.push({ level, event, fields: redact(fields) as Record<string, unknown> });
    },
  };
}
