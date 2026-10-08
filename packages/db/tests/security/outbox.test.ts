import { newId } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkOutboxReady,
  claimOutbox,
  closeOutboxDb,
  holdBackFailedEvent,
  OUTBOX_LEASE_SECONDS,
  outboxLag,
  postgresOutboxLeaseStore,
} from '../../src/outbox-client';
import type { OutboxLag, OutboxRow } from '../../src/outbox-types';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  AUTH_TABLES,
  closeDb,
  ENTITY_TABLES,
  principalFor,
  SHARED_TABLES,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

/** Every row this file writes carries its own aggregate type, so other suites' rows never count. */
const TAG = `test_outbox_${newId().slice(-8)}`;

/** The publisher's allowance of attempts (OUTBOX_MAX_ATTEMPTS in @shakti/domain). */
const MAX_ATTEMPTS = 10;

/** The claim as the publisher calls it, with its allowance of attempts. */
const claim = (limit: number, deliver: Parameters<typeof claimOutbox>[1]) =>
  claimOutbox(limit, deliver, MAX_ATTEMPTS);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

function insertStatement(entityId: number, id = newId()) {
  return sql`
    insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json)
    values (${id}, ${entityId}, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb)`;
}

/** Inserts pending rows as the table owner and answers their ids in delivery order. */
async function seedRows(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => newId());
  await asMigrator(async (m) => {
    for (const id of ids) {
      await m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json)
              values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb)`;
    }
  });
  return ids;
}

async function rowAsPublisher(id: string) {
  return asOutboxPublisher(async (p) => {
    const [row] = await p<
      {
        entity_id: number;
        published_at: Date | null;
        attempts: number;
        last_error: string | null;
        dead_lettered_at: Date | null;
      }[]
    >`select entity_id, published_at, attempts, last_error, dead_lettered_at
        from outbox_events where id = ${id}`;
    return row;
  });
}

describe('the application role writes events and nothing else (docs/05-database.md §5)', () => {
  it('inserts an event of an entity in its scope', async () => {
    const id = newId();
    await asPrincipal(principalFor('executive', [1]), ({ tx }) =>
      tx.execute(insertStatement(1, id)),
    );
    expect(await rowAsPublisher(id)).toMatchObject({
      entity_id: 1,
      published_at: null,
      attempts: 0,
    });
  });

  it('refuses an event of an entity outside its scope', async () => {
    const message = await failure(
      asPrincipal(principalFor('executive', [1]), ({ tx }) => tx.execute(insertStatement(2))),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('refuses every event without a request context', async () => {
    expect(await failure(withoutContext(insertStatement(1)))).toMatch(/row-level security/);
  });

  it('cannot read, change or remove an event', async () => {
    const exec = principalFor('executive');
    for (const statement of [
      sql`select count(*) from outbox_events`,
      sql`update outbox_events set published_at = now() where aggregate_type = ${TAG}`,
      sql`delete from outbox_events where aggregate_type = ${TAG}`,
    ]) {
      expect(await failure(asPrincipal(exec, ({ tx }) => tx.execute(statement)))).toMatch(
        /permission denied/,
      );
    }
  });

  it('holds insert only, and reporting holds nothing', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'outbox_events', 'INSERT') as i,
             has_table_privilege('app_user', 'outbox_events', 'SELECT') as s,
             has_any_column_privilege('app_user', 'outbox_events', 'UPDATE') as u,
             has_table_privilege('app_user', 'outbox_events', 'DELETE') as d,
             has_any_column_privilege('readonly_reporter', 'outbox_events', 'SELECT') as reporter
    `);
    expect(row).toEqual({ i: true, s: false, u: false, d: false, reporter: false });
  });
});

describe('the outbox publisher role (docs/05-database.md §3)', () => {
  let pending: string[];
  beforeAll(async () => {
    pending = await seedRows(1);
  });

  it('cannot bypass RLS and has the request timeouts', async () => {
    const [role] = await withoutContext<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'outbox_publisher'`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const [settings] = await asOutboxPublisher(
      (p) => p<{ s: string; l: string; i: string }[]>`
        select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l,
               current_setting('idle_in_transaction_session_timeout') as i`,
    );
    expect(settings).toEqual({ s: '30s', l: '10s', i: '30s' });
  });

  it('reads events and marks their delivery', async () => {
    const [id] = pending;
    await asOutboxPublisher(
      (p) =>
        p`update outbox_events set attempts = 1, last_error = 'http_503' where id = ${id ?? ''}`,
    );
    expect(await rowAsPublisher(id ?? '')).toMatchObject({ attempts: 1, last_error: 'http_503' });
  });

  it('cannot change what an event says, write one or remove one', async () => {
    const [id] = pending;
    for (const statement of [
      (p: postgres.Sql) =>
        p`update outbox_events set payload_json = '{"v": 2}' where id = ${id ?? ''}`,
      (p: postgres.Sql) =>
        p`update outbox_events set type = 'crm.lead.created' where id = ${id ?? ''}`,
      (p: postgres.Sql) => p`delete from outbox_events where id = ${id ?? ''}`,
      (p: postgres.Sql) =>
        p`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json)
          values (${newId()}, 1, 'admin.user.reactivated', ${TAG}, 'x', '{"v": 1}'::jsonb)`,
    ]) {
      expect(await failure(asOutboxPublisher(statement))).toMatch(/permission denied/);
    }
  });

  it('cannot read any business, reference or identity table', async () => {
    for (const table of [...SHARED_TABLES, ...ENTITY_TABLES, ...AUTH_TABLES]) {
      const message = await failure(asOutboxPublisher((p) => p`select count(*) from ${p(table)}`));
      expect(message, table).toMatch(/permission denied/);
    }
  });
});

describe('an event is never rewritten, even by the table owner', () => {
  it('refuses a change outside the delivery columns and any delete', async () => {
    const [id] = await seedRows(1);
    expect(
      await failure(
        asMigrator(
          (m) => m`update outbox_events set aggregate_id = 'other' where id = ${id ?? ''}`,
        ),
      ),
    ).toMatch(/only the delivery columns/);
    expect(
      await failure(asMigrator((m) => m`delete from outbox_events where id = ${id ?? ''}`)),
    ).toMatch(/append-only/);
  });
});

describe('claimOutbox (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2)', () => {
  it('claims pending events in delivery order and applies each outcome', async () => {
    const [published, failed, dead] = await seedRows(3);
    let seen: readonly OutboxRow[] = [];
    await claim(500, (rows) => {
      seen = rows;
      return Promise.resolve([
        { id: published ?? '', outcome: 'published' as const },
        {
          id: failed ?? '',
          outcome: 'failed' as const,
          attempts: 1,
          lastError: 'http_503',
          deadLetter: false,
        },
        {
          id: dead ?? '',
          outcome: 'failed' as const,
          attempts: 10,
          lastError: 'http_404',
          deadLetter: true,
        },
      ]);
    });
    const sequences = seen.map((r) => BigInt(r.sequence));
    expect(sequences).toEqual([...sequences].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(seen.map((r) => r.id)).toEqual(expect.arrayContaining([published, failed, dead]));
    expect(seen.find((r) => r.id === published)).toMatchObject({
      type: 'admin.user.reactivated',
      entityId: 1,
      aggregateType: TAG,
      payload: { v: 1 },
      attempts: 0,
    });

    expect((await rowAsPublisher(published ?? ''))?.published_at).toBeInstanceOf(Date);
    expect(await rowAsPublisher(failed ?? '')).toMatchObject({
      published_at: null,
      attempts: 1,
      last_error: 'http_503',
      dead_lettered_at: null,
    });
    const deadRow = await rowAsPublisher(dead ?? '');
    expect(deadRow?.attempts).toBe(10);
    expect(deadRow?.dead_lettered_at).toBeInstanceOf(Date);
    expect((await outboxLag()).deadLettered).toBeGreaterThanOrEqual(1);
  });

  it('never hands the same event to two runs at once', async () => {
    const ours = await seedRows(4);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const claimedFirst = new Promise<void>((resolve) => {
      started = resolve;
    });
    let first: string[] = [];
    let second: string[] = [];
    const publishOurs = (rows: readonly OutboxRow[]) =>
      rows
        .filter((r) => ours.includes(r.id))
        .map((r) => ({ id: r.id, outcome: 'published' as const }));

    const runA = claim(500, async (rows) => {
      first = rows.map((r) => r.id);
      started();
      await held;
      return publishOurs(rows);
    });
    await claimedFirst;
    await claim(500, (rows) => {
      second = rows.map((r) => r.id);
      return Promise.resolve(publishOurs(rows));
    });
    release();
    await runA;

    expect(first.filter((id) => second.includes(id))).toEqual([]);
    expect([...first, ...second]).toEqual(expect.arrayContaining(ours));
  });

  it('refuses an outcome for an event it did not claim and changes nothing', async () => {
    const [id] = await seedRows(1);
    await expect(
      claim(500, () => Promise.resolve([{ id: newId(), outcome: 'published' as const }])),
    ).rejects.toThrow(/did not claim/);
    expect(await rowAsPublisher(id ?? '')).toMatchObject({ published_at: null, attempts: 0 });
    await claim(500, (rows) =>
      Promise.resolve(
        rows.filter((r) => r.id === id).map((r) => ({ id: r.id, outcome: 'published' as const })),
      ),
    );
  });

  it('reports how long the oldest pending event has waited', async () => {
    await seedRows(1);
    const lag = await outboxLag();
    expect(lag.oldestPendingSeconds).not.toBeNull();
    await claim(500, (rows) =>
      Promise.resolve(
        rows
          .filter((r) => r.aggregateType === TAG)
          .map((r) => ({ id: r.id, outcome: 'published' as const })),
      ),
    );
  });
});

/** Publishes what a claim handed over of this file's rows; the claim releases everything else. */
const publishTagged = (rows: readonly OutboxRow[]) =>
  Promise.resolve(
    rows
      .filter((r) => r.aggregateType === TAG)
      .map((r) => ({ id: r.id, outcome: 'published' as const })),
  );

const failedOnce = (id: string, lastError: string) => ({
  id,
  outcome: 'failed' as const,
  attempts: 1,
  lastError,
  deadLetter: false,
  retryInSeconds: 60,
});

async function deliveryState(id: string) {
  return asOutboxPublisher(async (p) => {
    const [row] = await p<
      { published: boolean; attempts: number; leased_for: number | null; due_in: number | null }[]
    >`select published_at is not null as published, attempts,
             extract(epoch from claimed_until - now())::int as leased_for,
             extract(epoch from next_attempt_at - now())::int as due_in
        from outbox_events where id = ${id}`;
    return row;
  });
}

describe('the publisher changes the delivery columns only (migration 0054)', () => {
  it('holds update on the six delivery columns and on nothing else', async () => {
    const rows = await withoutContext<{ column: string; publisher: boolean; app: boolean }>(sql`
      select a.attname as column,
             has_column_privilege('outbox_publisher', 'outbox_events', a.attname, 'UPDATE') as publisher,
             has_column_privilege('app_user', 'outbox_events', a.attname, 'UPDATE') as app
        from pg_attribute a
       where a.attrelid = 'outbox_events'::regclass and a.attnum > 0 and not a.attisdropped
       order by a.attnum`);
    expect(rows.filter((r) => r.publisher).map((r) => r.column)).toEqual([
      'published_at',
      'attempts',
      'last_error',
      'dead_lettered_at',
      'next_attempt_at',
      'claimed_until',
    ]);
    expect(rows.filter((r) => r.app)).toEqual([]);
  });

  it('sets a backoff and a lease, and still cannot rewrite what an event says', async () => {
    const [id = ''] = await seedRows(1);
    await asOutboxPublisher(
      (p) => p`update outbox_events
                  set next_attempt_at = now() + interval '1 minute',
                      claimed_until = now() + interval '2 minutes'
                where id = ${id}`,
    );
    const state = await deliveryState(id);
    expect(state?.due_in).toBeGreaterThan(0);
    expect(state?.leased_for).toBeGreaterThan(60);
    expect(
      await failure(
        asOutboxPublisher(
          (p) => p`update outbox_events set created_at = now() - interval '1 day'
                    where id = ${id}`,
        ),
      ),
    ).toMatch(/permission denied/);
    await asOutboxPublisher(
      (p) => p`update outbox_events set published_at = now(), claimed_until = null
                where id = ${id}`,
    );
  });
});

describe('claimOutbox with backoff and leases (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2)', () => {
  it('leases the rows while they are delivered, and no transaction holds them', async () => {
    const [id = ''] = await seedRows(1);
    let during: Awaited<ReturnType<typeof deliveryState>>;
    let lockedElsewhere: boolean | undefined;
    await claim(500, async (rows) => {
      during = await deliveryState(id);
      // Another connection locks the row at once: the claim's transaction has committed.
      lockedElsewhere = await asOutboxPublisher((p) =>
        p.begin(async (tx) => {
          const locked = await tx`select id from outbox_events where id = ${id}
                                    for update nowait`;
          return locked.length === 1;
        }),
      );
      return publishTagged(rows);
    });
    expect(during?.leased_for).toBeGreaterThan(OUTBOX_LEASE_SECONDS - 20);
    expect(during?.leased_for).toBeLessThanOrEqual(OUTBOX_LEASE_SECONDS);
    expect(lockedElsewhere).toBe(true);
    expect(await deliveryState(id)).toMatchObject({ published: true, leased_for: null });
  });

  it('does not claim a failed event again before its backoff has passed', async () => {
    const [id = ''] = await seedRows(1);
    await claim(500, (rows) =>
      Promise.resolve(rows.filter((r) => r.id === id).map((r) => failedOnce(r.id, 'http_503'))),
    );
    const failed = await deliveryState(id);
    expect(failed).toMatchObject({ published: false, attempts: 1, leased_for: null });
    expect(failed?.due_in).toBeGreaterThan(50);
    expect(failed?.due_in).toBeLessThanOrEqual(60);

    let offered = false;
    await claim(500, (rows) => {
      offered = rows.some((r) => r.id === id);
      return publishTagged(rows.filter((r) => r.id !== id));
    });
    expect(offered).toBe(false);

    // Its backoff over, the next run takes it.
    await asOutboxPublisher(
      (p) => p`update outbox_events set next_attempt_at = now() - interval '1 second'
                where id = ${id}`,
    );
    await claim(500, (rows) => {
      offered = rows.some((r) => r.id === id);
      return publishTagged(rows);
    });
    expect(offered).toBe(true);
    // Two leases, two attempts: the failed one and the one that delivered it.
    expect(await deliveryState(id)).toMatchObject({ published: true, attempts: 2 });
  });

  it('claims again a row whose lease ran out, and the run that lost it records nothing', async () => {
    const [id = ''] = await seedRows(1);
    let resume: () => void = () => undefined;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let leased: () => void = () => undefined;
    const claimedFirst = new Promise<void>((resolve) => {
      leased = resolve;
    });
    // The first run stalls after its claim, as a run whose function was stopped would.
    const stalled = claim(500, async (rows) => {
      leased();
      await resumed;
      return rows.filter((r) => r.id === id).map((r) => failedOnce(r.id, 'TimeoutError'));
    });
    await claimedFirst;

    let offered = false;
    await claim(500, (rows) => {
      offered = rows.some((r) => r.id === id);
      return publishTagged(rows.filter((r) => r.id !== id));
    });
    expect(offered).toBe(false);

    await asOutboxPublisher(
      (p) => p`update outbox_events set claimed_until = now() - interval '1 second'
                where id = ${id}`,
    );
    await claim(500, (rows) => {
      offered = rows.some((r) => r.id === id);
      return publishTagged(rows);
    });
    expect(offered).toBe(true);

    resume();
    await stalled;
    // The stalled run's lease counted an attempt it never recorded, as a run that died would.
    expect(await deliveryState(id)).toMatchObject({
      published: true,
      attempts: 2,
      due_in: null,
      leased_for: null,
    });
  });

  it('counts a normal failure once: the lease counts the attempt and the outcome keeps that count', async () => {
    const [id = ''] = await seedRows(1);
    // As the publisher records a failure: the attempts before this run, and this one.
    const failWithBackoff = (rows: readonly OutboxRow[]) =>
      Promise.resolve(
        rows
          .filter((r) => r.id === id)
          .map((r) => ({
            id: r.id,
            outcome: 'failed' as const,
            attempts: r.attempts + 1,
            lastError: 'http_503',
            deadLetter: false,
            retryInSeconds: 60,
          })),
      );
    await claim(500, failWithBackoff);
    expect(await deliveryState(id)).toMatchObject({ published: false, attempts: 1 });
    await asOutboxPublisher(
      (p) => p`update outbox_events set next_attempt_at = now() - interval '1 second'
                where id = ${id}`,
    );
    await claim(500, failWithBackoff);
    expect(await deliveryState(id)).toMatchObject({ published: false, attempts: 2 });
    await asOutboxPublisher(
      (p) => p`update outbox_events set next_attempt_at = null, published_at = now()
                where id = ${id}`,
    );
  });

  it('gives back the attempt of a row it releases, and of one a delivery left without an outcome', async () => {
    const [id = ''] = await seedRows(1);
    await expect(
      claim(500, () => Promise.reject(new Error('the run was cut short'))),
    ).rejects.toThrow('the run was cut short');
    expect(await deliveryState(id)).toMatchObject({ attempts: 0, leased_for: null });
    await claim(500, (rows) => publishTagged(rows.filter((r) => r.id !== id)));
    expect(await deliveryState(id)).toMatchObject({ published: false, attempts: 0 });
    await claim(500, publishTagged);
  });

  it('a run that dies after its lease still uses an attempt, so a crash loop is dead-lettered', async () => {
    // One attempt short of the allowance, as nine runs that died would leave it.
    const id = newId();
    await asMigrator(
      (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                          payload_json, attempts, last_error)
               values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
                       ${MAX_ATTEMPTS - 1}, 'http_503')`,
    );
    // The tenth run leases it and dies: nothing is recorded, and the lease runs out.
    const crashed = await postgresOutboxLeaseStore.lease(500, OUTBOX_LEASE_SECONDS, MAX_ATTEMPTS);
    const mine = crashed.rows.find((r) => r.id === id);
    expect(mine?.attempts).toBe(MAX_ATTEMPTS - 1);
    // Rows of other suites it took are handed back as a live run would.
    await postgresOutboxLeaseStore.record(
      crashed.lease,
      [],
      crashed.rows.map((r) => r.id).filter((other) => other !== id),
    );
    expect(await deliveryState(id)).toMatchObject({ published: false, attempts: MAX_ATTEMPTS });
    await asOutboxPublisher(
      (p) => p`update outbox_events set claimed_until = now() - interval '1 second'
                where id = ${id}`,
    );

    // The next run does not take it again: its attempts are spent, so it is dead-lettered, and
    // the claim names it so the run counts and logs it.
    let offered = false;
    const next = await claim(500, (rows) => {
      offered = rows.some((r) => r.id === id);
      return publishTagged(rows);
    });
    expect(offered).toBe(false);
    expect(next.deadLettered).toContain(id);
    expect(await rowAsPublisher(id)).toMatchObject({
      published_at: null,
      attempts: MAX_ATTEMPTS,
      last_error: 'no_outcome',
    });
    expect((await rowAsPublisher(id))?.dead_lettered_at).toBeInstanceOf(Date);
    expect(await deliveryState(id)).toMatchObject({ due_in: null, leased_for: null });
  });

  it('never leases one row to two runs claiming at the same moment', async () => {
    const ours = await seedRows(12);
    const [a, b] = await Promise.all([
      postgresOutboxLeaseStore.lease(500, OUTBOX_LEASE_SECONDS, MAX_ATTEMPTS),
      postgresOutboxLeaseStore.lease(500, OUTBOX_LEASE_SECONDS, MAX_ATTEMPTS),
    ]);
    const idsA = a.rows.map((r) => r.id);
    const idsB = b.rows.map((r) => r.id);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    expect([...idsA, ...idsB]).toEqual(expect.arrayContaining(ours));
    for (const run of [a, b]) {
      const mine = run.rows.filter((r) => ours.includes(r.id)).map((r) => r.id);
      await postgresOutboxLeaseStore.record(
        run.lease,
        mine.map((id) => ({ id, outcome: 'published' as const })),
        run.rows.map((r) => r.id).filter((id) => !mine.includes(id)),
      );
    }
    for (const id of ours) expect((await deliveryState(id))?.published).toBe(true);
  });

  it('dead-letters with no next attempt and no lease left', async () => {
    const [id = ''] = await seedRows(1);
    await claim(500, (rows) =>
      Promise.resolve(
        rows
          .filter((r) => r.aggregateType === TAG)
          .map((r) =>
            r.id === id
              ? {
                  id: r.id,
                  outcome: 'failed' as const,
                  attempts: 10,
                  lastError: 'http_404',
                  deadLetter: true,
                }
              : { id: r.id, outcome: 'published' as const },
          ),
      ),
    );
    expect(await deliveryState(id)).toMatchObject({
      published: false,
      attempts: 10,
      due_in: null,
      leased_for: null,
    });
  });

  it('reads the due rows through the pending index, in delivery order', async () => {
    const plan = await asOutboxPublisher((p) =>
      p.begin(async (tx) => {
        // The suite's table is small, where a full read is cheapest; turned off only to show the
        // claim can use the partial index rather than walking the whole sequence index.
        await tx`set local enable_seqscan = off`;
        await tx`set local enable_bitmapscan = off`;
        const lines = await tx<{ 'QUERY PLAN': string }[]>`
          explain select id from outbox_events
           where published_at is null and dead_lettered_at is null
             and (next_attempt_at is null or next_attempt_at <= now())
             and (claimed_until is null or claimed_until <= now())
           order by sequence limit 100 for update skip locked`;
        return lines.map((l) => l['QUERY PLAN']).join('\n');
      }),
    );
    expect(plan).toMatch(/Index Scan using outbox_events_pending_idx/);
    expect(plan).not.toMatch(/Sort/);
  });
});

describe('outbox readiness (docs/03-roadmap-appendix/backend-weeks-3-5.md §4.2)', () => {
  /** A pending event written as the owner, its moments given as intervals from now. */
  async function pendingEvent(
    createdAgo: string,
    extra: { nextAttempt?: string; claimedUntil?: string; attempts?: number } = {},
  ): Promise<string> {
    const id = newId();
    await asMigrator(
      (m) => m`
        insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json,
                                   created_at, attempts, next_attempt_at, claimed_until)
        values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
                now() - ${createdAgo}::interval, ${extra.attempts ?? 0},
                now() + ${extra.nextAttempt ?? null}::interval,
                now() + ${extra.claimedUntil ?? null}::interval)`,
    );
    return id;
  }

  async function deliver(id: string): Promise<void> {
    await asMigrator(
      (m) => m`update outbox_events set published_at = now(), claimed_until = null
                where id = ${id}`,
    );
  }

  /** Readiness while one such event waits, delivered afterwards whatever the answer. */
  async function readyWith(
    createdAgo: string,
    extra: { nextAttempt?: string; claimedUntil?: string; attempts?: number } = {},
  ): Promise<'ok' | 'down'> {
    const id = await pendingEvent(createdAgo, extra);
    try {
      return await checkOutboxReady();
    } finally {
      await deliver(id);
    }
  }

  it('stays ok while old events wait out their backoff or a live lease, and reports them', async () => {
    const retrying = await pendingEvent('1 hour', { attempts: 3, nextAttempt: '10 minutes' });
    const leased = await pendingEvent('1 hour', { attempts: 1, claimedUntil: '1 minute' });
    let seen: OutboxLag | undefined;
    try {
      expect(await checkOutboxReady(300, 3_000, (lag) => (seen = lag))).toBe('ok');
      expect(seen?.retrying).toBeGreaterThanOrEqual(1);
      expect(seen?.inFlight).toBeGreaterThanOrEqual(1);
      expect(seen?.oldestPendingSeconds).toBeGreaterThanOrEqual(3_600);
      expect(seen?.oldestDueSeconds ?? 0).toBeLessThan(300);
    } finally {
      await deliver(retrying);
      await deliver(leased);
    }
  });

  it('turns down when a due event has waited more than five minutes since it became due', async () => {
    expect(await readyWith('6 minutes')).toBe('down');
    expect(await readyWith('2 hours', { attempts: 4, nextAttempt: '-6 minutes' })).toBe('down');
    expect(await readyWith('2 hours', { attempts: 1, claimedUntil: '-6 minutes' })).toBe('down');
    // Due a minute ago only: the publisher's next run takes it.
    expect(await readyWith('2 hours', { attempts: 2, nextAttempt: '-1 minute' })).toBe('ok');
  });
});

describe('a worker QStash gave up on turns its event back into a dead letter (0064)', () => {
  async function delivered(): Promise<string> {
    const [id = ''] = await seedRows(1);
    await asMigrator(
      (m) => m`update outbox_events set published_at = now(), attempts = 1 where id = ${id}`,
    );
    return id;
  }

  it('holdBackFailedEvent: a delivered event becomes a dead letter with the worker error, once', async () => {
    const id = await delivered();
    expect(await holdBackFailedEvent(id, 'worker_failed')).toBe('held');
    const row = await rowAsPublisher(id);
    expect(row).toMatchObject({ published_at: null, attempts: 1, last_error: 'worker_failed' });
    expect(row?.dead_lettered_at).toBeInstanceOf(Date);
    expect(await holdBackFailedEvent(id, 'worker_failed')).toBe('unchanged');
    expect(await holdBackFailedEvent(newId(), 'worker_refused')).toBe('unchanged');
  });

  it('allows only that change: another error, a kept backoff or a changed count is refused', async () => {
    const id = await delivered();
    const change = (set: string) =>
      failure(
        asOutboxPublisher((p) => p.unsafe(`update outbox_events set ${set} where id = $1`, [id])),
      );
    const unpublish = 'published_at = null, dead_lettered_at = now()';
    const refused = /comes back only as a dead letter from its worker/;
    expect(await change(`${unpublish}, last_error = 'queue_refused'`)).toMatch(refused);
    expect(await change('published_at = null')).toMatch(refused);
    expect(await change(`${unpublish}, last_error = 'worker_failed', attempts = 9`)).toMatch(
      refused,
    );
    expect(
      await change(`${unpublish}, last_error = 'worker_failed', next_attempt_at = now()`),
    ).toMatch(refused);
    expect((await rowAsPublisher(id))?.published_at).toEqual(expect.any(Date));
  });

  it('only the publisher may make it: the table owner may not', async () => {
    const id = await delivered();
    expect(
      await failure(
        asMigrator(
          (m) => m`update outbox_events
                      set published_at = null, dead_lettered_at = now(), last_error = 'worker_failed'
                    where id = ${id}`,
        ),
      ),
    ).toMatch(/comes back only as a dead letter from its worker/);
  });

  it('the dead letter it leaves is replayed as any other', async () => {
    const id = await delivered();
    await holdBackFailedEvent(id, 'worker_refused');
    const rows = await asPrincipal(principalFor('executive'), async ({ tx }) => {
      const answer = (await tx.execute(
        sql`select was_dead_lettered_at is not null as dead from app.replay_dead_letter(${id}::uuid)`,
      )) as unknown as { dead: boolean }[];
      return answer;
    });
    expect(rows).toEqual([{ dead: true }]);
    expect(await rowAsPublisher(id)).toMatchObject({
      published_at: null,
      attempts: 0,
      last_error: null,
      dead_lettered_at: null,
    });
    await asMigrator((m) => m`update outbox_events set published_at = now() where id = ${id}`);
  });
});
