import { redact } from './redaction';

export * from './redaction';

/**
 * Structured logging (AUDIT M35): one JSON line per event with a level, an event name and the
 * request id, so an incident leaves something to diagnose. Everything logged passes through the
 * redaction in ./redaction.ts first (AUDIT M10): a set-password link, a session token or the
 * bound values of a failed query are ways into an account for anyone who can read the logs.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
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
      // A time or amount may be a bigint, which JSON has no form for: it is written as text.
      const line = JSON.stringify(
        {
          level,
          event,
          time: new Date().toISOString(),
          ...(redact(fields) as Record<string, unknown>),
        },
        (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      );
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
