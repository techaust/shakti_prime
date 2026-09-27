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

/** Link and token shapes that may appear inside free text. */
const SECRET_TEXT: readonly [RegExp, string][] = [
  [/reset-password[:/][\w-]+/g, 'reset-password:[redacted]'],
  [/\bparams:[\s\S]*$/, 'params: [redacted]'],
  [/(token|secret|password)=[^\s&'"]+/gi, '$1=[redacted]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_TEXT) out = out.replace(pattern, replacement);
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
      out[key] = SECRET_KEYS.has(key) ? '[redacted]' : redact(v, depth + 1);
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
