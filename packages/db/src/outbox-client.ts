// The outbox publisher's connection: the non-superuser `outbox_publisher`, which may read
// `outbox_events` and update its four delivery columns, nothing else (docs/DATABASE.md §3,
// migration 0035). The publisher in apps/web/src/workers is its only caller; importing it
// anywhere else is a lint error.
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { requireEnv } from './env';
import type { ClaimOutbox, OutboxLag, OutboxRow } from './outbox-types';
import { probeReady } from './ready';

export type { ClaimOutbox, OutboxLag, OutboxRow, OutboxUpdate } from './outbox-types';

let pool: ReturnType<typeof postgres> | undefined;

/** Opened on first use, so importing this module reads no secret (`next build` loads routes). */
function outboxSql(): ReturnType<typeof postgres> {
  const url = requireEnv('DATABASE_URL_OUTBOX');
  pool ??= postgres(url, {
    ...connectionOptions(url, 'shakti-outbox'),
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return pool;
}

interface ClaimedRow {
  id: string;
  sequence: string;
  entity_id: number;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

export const claimOutbox: ClaimOutbox = async (limit, deliver) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('the claim limit is between 1 and 500');
  }
  return outboxSql().begin(async (tx) => {
    const claimed = await tx<ClaimedRow[]>`
      select id, sequence::text as sequence, entity_id, type, aggregate_type, aggregate_id,
             payload_json, attempts, created_at
        from outbox_events
       where published_at is null and dead_lettered_at is null
       order by sequence
       limit ${limit}
         for update skip locked`;
    if (claimed.length === 0) return 0;

    const rows: OutboxRow[] = claimed.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      entityId: r.entity_id,
      type: r.type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload_json,
      attempts: r.attempts,
      createdAt: r.created_at,
    }));
    const updates = await deliver(rows);
    const claimedIds = new Set(rows.map((r) => r.id));
    const published: string[] = [];
    for (const u of updates) {
      if (!claimedIds.has(u.id)) throw new Error('a delivery result names a row it did not claim');
      if (u.outcome === 'published') {
        published.push(u.id);
        continue;
      }
      await tx`
        update outbox_events
           set attempts = ${u.attempts},
               last_error = ${u.lastError.slice(0, 500)},
               dead_lettered_at = ${u.deadLetter ? tx`now()` : null}
         where id = ${u.id}`;
    }
    if (published.length > 0) {
      await tx`update outbox_events set published_at = now() where id = any(${published}::uuid[])`;
    }
    return claimed.length;
  });
};

export async function outboxLag(): Promise<OutboxLag> {
  const [row] = await outboxSql()<
    { oldest_pending_seconds: number | null; dead_lettered: number }[]
  >`
    select (select extract(epoch from now() - min(created_at))::int
              from outbox_events
             where published_at is null and dead_lettered_at is null) as oldest_pending_seconds,
           (select count(*)::int from outbox_events where dead_lettered_at is not null)
             as dead_lettered`;
  return {
    oldestPendingSeconds: row?.oldest_pending_seconds ?? null,
    deadLettered: row?.dead_lettered ?? 0,
  };
}

/** Readiness: the connection works and no event has waited longer than `maxWaitSeconds`. */
export function checkOutboxReady(maxWaitSeconds = 300, timeoutMs = 3_000): Promise<'ok' | 'down'> {
  return probeReady(async () => {
    const lag = await outboxLag();
    if (lag.oldestPendingSeconds !== null && lag.oldestPendingSeconds > maxWaitSeconds) {
      throw new Error('an event has waited too long');
    }
  }, timeoutMs);
}

export async function closeOutboxDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  pool = undefined;
}
