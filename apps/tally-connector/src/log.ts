import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { istClock } from './settings';

/**
 * The connector's log: one JSON line per event, a file per India day, kept `logKeepDays`. A line
 * holds an event name, ids and counts only: never a party name, an amount, a voucher's contents or
 * the key (docs/03-roadmap-appendix/phase5.md §6.2). A string reaches a line only through
 * `logId()`, which lets through the shapes of an id and nothing else.
 */

declare const logIdBrand: unique symbol;
/** A string checked to have the shape of an id: a GUID, a UUID, a company code or an error code. */
export type LogId = string & { readonly [logIdBrand]: true };

export type LogValue = number | boolean | LogId | null;
export type LogFields = Readonly<Record<string, LogValue | undefined>>;

const ID_SHAPES = [
  // Tally's GUID: the company's GUID and the record's master id.
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[0-9a-f]{1,8})?$/i,
  // A company code (`SS`, `RCREF`).
  /^[A-Z]{2,10}$/,
  // An error code, reason or field name (`cursor_mismatch`, `partyGstin`, `ECONNREFUSED`,
  // `TimeoutError`).
  /^[a-z][A-Za-z0-9_]{0,59}$/,
  /^[A-Z][A-Z0-9_]{0,59}$/,
  /^[A-Z][A-Za-z]{0,59}Error$/,
];

/** The value when it has an id's shape, else the word `withheld`, so a slip never logs data. */
export function logId(value: string): LogId {
  return (ID_SHAPES.some((shape) => shape.test(value)) ? value : 'withheld') as LogId;
}

/** An error's kind for a log line: its code or class name, never its message. */
export function errorKind(error: unknown): LogId {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return logId(code);
    const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
    if (typeof causeCode === 'string') return logId(causeCode);
    return logId(error.name);
  }
  return logId('unknown');
}

export interface Log {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

type Level = 'info' | 'warn' | 'error';

function line(at: Date, level: Level, event: string, fields: LogFields | undefined): string {
  return `${JSON.stringify({ at: at.toISOString(), level, event: logId(event), ...fields })}\n`;
}

const FILE_PATTERN = /^connector-(\d{4}-\d{2}-\d{2})\.log$/;

/** Writes to `<dir>/connector-<India date>.log` and removes files older than `keepDays`. */
export function createFileLog(options: {
  dir: string;
  keepDays: number;
  now?: () => Date;
  /** Also to standard error, for a person running it by hand. */
  echo?: boolean;
}): Log {
  const now = options.now ?? (() => new Date());
  mkdirSync(options.dir, { recursive: true });
  let day = '';

  function rotate(today: string): void {
    day = today;
    const oldest = new Date(`${today}T00:00:00Z`);
    oldest.setUTCDate(oldest.getUTCDate() - options.keepDays + 1);
    const cutoff = oldest.toISOString().slice(0, 10);
    for (const name of readdirSync(options.dir)) {
      const date = FILE_PATTERN.exec(name)?.[1];
      if (date !== undefined && date < cutoff) rmSync(join(options.dir, name), { force: true });
    }
  }

  function write(level: Level, event: string, fields?: LogFields): void {
    const at = now();
    const today = istClock(at).date;
    if (today !== day) rotate(today);
    const text = line(at, level, event, fields);
    appendFileSync(join(options.dir, `connector-${today}.log`), text, { mode: 0o600 });
    if (options.echo === true) process.stderr.write(text);
  }

  return {
    info: (event, fields) => {
      write('info', event, fields);
    },
    warn: (event, fields) => {
      write('warn', event, fields);
    },
    error: (event, fields) => {
      write('error', event, fields);
    },
  };
}

/** Keeps the lines in memory, for tests. */
export function createMemoryLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  const at = new Date(0);
  const write = (level: Level) => (event: string, fields?: LogFields) => {
    lines.push(line(at, level, event, fields).trimEnd());
  };
  return { lines, info: write('info'), warn: write('warn'), error: write('error') };
}
