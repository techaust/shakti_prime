// TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §5, §6.3): the Tally mirror on real row
// security. A connector's principal reads no table and writes only through its definers, for the
// companies mapped to it; people read a company's mirror with finance.read, purchase vouchers
// only with procurement.rate.read as well, on both pools; an Executive reads the connectors, never
// their sealed keys; tombstones are append-only. The role × company matrix covers every role's
// reads of a company's rows (role-entity-matrix.test.ts).
import {
  hasGrant,
  newId,
  type Principal,
  ROLE_KEYS,
  type RoleKey,
  SYSTEM_MATRIX,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  closeDb,
  CONNECTOR_TABLES,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

const RUN = newId().slice(-8);
const COMPANY_1 = `TC2 ${RUN} one`;
const COMPANY_2 = `TC2 ${RUN} two`;
// Stand-ins for sealed keys: the database stores the envelope and never opens it.
const SEALED = { v: 1, keyId: 'local', ciphertext: 'current' };
const NEXT_SEALED = { v: 1, keyId: 'local', ciphertext: 'next' };

const connector = newId();
const revoked = newId();
const owner = newId();
const guid = (n: number): string => `0a0b0c0d-1e2f-4a5b-8c9d-${RUN}0000-${n.toString(16)}`;

const TALLY_TABLES = [
  'tally_connector_companies',
  'tally_cursors',
  'tally_vouchers',
  'tally_purchase_vouchers',
  'tally_ledgers',
  'tally_snapshots',
  'tally_voucher_tombstones',
  'tally_refused_rows',
] as const;

/** A connector's principal, as the routes build it. */
function connectorPrincipal(id: string, entityIds: number[]): Principal {
  return {
    id,
    kind: 'system',
    roleKey: 'system:tally_connector',
    entityIds,
    permissions: [...SYSTEM_MATRIX['system:tally_connector']],
  };
}

/** The database's own error code, whether thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const code = (cause as { code?: unknown }).code;
    return typeof code === 'string' ? code : 'unknown';
  }
  throw new Error('expected the statement to fail');
}

function run<T = Record<string, unknown>>(
  principal: Principal,
  entityIds: number[],
  query: SQL,
  reader = false,
): Promise<T[]> {
  return withRequestContext(
    principal,
    { entityIds },
    async ({ tx }) => (await tx.execute(query)) as unknown as T[],
    reader ? { reader: true, readOnly: true } : {},
  );
}

const voucher = (n: number, type: string, alterId: number, state = 'received') => ({
  id: newId(),
  guid: guid(n),
  alter_id: alterId,
  type,
  type_name: type,
  voucher_no: `TC2/${n.toString()}`,
  voucher_date: '2026-09-27',
  party_name: 'Tally test party',
  party_gstin: null,
  buyer_order_no: null,
  amount: '100.00',
  is_cancelled: false,
  is_optional: false,
  payload: { ledgerEntries: [], inventoryEntries: [] },
  state,
});

const write = (entity: number, company: string, rows: unknown[]): SQL =>
  sql`select app.tally_vouchers_write(${entity}::smallint, ${company}::text, ${JSON.stringify(rows)}::jsonb) as n`;

beforeAll(async () => {
  await asMigrator(async (m) => {
    await m`insert into principals (id, kind, display_name) values (${owner}, 'user', 'tally test owner')`;
    for (const [id, name] of [
      [connector, 'tally test connector'],
      [revoked, 'tally test revoked'],
    ] as const) {
      await m`insert into principals (id, kind, display_name) values (${id}, 'system', ${name})`;
    }
    await m`insert into tally_connectors (id, name, key_sealed, key_hint, next_key_sealed, next_key_hint, created_by)
      values (${connector}, 'tally test connector', ${m.json(SEALED)}, 'ab12', ${m.json(NEXT_SEALED)}, 'cd34', ${owner})`;
    await m`insert into tally_connectors (id, name, key_sealed, key_hint, revoked_at, revoked_by, created_by)
      values (${revoked}, 'tally test revoked', ${m.json(SEALED)}, 'ef56', now(), ${owner}, ${owner})`;
    await m`insert into tally_connector_companies (connector_id, tally_company, entity_id, created_by) values
      (${connector}, ${COMPANY_1}, 1, ${owner}), (${connector}, ${COMPANY_2}, 2, ${owner}),
      (${revoked}, ${`${COMPANY_1} old`}, 1, ${owner})`;
  });
  // The connector writes company 1's mirror through its definers: a sale and a purchase.
  const self = connectorPrincipal(connector, [1, 2]);
  await run(self, [1], write(1, COMPANY_1, [voucher(1, 'sales', 5), voucher(2, 'purchase', 6)]));
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from tally_vouchers where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_purchase_vouchers where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_cursors where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_refused_rows where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_snapshots where connector_id in (${connector}, ${revoked}) and state = 'receiving'`;
    await m`delete from tally_connector_companies where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_connectors where id in (${connector}, ${revoked})`;
    await m`delete from principals where id in (${connector}, ${revoked}, ${owner})`;
  });
  await closeDb();
});

describe('the connectors: an Executive reads them, never their sealed keys', () => {
  it.each(CONNECTOR_TABLES)('%s returns no row without a request context', async (table) => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    expect(row?.n).toBe(0);
  });

  it('an Executive whose request names no company reads none', async () => {
    const rows = await run<{ n: number }>(
      principalFor('executive', []),
      [],
      sql`select count(*)::int as n from tally_connectors where id = ${connector}`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it.each(ROLE_KEYS)(
    '%s reads them exactly when it holds admin.integrations.write',
    async (role) => {
      const principal = principalFor(role, [1]);
      const holds = hasGrant(principal.permissions, 'admin.integrations.write', 'all');
      for (const reader of [false, true]) {
        const rows = await run<{ n: number }>(
          principal,
          [1],
          sql`select count(*)::int as n from tally_connectors where id = ${connector}`,
          reader,
        );
        expect(rows[0]?.n).toBe(holds ? 1 : 0);
      }
    },
  );

  it('no request role may select a sealed key, or write a connector directly', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_column_privilege('app_user', 'tally_connectors', 'key_sealed', 'SELECT') as uh,
             has_column_privilege('app_user', 'tally_connectors', 'next_key_sealed', 'SELECT') as un,
             has_column_privilege('app_reader', 'tally_connectors', 'key_sealed', 'SELECT') as rh,
             has_column_privilege('app_reader', 'tally_connectors', 'next_key_sealed', 'SELECT') as rn,
             has_column_privilege('app_user', 'tally_connectors', 'key_hint', 'SELECT') as hint,
             has_table_privilege('app_user', 'tally_connectors', 'INSERT, UPDATE, DELETE') as w,
             has_table_privilege('app_reader', 'tally_connectors', 'INSERT, UPDATE, DELETE') as rw,
             has_any_column_privilege('readonly_reporter', 'tally_connectors', 'SELECT') as rep
    `);
    expect(row).toEqual({
      uh: false,
      un: false,
      rh: false,
      rn: false,
      hint: true,
      w: false,
      rw: false,
      rep: false,
    });
    expect(
      await failure(
        run(principalFor('executive', [1]), [1], sql`select key_sealed from tally_connectors`),
      ),
    ).toBe('42501');
  });
});

describe('a connector principal reads no table', () => {
  it.each([false, true])(
    'reads none of the mirror of its own company (reader pool: %s)',
    async (reader) => {
      const self = connectorPrincipal(connector, [1, 2]);
      for (const table of [...TALLY_TABLES, ...CONNECTOR_TABLES]) {
        const rows = await run<{ n: number }>(
          self,
          [1],
          sql`select count(*)::int as n from ${sql.identifier(table)}`,
          reader,
        );
        expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
      }
    },
  );

  it('reads no customer, lead, order, cost, rate, file or audit row of its companies', async () => {
    // A company's logo and letterhead are read by every principal acting in it (0062), as the
    // role × company matrix shows for every role; no other file is.
    const query = (table: string): SQL =>
      table === 'files'
        ? sql`select count(*)::int as n from files where purpose not in ('entity_logo', 'letterhead')`
        : sql`select count(*)::int as n from ${sql.identifier(table)}`;
    const self = connectorPrincipal(connector, [1, 2]);
    for (const table of [
      'accounts',
      'contacts',
      'opportunities',
      'quotes',
      'sales_orders',
      'item_costs',
      'vendor_quotes',
      'files',
      'audit_logs',
      'dealer_outstanding',
    ]) {
      const rows = await run<{ n: number }>(self, [1, 2], query(table));
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
  });

  it('holds only tally.connector.sync, which no person’s role may hold', async () => {
    expect(SYSTEM_MATRIX['system:tally_connector']).toEqual([
      { key: 'tally.connector.sync', scope: 'all' },
    ]);
    const [row] = await withoutContext<{ only: boolean; staff: boolean }>(sql`
      select 'tally.connector.sync' = any (app.platform_only_permissions()) as only,
             app.role_may_hold('accounts', 'tally.connector.sync') as staff`);
    expect(row).toEqual({ only: true, staff: false });
  });
});

describe('the connector definers check the connector and its mapping', () => {
  it('a connector reads its own keys and companies, and nobody else’s', async () => {
    const self = connectorPrincipal(connector, []);
    const rows = await run<{ key_sealed: unknown; next_key_sealed: unknown; entity_id: number }>(
      self,
      [],
      sql`select key_sealed, next_key_sealed, entity_id from app.tally_connector_auth(${connector}::uuid) order by entity_id`,
    );
    expect(rows.map((r) => r.entity_id)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ key_sealed: SEALED, next_key_sealed: NEXT_SEALED });
    expect(
      await failure(run(self, [], sql`select * from app.tally_connector_auth(${revoked}::uuid)`)),
    ).toBe('42501');
    expect(
      await failure(
        run(
          principalFor('executive', [1]),
          [1],
          sql`select * from app.tally_connector_auth(${connector}::uuid)`,
        ),
      ),
    ).toBe('42501');
  });

  it('a revoked connector is found by nobody, itself included', async () => {
    const self = connectorPrincipal(revoked, []);
    expect(
      await run(self, [], sql`select * from app.tally_connector_auth(${revoked}::uuid)`),
    ).toEqual([]);
    expect(
      await failure(
        run(
          connectorPrincipal(revoked, [1]),
          [1],
          write(1, `${COMPANY_1} old`, [voucher(9, 'sales', 1)]),
        ),
      ),
    ).toBe('42501');
  });

  it('refuses a company not mapped to the connector, or one outside the request', async () => {
    const self = connectorPrincipal(connector, [1, 2, 3]);
    // Company 3 is mapped to no connector of this test.
    expect(
      await failure(
        run(self, [3], sql`select * from app.tally_cursor(3::smallint, ${COMPANY_1}::text)`),
      ),
    ).toBe('42501');
    // Company 1's Tally company named for company 2.
    expect(await failure(run(self, [2], write(2, COMPANY_1, [voucher(10, 'sales', 1)])))).toBe(
      '42501',
    );
    // Mapped, but the request is for company 2 only.
    expect(await failure(run(self, [2], write(1, COMPANY_1, [voucher(11, 'sales', 1)])))).toBe(
      '42501',
    );
  });

  it('refuses a person, an agent, the workers and a connector role with no connector row', async () => {
    const people: Principal[] = [
      principalFor('executive', [1]),
      principalFor('accounts', [1]),
      principalFor('agent:chief', [1]),
      principalFor('system:workers', [1]),
      // The role and grant without a registered connector of this id.
      connectorPrincipal(newId(), [1]),
      // A worker given the connector's grant.
      {
        ...principalFor('system:workers', [1]),
        permissions: [{ key: 'tally.connector.sync', scope: 'entity' }],
      },
    ];
    for (const principal of people) {
      expect(
        await failure(run(principal, [1], write(1, COMPANY_1, [voucher(12, 'sales', 1)]))),
        principal.roleKey,
      ).toBe('42501');
      expect(
        await failure(
          run(
            principal,
            [1],
            sql`select app.tally_cursor_move(1::smallint, ${COMPANY_1}::text, 99::bigint)`,
          ),
        ),
        principal.roleKey,
      ).toBe('42501');
    }
  });

  it('keeps the newest AlterID of a GUID and refuses a GUID of another company', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const older = { ...voucher(1, 'sales', 4), voucher_no: 'TC2/older' };
    const newer = { ...voucher(1, 'sales', 8), voucher_no: 'TC2/newer' };
    const [kept] = await run<{ n: number }>(self, [1], write(1, COMPANY_1, [older]));
    expect(kept?.n).toBe(0);
    const [changed] = await run<{ n: number }>(self, [1], write(1, COMPANY_1, [newer]));
    expect(changed?.n).toBe(1);
    const [row] = await asMigrator(
      (m) => m<{ voucher_no: string; alter_id: string }[]>`
        select voucher_no, alter_id from tally_vouchers where guid = ${guid(1)}`,
    );
    expect(row).toEqual({ voucher_no: 'TC2/newer', alter_id: '8' });
    expect(await failure(run(self, [2], write(2, COMPANY_2, [voucher(1, 'sales', 20)])))).toBe(
      '23505',
    );
  });

  it('moves a cursor forward only', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    await run(
      self,
      [2],
      sql`select * from app.tally_cursor_lock(2::smallint, ${COMPANY_2}::text, ${newId()}::uuid)`,
    );
    await run(
      self,
      [2],
      sql`select app.tally_cursor_move(2::smallint, ${COMPANY_2}::text, 50::bigint)`,
    );
    expect(
      await failure(
        run(
          self,
          [2],
          sql`select app.tally_cursor_move(2::smallint, ${COMPANY_2}::text, 49::bigint)`,
        ),
      ),
    ).toBe('23514');
    const [cursor] = await run<{ last_alter_id: string }>(
      self,
      [2],
      sql`select last_alter_id from app.tally_cursor(2::smallint, ${COMPANY_2}::text)`,
    );
    expect(cursor?.last_alter_id).toBe('50');
  });
});

type Pool = 'app_user' | 'app_reader';

describe.each(['app_user', 'app_reader'] as Pool[])(
  'purchase vouchers per role on the %s pool',
  (pool) => {
    const holds = (role: RoleKey, key: 'finance.read' | 'procurement.rate.read') =>
      hasGrant(principalFor(role).permissions, key, 'entity');

    it.each(ROLE_KEYS)(
      '%s reads the sale with finance.read and the purchase with the rate grant too',
      async (role) => {
        const principal = principalFor(role, [1]);
        const seen = async (table: string) =>
          (
            await run<{ n: number }>(
              principal,
              [1],
              sql`select count(*)::int as n from ${sql.identifier(table)} where guid in (${guid(1)}, ${guid(2)})`,
              pool === 'app_reader',
            )
          )[0]?.n;
        expect(await seen('tally_vouchers')).toBe(holds(role, 'finance.read') ? 1 : 0);
        expect(await seen('tally_purchase_vouchers')).toBe(
          holds(role, 'finance.read') && holds(role, 'procurement.rate.read') ? 1 : 0,
        );
      },
    );

    it('a holder acting in another company reads none of company 1’s', async () => {
      const rows = await run<{ n: number }>(
        principalFor('accounts', [2]),
        [2],
        sql`select (select count(*) from tally_vouchers where guid = ${guid(1)})
                 + (select count(*) from tally_purchase_vouchers where guid = ${guid(2)}) as n`,
        pool === 'app_reader',
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  },
);

describe('tombstones are append-only', () => {
  it('refuses a delete and any change but setting the reversal once', async () => {
    const snapshot = newId();
    const tombstone = newId();
    await asMigrator(async (m) => {
      await m`insert into tally_snapshots (id, entity_id, tally_company, connector_id, as_of, from_date,
          guid_count, live, tombstoned, missing, reappeared, state, compared_at)
        values (${snapshot}, 1, ${COMPANY_1}, ${connector}, now(), '2026-04-01', 0, 0, 1, 0, 0, 'applied', now())`;
      await m`insert into tally_voucher_tombstones (id, entity_id, voucher_guid, voucher_type, snapshot_id, detected_at)
        values (${tombstone}, 1, ${guid(30)}, 'sales', ${snapshot}, now())`;
    });
    const tryAs = (
      statement: (m: Parameters<Parameters<typeof asMigrator>[0]>[0]) => Promise<unknown>,
    ) => failure(asMigrator(statement));
    expect(
      await tryAs((m) => m`delete from tally_voucher_tombstones where id = ${tombstone}`),
    ).toBe('42501');
    expect(
      await tryAs(
        (m) => m`update tally_voucher_tombstones set voucher_guid = 'x' where id = ${tombstone}`,
      ),
    ).toBe('42501');
    await asMigrator(
      (m) =>
        m`update tally_voucher_tombstones set reversal_applied_at = now() where id = ${tombstone}`,
    );
    expect(
      await tryAs(
        (m) =>
          m`update tally_voucher_tombstones set reversal_applied_at = now() where id = ${tombstone}`,
      ),
    ).toBe('42501');
    const [grant] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'tally_voucher_tombstones', 'INSERT, UPDATE, DELETE') as w`);
    expect(grant).toEqual({ w: false });
    await asMigrator(async (m) => {
      await m`alter table tally_voucher_tombstones disable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_voucher_tombstones where id = ${tombstone}`;
      await m`alter table tally_voucher_tombstones enable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_snapshots where id = ${snapshot}`;
    });
  });
});

describe('refused rows, snapshot parts, the heartbeat and the alerts, through their definers', () => {
  it('a refused later version marks the stored one not current until a later version arrives', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    await run(self, [1], write(1, COMPANY_1, [voucher(40, 'sales', 41)]));
    const refused = [
      {
        id: newId(),
        kind: 'voucher',
        guid: guid(40),
        alter_id: 45,
        reason: 'connector_refused',
        field: 'partyGstin',
      },
    ];
    await run(
      self,
      [1],
      sql`select app.tally_refused_write(1::smallint, ${COMPANY_1}::text, ${JSON.stringify(refused)}::jsonb)`,
    );
    const state = () =>
      asMigrator(
        (m) => m<{ refused: boolean; resolved: boolean | null }[]>`
          select v.refused_at is not null as refused,
                 (select f.resolved_at is not null from tally_refused_rows f
                   where f.guid = v.guid and f.entity_id = 1) as resolved
            from tally_vouchers v where v.guid = ${guid(40)}`,
      );
    expect((await state())[0]).toEqual({ refused: true, resolved: false });
    await run(self, [1], write(1, COMPANY_1, [voucher(40, 'sales', 50)]));
    expect((await state())[0]).toEqual({ refused: false, resolved: true });
    // Only the connector writes them, and a person reads them with finance.read.
    expect(
      await failure(
        run(
          principalFor('accounts', [1]),
          [1],
          sql`select app.tally_refused_write(1::smallint, ${COMPANY_1}::text, '[]'::jsonb)`,
        ),
      ),
    ).toBe('42501');
  });

  it("keeps a snapshot's parts until the last, each part once, and refuses a part of another", async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const partsOf = newId();
    const asOf = '2026-11-20T00:00:00.000Z';
    const part = (n: number, guids: string[], parts = 2, at = asOf) =>
      run<{ snapshot_id: string; complete: boolean; guids: string[] }>(
        self,
        [2],
        sql`select snapshot_id, complete, guids from app.tally_snapshot_part(${newId()}::uuid,
              2::smallint, ${COMPANY_2}::text, ${at}::timestamptz, '2026-04-01'::date,
              ${partsOf}::uuid, ${n}::smallint, ${parts}::smallint,
              ${`{${guids.join(',')}}`}::text[])`,
      );
    const [first] = await part(1, [guid(60), guid(61)]);
    expect(first).toMatchObject({ complete: false, guids: [] });
    const [again] = await part(1, [guid(60), guid(61)]);
    expect(again?.snapshot_id).toBe(first?.snapshot_id);
    expect(await failure(part(2, [guid(62)], 3))).toBe('23514');
    expect(await failure(part(2, [guid(62)], 2, '2026-11-21T00:00:00.000Z'))).toBe('23514');
    const [last] = await part(2, [guid(62)]);
    expect(last?.complete).toBe(true);
    expect([...(last?.guids ?? [])].sort()).toEqual([guid(60), guid(61), guid(62)].sort());
  });

  it('drops a snapshot still receiving a day after it began', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const stale = newId();
    const begin = (partsOf: string) =>
      run<{ snapshot_id: string }>(
        self,
        [2],
        sql`select snapshot_id from app.tally_snapshot_part(${newId()}::uuid, 2::smallint,
              ${COMPANY_2}::text, now(), '2026-04-01'::date, ${partsOf}::uuid, 1::smallint,
              2::smallint, '{}'::text[])`,
      );
    const [old] = await begin(stale);
    await asMigrator(
      (m) =>
        m`update tally_snapshots set created_at = now() - interval '25 hours' where id = ${old?.snapshot_id ?? ''}`,
    );
    await begin(newId());
    const [left] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from tally_snapshots where id = ${old?.snapshot_id ?? ''}`,
    );
    expect(left?.n).toBe(0);
  });

  it("records held rows with when the stretch began, and the companies' Tally counters", async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const beat = (held: number | null) =>
      run(
        self,
        [1, 2],
        sql`select app.tally_heartbeat_write('1.0.0', 'TallyPrime', 0, ${held}::integer,
              ${JSON.stringify([
                {
                  name: COMPANY_1,
                  last_alter_id: 10,
                  reachable: true,
                  tally_last_alter_id: 25,
                  problem: 'waiting_on_bos',
                },
              ])}::jsonb)`,
      );
    const read = () =>
      asMigrator(
        (m) => m<{ held_rows: number | null; held: boolean; tla: string; problem: string }[]>`
          select c.held_rows, c.held_since is not null as held, m.tally_last_alter_id as tla, m.problem
            from tally_connectors c join tally_connector_companies m on m.connector_id = c.id
           where c.id = ${connector} and m.tally_company = ${COMPANY_1}`,
      );
    await beat(3);
    expect((await read())[0]).toEqual({
      held_rows: 3,
      held: true,
      tla: '25',
      problem: 'waiting_on_bos',
    });
    // An older connector sends no count: what was recorded stays.
    await beat(null);
    expect((await read())[0]).toMatchObject({ held_rows: 3, held: true });
    await beat(0);
    expect((await read())[0]).toMatchObject({ held_rows: 0, held: false });
  });

  it('lets only the jobs check read the alert facts and record an alert', async () => {
    const workers = principalFor('system:workers', []);
    const rows = await run<{ connector_id: string }>(
      workers,
      [],
      sql`select connector_id from app.tally_connector_alerts()`,
      true,
    );
    expect(rows.map((r) => r.connector_id)).toContain(connector);
    expect(rows.map((r) => r.connector_id)).not.toContain(revoked);
    const [ok] = await run<{ ok: boolean }>(
      workers,
      [],
      sql`select app.tally_connector_alerted(${connector}::uuid, 'silent') as ok`,
    );
    expect(ok?.ok).toBe(true);
    for (const principal of [
      principalFor('executive', [1]),
      connectorPrincipal(connector, [1]),
      principalFor('agent:chief', [1]),
    ]) {
      expect(
        await failure(run(principal, [1], sql`select * from app.tally_connector_alerts()`)),
        principal.roleKey,
      ).toBe('42501');
      expect(
        await failure(
          run(
            principal,
            [1],
            sql`select app.tally_connector_alerted(${connector}::uuid, 'silent')`,
          ),
        ),
        principal.roleKey,
      ).toBe('42501');
    }
  });
});

describe('the second checks behind a batch and a snapshot (the fix round)', () => {
  const ledger = (n: number, alterId: number) => ({
    id: newId(),
    guid: guid(n),
    alter_id: alterId,
    name: 'Tally test party',
    parent: 'Sundry Debtors',
    gstin: null,
    opening_balance: '0.00',
    closing_balance: '100.00',
    as_of: '2026-09-27',
  });
  const writeLedgers = (entity: number, company: string, rows: unknown[]): SQL =>
    sql`select app.tally_ledgers_write(${entity}::smallint, ${company}::text, ${JSON.stringify(rows)}::jsonb) as n`;

  it("names to the company's connector the GUIDs another company holds, and to nobody else", async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const elsewhere = (entity: number, company: string, kind: string) =>
      run<{ guid: string }>(
        self,
        [entity],
        sql`select guid from app.tally_guids_elsewhere(${entity}::smallint, ${company}::text,
              ${kind}::text, ${`{${guid(1)},${guid(2)},${guid(99)}}`}::text[]) as guid`,
      );
    expect((await elsewhere(2, COMPANY_2, 'voucher')).map((r) => r.guid).sort()).toEqual(
      [guid(1), guid(2)].sort(),
    );
    expect(await elsewhere(1, COMPANY_1, 'voucher')).toEqual([]);
    expect(await elsewhere(2, COMPANY_2, 'ledger')).toEqual([]);
    expect(
      await failure(
        run(
          principalFor('accounts', [2], { id: owner }),
          [2],
          sql`select * from app.tally_guids_elsewhere(2::smallint, ${COMPANY_2}::text, 'voucher', '{}'::text[])`,
        ),
      ),
    ).toBe('42501');
  });

  it('refuses a voucher stored in both tables and a ledger of another company, after the writes', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    // guid(1) is company 1's sale: the same company sending it as a purchase is refused.
    expect(await failure(run(self, [1], write(1, COMPANY_1, [voucher(1, 'purchase', 90)])))).toBe(
      '23514',
    );
    await run(self, [1], writeLedgers(1, COMPANY_1, [ledger(80, 3)]));
    expect(await failure(run(self, [2], writeLedgers(2, COMPANY_2, [ledger(80, 9)])))).toBe(
      '23505',
    );
    const [row] = await asMigrator(
      (m) => m<{ entity_id: number; alter_id: string }[]>`
        select entity_id, alter_id from tally_ledgers where guid = ${guid(80)}`,
    );
    expect(row).toEqual({ entity_id: 1, alter_id: '3' });
    await asMigrator((m) => m`delete from tally_ledgers where guid = ${guid(80)}`);
  });

  it("marks only a held snapshot's GUIDs when a person confirms it", async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    await run(self, [1], write(1, COMPANY_1, [voucher(70, 'sales', 70), voucher(71, 'sales', 71)]));
    const snapshot = newId();
    await asMigrator(
      (m) => m`insert into tally_snapshots (id, entity_id, tally_company, connector_id, as_of,
          from_date, guid_count, live, tombstoned, missing, reappeared, state, held_guids, compared_at)
        values (${snapshot}, 1, ${COMPANY_1}, ${connector}, now() + interval '1 minute',
          '2026-04-01', 0, 2, 0, 0, 0, 'held', ${`{${guid(70)}}`}::text[], now())`,
    );
    const [done] = await run<{ n: number }>(
      principalFor('accounts', [1], { id: owner }),
      [1],
      sql`select app.tally_tombstone(${snapshot}::uuid, ${`{${guid(70)},${guid(71)}}`}::text[],
            ${`{${newId()},${newId()}}`}::uuid[]) as n`,
    );
    expect(done?.n).toBe(1);
    const states = await asMigrator(
      (m) => m<{ guid: string; state: string }[]>`
        select guid, state from tally_vouchers where guid in (${guid(70)}, ${guid(71)}) order by guid`,
    );
    expect(Object.fromEntries(states.map((s) => [s.guid, s.state]))).toEqual({
      [guid(70)]: 'tombstoned',
      [guid(71)]: 'received',
    });
    await asMigrator(async (m) => {
      await m`alter table tally_voucher_tombstones disable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_voucher_tombstones where snapshot_id = ${snapshot}`;
      await m`alter table tally_voucher_tombstones enable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_snapshots where id = ${snapshot}`;
    });
  });

  it('lets the connector tombstone only for the snapshot it compared in the same transaction', async () => {
    const self = connectorPrincipal(connector, [1, 2]);
    const earlier = newId();
    await asMigrator(
      (m) => m`insert into tally_snapshots (id, entity_id, tally_company, connector_id, as_of,
          from_date, guid_count, live, tombstoned, missing, reappeared, state, compared_at)
        values (${earlier}, 1, ${COMPANY_1}, ${connector}, now(), '2026-04-01', 0, 0, 0, 0, 0,
          'applied', now() - interval '1 hour')`,
    );
    const tombstone = (id: string) =>
      sql`select app.tally_tombstone(${id}::uuid, ${`{${guid(71)}}`}::text[], ${`{${newId()}}`}::uuid[]) as n`;
    expect(await failure(run(self, [1], tombstone(earlier)))).toBe('42501');
    const now = newId();
    const marked = await withRequestContext(self, { entityIds: [1] }, async ({ tx }) => {
      await tx.execute(sql`select app.tally_snapshot_write(${now}::uuid, 1::smallint,
          ${COMPANY_1}::text, now() + interval '1 minute', '2026-04-01'::date, 0, 1, 1, 0, 0,
          'applied', '{}'::text[], '{}'::text[])`);
      return (await tx.execute(tombstone(now))) as unknown as { n: number }[];
    });
    expect(marked[0]?.n).toBe(1);
    await asMigrator(async (m) => {
      await m`alter table tally_voucher_tombstones disable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_voucher_tombstones where snapshot_id in (${earlier}, ${now})`;
      await m`alter table tally_voucher_tombstones enable trigger tally_voucher_tombstones_append_only`;
      await m`delete from tally_snapshots where id in (${earlier}, ${now})`;
    });
  });
});
