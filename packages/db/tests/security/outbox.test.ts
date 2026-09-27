import { newId } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimOutbox, closeOutboxDb, outboxLag } from '../../src/outbox-client';
import type { OutboxRow } from '../../src/outbox-types';
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

describe('the application role writes events and nothing else (docs/DATABASE.md §5)', () => {
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

describe('the outbox publisher role (docs/DATABASE.md §3)', () => {
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

describe('claimOutbox (docs/design/backend-weeks-3-5.md §4.2)', () => {
  it('claims pending events in delivery order and applies each outcome', async () => {
    const [published, failed, dead] = await seedRows(3);
    let seen: readonly OutboxRow[] = [];
    await claimOutbox(500, (rows) => {
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

    const runA = claimOutbox(500, async (rows) => {
      first = rows.map((r) => r.id);
      started();
      await held;
      return publishOurs(rows);
    });
    await claimedFirst;
    await claimOutbox(500, (rows) => {
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
      claimOutbox(500, () => Promise.resolve([{ id: newId(), outcome: 'published' as const }])),
    ).rejects.toThrow(/did not claim/);
    expect(await rowAsPublisher(id ?? '')).toMatchObject({ published_at: null, attempts: 0 });
    await claimOutbox(500, (rows) =>
      Promise.resolve(
        rows.filter((r) => r.id === id).map((r) => ({ id: r.id, outcome: 'published' as const })),
      ),
    );
  });

  it('reports how long the oldest pending event has waited', async () => {
    await seedRows(1);
    const lag = await outboxLag();
    expect(lag.oldestPendingSeconds).not.toBeNull();
    await claimOutbox(500, (rows) =>
      Promise.resolve(
        rows
          .filter((r) => r.aggregateType === TAG)
          .map((r) => ({ id: r.id, outcome: 'published' as const })),
      ),
    );
  });
});
