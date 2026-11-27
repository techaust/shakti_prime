import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * The local outbox (ADR 0013): every page read from Tally is written here, with the
 * `Idempotency-Key` it will carry, before it is sent. A row stays `pending` until the BOS answers
 * it, so a kill, a power cut or a lost answer resends the same body under the same key, which the
 * BOS applies once. Answered rows are kept `outboxKeepDays` (the BOS keeps its keys as long), then
 * removed. One SQLite file per installation, through Node's built-in `node:sqlite`.
 */

export type OutboxKind = 'batch' | 'snapshot';

export interface OutboxRow {
  id: number;
  kind: OutboxKind;
  company: string;
  /** The batch's AlterID range; null for a snapshot. */
  fromAlterId: number | null;
  maxAlterId: number | null;
  idempotencyKey: string;
  /** The JSON body exactly as sent, so a resend hashes and signs the same. */
  body: string;
  createdAt: number;
  attempts: number;
}

const DAY_MS = 24 * 60 * 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('batch', 'snapshot')),
  company TEXT NOT NULL,
  from_alter_id INTEGER,
  max_alter_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'superseded')),
  settled_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (state, id);
CREATE TABLE IF NOT EXISTS connector_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`;

interface Row {
  id: number;
  kind: OutboxKind;
  company: string;
  from_alter_id: number | null;
  max_alter_id: number | null;
  idempotency_key: string;
  body: string;
  created_at: number;
  attempts: number;
}

function toRow(row: Row): OutboxRow {
  return {
    id: row.id,
    kind: row.kind,
    company: row.company,
    fromAlterId: row.from_alter_id,
    maxAlterId: row.max_alter_id,
    idempotencyKey: row.idempotency_key,
    body: row.body,
    createdAt: row.created_at,
    attempts: row.attempts,
  };
}

export class Outbox {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(path);
    // Write-ahead logging with a full sync: a row is on disk before the batch leaves.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  /** Writes a page or a snapshot, with a new key, before it is sent. */
  enqueue(entry: {
    kind: OutboxKind;
    company: string;
    fromAlterId?: number;
    maxAlterId?: number;
    body: string;
  }): OutboxRow {
    const row = this.db
      .prepare(
        `INSERT INTO outbox (kind, company, from_alter_id, max_alter_id, idempotency_key, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        entry.kind,
        entry.company,
        entry.fromAlterId ?? null,
        entry.maxAlterId ?? null,
        randomUUID(),
        entry.body,
        this.now(),
      ) as unknown as Row;
    return toRow(row);
  }

  /** Rows not yet answered, oldest first: the order they are sent in. */
  pending(): OutboxRow[] {
    return (
      this.db
        .prepare(`SELECT * FROM outbox WHERE state = 'pending' ORDER BY id`)
        .all() as unknown as Row[]
    ).map(toRow);
  }

  depth(): number {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM outbox WHERE state = 'pending'`)
      .get() as { n: number };
    return row.n;
  }

  noteAttempt(id: number): void {
    this.db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?').run(id);
  }

  /** The BOS answered the row. */
  markSent(id: number): void {
    this.db
      .prepare(`UPDATE outbox SET state = 'sent', settled_at = ? WHERE id = ? AND state = 'pending'`)
      .run(this.now(), id);
  }

  /**
   * The company's pending batches no longer fit the BOS's cursor: they are set aside, and the
   * connector reads Tally again from the cursor, which gives the latest version of every voucher.
   */
  supersedeBatches(company: string): number {
    const result = this.db
      .prepare(
        `UPDATE outbox SET state = 'superseded', settled_at = ?
         WHERE company = ? AND kind = 'batch' AND state = 'pending'`,
      )
      .run(this.now(), company);
    return Number(result.changes);
  }

  /** Removes answered rows older than `keepDays`; a pending row is never removed. */
  prune(keepDays: number): number {
    const result = this.db
      .prepare(`DELETE FROM outbox WHERE state <> 'pending' AND settled_at < ?`)
      .run(this.now() - keepDays * DAY_MS);
    return Number(result.changes);
  }

  getState(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM connector_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO connector_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
