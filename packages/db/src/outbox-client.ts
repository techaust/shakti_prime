// The outbox publisher's connection: the non-superuser `outbox_publisher`, which may read
// `outbox_events` and update its six delivery columns, nothing else (docs/05-database.md §3,
// migrations 0035 and 0054). The publisher in apps/web/src/workers is its only caller;
// importing it anywhere else is a lint error.
import postgres from 'postgres';
import { connectionOptions } from './connection';
import { requireEnv } from './env';
import { leasedClaim } from './outbox-lease';
import type { ClaimOutbox, OutboxLag, OutboxLeaseStore, OutboxRow } from './outbox-types';
import { probeReady } from './ready';

export { leasedClaim, OUTBOX_LEASE_SECONDS } from './outbox-lease';
export type {
  ClaimOutbox,
  OutboxClaimResult,
  OutboxLag,
  OutboxLeaseStore,
  OutboxRow,
  OutboxUpdate,
} from './outbox-types';

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

/** A leased row, or (`spent`) the id of a row the lease dead-lettered, with nothing else. */
type LeasedRow =
  | {
      spent: false;
      id: string;
      sequence: string;
      entity_id: number;
      type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload_json: Record<string, unknown>;
      attempts: number;
      created_at: Date;
      lease: string;
    }
  | { spent: true; id: string };

/** The two short transactions of a publisher run, as `outbox_publisher`. */
export const postgresOutboxLeaseStore: OutboxLeaseStore = {
  async lease(limit, leaseSeconds, maxAttempts) {
    // One statement, so the row locks last only as long as it does. Due: never tried or past its
    // backoff, and not leased to a live run. A due row whose attempts are spent can only be one
    // whose last run died or gave no outcome, so it is dead-lettered here rather than tried
    // again; every other row is leased with its attempt counted now, so a run that dies after
    // this commit has still used one. The answer carries the attempts before this one. The
    // lease's exact text names this run afterwards; it goes back as text, because the driver
    // would round a timestamp parameter to milliseconds. The dead-lettered rows come back too,
    // by id alone, so the run can count and log them.
    const answer = await outboxSql()<LeasedRow[]>`
      with due as (
        select id, attempts
          from outbox_events
         where published_at is null and dead_lettered_at is null
           and (next_attempt_at is null or next_attempt_at <= now())
           and (claimed_until is null or claimed_until <= now())
         order by sequence
         limit ${limit}
           for update skip locked),
      spent as (
        update outbox_events o
           set dead_lettered_at = now(), last_error = 'no_outcome', next_attempt_at = null,
               claimed_until = null
          from due
         where o.id = due.id and due.attempts >= ${maxAttempts}::int
        returning o.id),
      leased as (
        update outbox_events o
           set attempts = due.attempts + 1,
               claimed_until = now() + ${leaseSeconds}::int * interval '1 second'
          from due
         where o.id = due.id and due.attempts < ${maxAttempts}::int
        returning o.id, o.sequence::text as sequence, o.entity_id, o.type, o.aggregate_type,
                  o.aggregate_id, o.payload_json, due.attempts, o.created_at,
                  o.claimed_until::text as lease)
      select false as spent, l.* from leased l
      union all
      select true, s.id, null, null, null, null, null, null, null, null, null from spent s`;
    const leased = answer.filter((r) => !r.spent);
    const deadLettered = answer.filter((r) => r.spent).map((r) => r.id);
    const rows: OutboxRow[] = leased
      .map((r) => ({
        id: r.id,
        sequence: r.sequence,
        entityId: r.entity_id,
        type: r.type,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        payload: r.payload_json,
        attempts: r.attempts,
        createdAt: r.created_at,
      }))
      .sort((a, b) => {
        const d = BigInt(a.sequence) - BigInt(b.sequence);
        return d < 0n ? -1 : d > 0n ? 1 : 0;
      });
    return { lease: leased[0]?.lease ?? '', rows, deadLettered };
  },

  async record(lease, updates, release) {
    const published = updates.filter((u) => u.outcome === 'published').map((u) => u.id);
    const failed = updates.filter((u) => u.outcome === 'failed');
    return outboxSql().begin(async (tx) => {
      let changed = 0;
      if (published.length > 0) {
        const done = await tx`
          update outbox_events set published_at = now(), claimed_until = null
           where id = any(${published}::uuid[]) and claimed_until = ${lease}::text::timestamptz`;
        changed += done.count;
      }
      if (failed.length > 0) {
        const outcomes = failed.map((u) => ({
          id: u.id,
          attempts: u.attempts,
          last_error: u.lastError.slice(0, 500),
          dead: u.deadLetter,
          retry: Math.max(0, Math.round(u.retryInSeconds ?? 0)),
        }));
        // A dead letter waits for a replay; any other failure is due again after its backoff.
        const retried = await tx`
          update outbox_events o
             set attempts = f.attempts,
                 last_error = f.last_error,
                 dead_lettered_at = case when f.dead then now() end,
                 next_attempt_at = case when not f.dead
                                        then now() + f.retry * interval '1 second' end,
                 claimed_until = null
            from jsonb_to_recordset(${JSON.stringify(outcomes)}::text::jsonb)
                 as f(id uuid, attempts int, last_error text, dead boolean, retry int)
           where o.id = f.id and o.claimed_until = ${lease}::text::timestamptz`;
        changed += retried.count;
      }
      if (release.length > 0) {
        // A released row was not tried, so the attempt its lease counted is given back.
        const freed = await tx`
          update outbox_events set claimed_until = null, attempts = attempts - 1
           where id = any(${[...release]}::uuid[]) and claimed_until = ${lease}::text::timestamptz`;
        changed += freed.count;
      }
      return changed;
    });
  },
};

export const claimOutbox: ClaimOutbox = leasedClaim(postgresOutboxLeaseStore);

/**
 * QStash gave up on an event's worker (its failure callback): the event, recorded as delivered
 * when the queue took it, is held back as a dead letter with the worker's error, so Integration
 * Health lists it, the owner is told and Send again replays it. Only a delivered event that is not
 * already held back changes; the outbox trigger allows exactly this change, and only to this role.
 */
export async function holdBackFailedEvent(
  eventId: string,
  lastError: 'worker_failed' | 'worker_refused',
): Promise<'held' | 'unchanged'> {
  const rows = await outboxSql()`
    update outbox_events
       set published_at = null, dead_lettered_at = now(), last_error = ${lastError},
           next_attempt_at = null, claimed_until = null
     where id = ${eventId} and published_at is not null and dead_lettered_at is null
    returning id`;
  return rows.length === 1 ? 'held' : 'unchanged';
}

export async function outboxLag(): Promise<OutboxLag> {
  // A pending event became due at the latest of its creation, its backoff and its lease; one
  // whose moment has passed is due now. Both reads stay on the partial indexes.
  const [row] = await outboxSql()<
    {
      oldest_pending_seconds: number | null;
      oldest_due_seconds: number | null;
      retrying: number;
      in_flight: number;
      dead_lettered: number;
    }[]
  >`
    select extract(epoch from now() - min(created_at))::int as oldest_pending_seconds,
           extract(epoch from now() - min(greatest(created_at, next_attempt_at, claimed_until))
             filter (where greatest(created_at, next_attempt_at, claimed_until) <= now()))::int
             as oldest_due_seconds,
           count(*) filter (where next_attempt_at > now())::int as retrying,
           count(*) filter (where claimed_until > now())::int as in_flight,
           (select count(*)::int from outbox_events where dead_lettered_at is not null)
             as dead_lettered
      from outbox_events
     where published_at is null and dead_lettered_at is null`;
  return {
    oldestPendingSeconds: row?.oldest_pending_seconds ?? null,
    oldestDueSeconds: row?.oldest_due_seconds ?? null,
    retrying: row?.retrying ?? 0,
    inFlight: row?.in_flight ?? 0,
    deadLettered: row?.dead_lettered ?? 0,
  };
}

/**
 * Readiness: the connection works and no due event has waited longer than `maxWaitSeconds` since
 * it became due, which happens only when no publisher runs. Events waiting out their backoff and
 * dead letters never turn it down; `observe` receives the counts, for the log.
 */
export function checkOutboxReady(
  maxWaitSeconds = 300,
  timeoutMs = 3_000,
  observe?: (lag: OutboxLag) => void,
): Promise<'ok' | 'down'> {
  return probeReady(async () => {
    const lag = await outboxLag();
    observe?.(lag);
    if (lag.oldestDueSeconds !== null && lag.oldestDueSeconds > maxWaitSeconds) {
      throw new Error('a due event has waited too long');
    }
  }, timeoutMs);
}

export async function closeOutboxDb(): Promise<void> {
  if (pool) await pool.end({ timeout: 5 });
  pool = undefined;
}
