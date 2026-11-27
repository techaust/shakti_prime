// TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §5, §6.3): the Tally mirror on real row
// security. A connector's principal reads no table and writes only through its definers, for the
// companies mapped to it; people read a company's mirror with finance.read, purchase vouchers
// only with procurement.rate.read as well, on both pools; an Executive reads the connectors, never
// their key hashes; tombstones are append-only. The role × company matrix covers every role's
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
const HASH = 'b'.repeat(64);
const NEXT_HASH = 'c'.repeat(64);

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
    await m`insert into tally_connectors (id, name, key_hash, key_hint, next_key_hash, next_key_hint, created_by)
      values (${connector}, 'tally test connector', ${HASH}, 'ab12', ${NEXT_HASH}, 'cd34', ${owner})`;
    await m`insert into tally_connectors (id, name, key_hash, key_hint, revoked_at, revoked_by, created_by)
      values (${revoked}, 'tally test revoked', ${'d'.repeat(64)}, 'ef56', now(), ${owner}, ${owner})`;
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
    await m`delete from tally_connector_companies where connector_id in (${connector}, ${revoked})`;
    await m`delete from tally_connectors where id in (${connector}, ${revoked})`;
    await m`delete from principals where id in (${connector}, ${revoked}, ${owner})`;
  });
  await closeDb();
});

describe('the connectors: an Executive reads them, never their keys', () => {
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

  it('no request role may select a key hash, or write a connector directly', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_column_privilege('app_user', 'tally_connectors', 'key_hash', 'SELECT') as uh,
             has_column_privilege('app_user', 'tally_connectors', 'next_key_hash', 'SELECT') as un,
             has_column_privilege('app_reader', 'tally_connectors', 'key_hash', 'SELECT') as rh,
             has_column_privilege('app_reader', 'tally_connectors', 'next_key_hash', 'SELECT') as rn,
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
        run(principalFor('executive', [1]), [1], sql`select key_hash from tally_connectors`),
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
      const rows = await run<{ n: number }>(
        self,
        [1, 2],
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
  });

  it('holds only tally.connector.sync, which no person’s role may hold', async () => {
    expect(SYSTEM_MATRIX['system:tally_connector']).toEqual([
      { key: 'tally.connector.sync', scope: 'entity' },
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
    const rows = await run<{ key_hash: string; next_key_hash: string; entity_id: number }>(
      self,
      [],
      sql`select key_hash, next_key_hash, entity_id from app.tally_connector_auth(${connector}::uuid) order by entity_id`,
    );
    expect(rows.map((r) => r.entity_id)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ key_hash: HASH, next_key_hash: NEXT_HASH });
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
          guid_count, live, tombstoned, missing, reappeared, state)
        values (${snapshot}, 1, ${COMPANY_1}, ${connector}, now(), '2026-04-01', 0, 0, 1, 0, 0, 'applied')`;
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
