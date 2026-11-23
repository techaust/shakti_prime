// U1 vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3): the vendor master is
// read acting in any company with inventory.stock.read or procurement.po.write and written only
// with procurement.po.write; supplier quotes are read only with procurement.rate.read, a company's
// quote only acting in that company, and written only with both procurement.rate.read and
// procurement.po.write in the quote's company (every company for a group quote). Every check runs
// as app_user under real row security, and the reads again on the app_reader pool.
import { hasGrant, newId, type Principal, ROLE_KEYS, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

const P = '01990000-0000-7000-8000-0000000d';
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const like = `${P}%`;

const OWNER = id(0x0001);
const ITEM = id(0x0002);
const VENDOR = id(0x0003);
const CONTACT = id(0x0004);
const LINK = id(0x0005);
const GROUP_QUOTE = id(0x0006);
/** A live quote of each company. */
const quoteOf = (e: number): string => id(0x0100 | e);
/** A second quote of company 1, which the withdrawal tests use up. */
const SPARE_QUOTE = id(0x0201);

async function removeFixture(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from vendor_quotes where id::text like ${like} or vendor_id::text like ${like}`;
      await tx`delete from item_vendors where id::text like ${like} or vendor_id::text like ${like}`;
      await tx`delete from vendor_contacts where vendor_id::text like ${like}`;
      await tx`delete from vendors where id::text like ${like} or name like 'vendors-suite %'`;
      await tx`delete from items where id::text like ${like}`;
    }),
  );
}

beforeAll(async () => {
  await removeFixture();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into principals (id, kind, display_name)
        values (${OWNER}, 'user', 'vendors suite person') on conflict (id) do nothing`;
      await tx`insert into items (id, sku, name, category, hsn, unit)
        values (${ITEM}, 'FX-VENDORS', 'vendors suite item', 'cable', '8544', 'metre')`;
      await tx`insert into vendors (id, name, gstin, state_code, pan, created_by)
        values (${VENDOR}, 'vendors suite supplier', '08ABCDE1234F1Z5', '08', 'ABCDE1234F', ${OWNER})`;
      await tx`insert into vendor_contacts (id, vendor_id, name, phone_e164, position, created_by)
        values (${CONTACT}, ${VENDOR}, 'vendors suite person', '+919800000001', 1, ${OWNER})`;
      await tx`insert into item_vendors (id, item_id, vendor_id, vendor_item_code, is_preferred, created_by)
        values (${LINK}, ${ITEM}, ${VENDOR}, 'VS-1', true, ${OWNER})`;
      await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by)
        values (${GROUP_QUOTE}, ${VENDOR}, ${ITEM}, null, 41.5000, '2026-01-01', '2099-12-31', ${OWNER})`;
      for (const e of ALL_ENTITY_IDS) {
        await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by)
          values (${quoteOf(e)}, ${VENDOR}, ${ITEM}, ${e}, ${40 + e}, '2026-01-01', '2099-12-31', ${OWNER})`;
      }
      await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by)
        values (${SPARE_QUOTE}, ${VENDOR}, ${ITEM}, 1, 39.0000, '2026-01-01', '2099-12-31', ${OWNER})`;
    }),
  );
});

afterAll(async () => {
  await removeFixture();
  await closeDb();
});

type Pool = 'app_user' | 'app_reader';
const POOLS: Pool[] = ['app_user', 'app_reader'];

/** The fixture ids of `table` that `principal` reads, on the given pool. */
async function visible(principal: Principal, table: string, pool: Pool): Promise<string[]> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select id::text as id from ${sql.identifier(table)}
             where id::text like ${like} order by id`,
      )) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    },
    { reader: pool === 'app_reader' },
  );
}

/** Rows a statement wrote as `principal` on app_user, or the error that refused it. */
async function attempt(principal: Principal, statement: SQL): Promise<number | Error> {
  try {
    return await withRequestContext(principal, {}, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      return rows.length;
    });
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

const causeOf = (e: number | Error): string =>
  e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : '';
const refusedByPolicy = (e: number | Error) => causeOf(e).includes('row-level security');
const refusedByPrivilege = (e: number | Error) => causeOf(e).includes('permission denied');

const holds = (role: RoleKey, key: 'procurement.rate.read' | 'procurement.po.write') =>
  hasGrant(principalFor(role).permissions, key, 'entity');
const readsVendors = (role: RoleKey) => {
  const grants = principalFor(role).permissions;
  return (
    hasGrant(grants, 'inventory.stock.read', 'own') ||
    hasGrant(grants, 'procurement.po.write', 'entity')
  );
};

const insertQuote = (entity: number | null, recordedBy: string): SQL =>
  sql`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by)
      values (${id(0x0300)}, ${VENDOR}, ${ITEM}, ${entity}, 12.5000, '2026-01-01', '2099-12-31', ${recordedBy})
      returning id`;

describe('supplier quotes are read only with procurement.rate.read', () => {
  it('only the Executive, the Inventory Manager and Accounts hold the grant, and no agent', () => {
    const holders = ROLE_KEYS.filter((r) => holds(r, 'procurement.rate.read')).sort();
    expect(holders).toEqual(['accounts', 'executive', 'inventory_manager']);
  });

  describe.each(POOLS)('on the %s pool', (pool) => {
    it.each(ROLE_KEYS)(
      '%s acting in company 1 reads the group quote and company 1 only, or nothing',
      async (role) => {
        const seen = await visible(principalFor(role, [1]), 'vendor_quotes', pool);
        const expected = holds(role, 'procurement.rate.read')
          ? [GROUP_QUOTE, quoteOf(1), SPARE_QUOTE].sort()
          : [];
        expect(seen).toEqual(expected);
      },
    );

    it.each(ALL_ENTITY_IDS)(
      'a holder acting in company %i never reads another company’s quote',
      async (e) => {
        for (const role of ['inventory_manager', 'accounts', 'executive'] as const) {
          const seen = await visible(principalFor(role, [e]), 'vendor_quotes', pool);
          const companyQuotes = ALL_ENTITY_IDS.filter((o) => o !== e).map(quoteOf);
          expect(
            seen.filter((q) => companyQuotes.includes(q) || (e !== 1 && q === SPARE_QUOTE)),
          ).toEqual([]);
          expect(seen).toContain(quoteOf(e));
          expect(seen).toContain(GROUP_QUOTE);
        }
      },
    );

    it('a holder acting in every company reads every quote', async () => {
      const seen = await visible(principalFor('inventory_manager'), 'vendor_quotes', pool);
      expect(seen).toEqual([GROUP_QUOTE, SPARE_QUOTE, ...ALL_ENTITY_IDS.map(quoteOf)].sort());
    });

    it('a holder with no company in the request reads no quote, not even the group’s', async () => {
      expect(await visible(principalFor('executive', []), 'vendor_quotes', pool)).toEqual([]);
    });
  });

  it('reads nothing without a request context', async () => {
    const rows = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from vendor_quotes`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('the reporting role holds no privilege on supplier quotes at all', async () => {
    const [row] = await withoutContext<{ any: boolean }>(
      sql`select has_any_column_privilege('readonly_reporter', 'vendor_quotes', 'SELECT') as any`,
    );
    expect(row?.any).toBe(false);
  });
});

describe('supplier quotes are written only with procurement.rate.read and procurement.po.write', () => {
  afterAll(async () => {
    await asMigrator((m) => m`delete from vendor_quotes where id = ${id(0x0300)}`);
  });

  it.each(
    ROLE_KEYS.filter(
      (r) => !(holds(r, 'procurement.rate.read') && holds(r, 'procurement.po.write')),
    ),
  )('%s, without both grants, records no quote', async (role) => {
    const p = principalFor(role, [1]);
    const result = await attempt(p, insertQuote(1, p.id));
    expect(refusedByPolicy(result)).toBe(true);
  });

  it('Accounts, who reads rates but writes no purchase order, withdraws no quote', async () => {
    const p = principalFor('accounts', [1]);
    const result = await attempt(
      p,
      sql`update vendor_quotes set withdrawn_at = now(), withdrawn_by = ${p.id}
           where id = ${SPARE_QUOTE} returning id`,
    );
    expect(result).toBe(0);
  });

  it('the Inventory Manager records a quote of their company and none of another', async () => {
    const p = principalFor('inventory_manager', [1], { id: OWNER });
    expect(refusedByPolicy(await attempt(p, insertQuote(2, p.id)))).toBe(true);
    expect(await attempt(p, insertQuote(1, p.id))).toBe(1);
    await asMigrator((m) => m`delete from vendor_quotes where id = ${id(0x0300)}`);
  });

  it('a quote is signed by the person recording it', async () => {
    const p = principalFor('inventory_manager', [1]);
    expect(refusedByPolicy(await attempt(p, insertQuote(1, OWNER)))).toBe(true);
  });

  it('a group quote needs a request covering every company', async () => {
    const one = principalFor('inventory_manager', [1]);
    expect(refusedByPolicy(await attempt(one, insertQuote(null, one.id)))).toBe(true);
    const every = principalFor('inventory_manager', ALL_ENTITY_IDS, { id: OWNER });
    expect(await attempt(every, insertQuote(null, every.id))).toBe(1);
    await asMigrator((m) => m`delete from vendor_quotes where id = ${id(0x0300)}`);
  });

  it('no quote is recorded already withdrawn', async () => {
    const p = principalFor('inventory_manager', [1]);
    const result = await attempt(
      p,
      sql`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, valid_from, valid_until, recorded_by, withdrawn_at, withdrawn_by)
          values (${id(0x0300)}, ${VENDOR}, ${ITEM}, 1, 12.5, '2026-01-01', '2099-12-31', ${p.id}, now(), ${p.id})`,
    );
    expect(refusedByPolicy(result)).toBe(true);
  });

  it('a rate, its company or its validity never change after the quote is recorded', async () => {
    const p = principalFor('executive', [1]);
    for (const set of [
      sql`rate = 1`,
      sql`entity_id = 2`,
      sql`valid_until = '2100-01-01'`,
      sql`vendor_id = ${VENDOR}`,
    ]) {
      const result = await attempt(
        p,
        sql`update vendor_quotes set ${set} where id = ${quoteOf(1)} returning id`,
      );
      expect(refusedByPrivilege(result)).toBe(true);
    }
  });

  it('no quote is deleted', async () => {
    const result = await attempt(
      principalFor('executive', [1]),
      sql`delete from vendor_quotes where id = ${quoteOf(1)} returning id`,
    );
    expect(refusedByPrivilege(result)).toBe(true);
  });

  it('the Inventory Manager withdraws a live quote of their company once, and none of another', async () => {
    const other = principalFor('inventory_manager', [2]);
    expect(
      await attempt(
        other,
        sql`update vendor_quotes set withdrawn_at = now(), withdrawn_by = ${other.id}
             where id = ${SPARE_QUOTE} returning id`,
      ),
    ).toBe(0);
    const p = principalFor('inventory_manager', [1], { id: OWNER });
    expect(
      await attempt(
        p,
        sql`update vendor_quotes set withdrawn_at = now(), withdrawn_by = ${p.id}
             where id = ${SPARE_QUOTE} returning id`,
      ),
    ).toBe(1);
    // A withdrawn quote is never brought back or withdrawn again.
    expect(
      await attempt(
        p,
        sql`update vendor_quotes set withdrawn_at = null, withdrawn_by = null
             where id = ${SPARE_QUOTE} returning id`,
      ),
    ).toBe(0);
    expect(
      await attempt(
        p,
        sql`update vendor_quotes set withdrawn_at = now(), withdrawn_by = ${p.id}
             where id = ${SPARE_QUOTE} returning id`,
      ),
    ).toBe(0);
  });

  it('a withdrawal is signed by the person withdrawing', async () => {
    const p = principalFor('inventory_manager', [3]);
    const result = await attempt(
      p,
      sql`update vendor_quotes set withdrawn_at = now(), withdrawn_by = ${OWNER}
           where id = ${quoteOf(3)} returning id`,
    );
    expect(refusedByPolicy(result)).toBe(true);
  });

  it('the reader pool writes no quote, even for the Executive', async () => {
    const p = principalFor('executive');
    const error = await withRequestContext(p, {}, ({ tx }) => tx.execute(insertQuote(null, p.id)), {
      reader: true,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toMatchObject({ code: '25006' });
  });
});

describe('the vendor master is shared by the group', () => {
  const MASTER = ['vendors', 'vendor_contacts', 'item_vendors'] as const;
  const fixtureRow = { vendors: VENDOR, vendor_contacts: CONTACT, item_vendors: LINK };

  describe.each(POOLS)('on the %s pool', (pool) => {
    it.each(ROLE_KEYS)(
      '%s reads the master in every company with inventory.stock.read or procurement.po.write, else nothing',
      async (role) => {
        for (const e of ALL_ENTITY_IDS) {
          for (const table of MASTER) {
            const seen = await visible(principalFor(role, [e]), table, pool);
            expect({ table, e, seen }).toEqual({
              table,
              e,
              seen: readsVendors(role) ? [fixtureRow[table]] : [],
            });
          }
        }
      },
    );

    it('nothing is read with no company in the request', async () => {
      for (const table of MASTER) {
        expect(await visible(principalFor('executive', []), table, pool)).toEqual([]);
      }
    });
  });

  it('the General Manager and the Store Manager read vendors, and no rate', async () => {
    for (const role of ['general_manager', 'store_manager'] as const) {
      expect(await visible(principalFor(role, [1]), 'vendors', 'app_user')).toEqual([VENDOR]);
      expect(await visible(principalFor(role, [1]), 'vendor_quotes', 'app_user')).toEqual([]);
    }
  });

  it.each(ROLE_KEYS.filter((r) => !holds(r, 'procurement.po.write')))(
    '%s, without procurement.po.write, adds, changes and removes nothing',
    async (role) => {
      const p = principalFor(role, [1]);
      expect(
        refusedByPolicy(
          await attempt(
            p,
            sql`insert into vendors (id, name, created_by)
                values (${newId()}, 'vendors-suite refused', ${p.id})`,
          ),
        ),
      ).toBe(true);
      expect(
        await attempt(
          p,
          sql`update vendors set notes = 'changed', updated_by = ${p.id} where id = ${VENDOR} returning id`,
        ),
      ).toBe(0);
      expect(
        refusedByPolicy(
          await attempt(
            p,
            sql`insert into vendor_contacts (id, vendor_id, name, position, created_by)
                values (${newId()}, ${VENDOR}, 'refused person', 2, ${p.id})`,
          ),
        ),
      ).toBe(true);
      expect(
        await attempt(p, sql`delete from vendor_contacts where id = ${CONTACT} returning id`),
      ).toBe(0);
      expect(await attempt(p, sql`delete from item_vendors where id = ${LINK} returning id`)).toBe(
        0,
      );
      expect(
        await attempt(
          p,
          sql`update item_vendors set is_preferred = false, updated_by = ${p.id} where id = ${LINK} returning id`,
        ),
      ).toBe(0);
    },
  );

  it('the Inventory Manager adds and edits a vendor, signed by themselves', async () => {
    const p = principalFor('inventory_manager', [2], { id: OWNER });
    const vendor = newId();
    expect(
      refusedByPolicy(
        await attempt(
          p,
          sql`insert into vendors (id, name, created_by) values (${vendor}, 'vendors-suite new', ${newId()})`,
        ),
      ),
    ).toBe(true);
    expect(
      await attempt(
        p,
        sql`insert into vendors (id, name, created_by) values (${vendor}, 'vendors-suite new', ${p.id}) returning id`,
      ),
    ).toBe(1);
    expect(
      await attempt(
        p,
        sql`update vendors set lead_time_days = 7, updated_by = ${p.id} where id = ${vendor} returning id`,
      ),
    ).toBe(1);
    expect(
      refusedByPrivilege(
        await attempt(p, sql`update vendors set created_by = ${p.id} where id = ${vendor}`),
      ),
    ).toBe(true);
    expect(
      refusedByPrivilege(await attempt(p, sql`delete from vendors where id = ${vendor}`)),
    ).toBe(true);
  });

  it('an item has at most one preferred vendor', async () => {
    const p = principalFor('inventory_manager', [1], { id: OWNER });
    const second = newId();
    await asMigrator(
      (m) =>
        m`insert into vendors (id, name, created_by) values (${second}, 'vendors-suite second', ${OWNER})`,
    );
    const result = await attempt(
      p,
      sql`insert into item_vendors (id, item_id, vendor_id, is_preferred, created_by)
          values (${newId()}, ${ITEM}, ${second}, true, ${p.id})`,
    );
    expect(causeOf(result)).toContain('item_vendors_one_preferred');
  });

  it('a GSTIN starts with the vendor’s state code and holds its PAN', async () => {
    const p = principalFor('inventory_manager', [1], { id: OWNER });
    for (const [gstin, state, pan] of [
      ['08ABCDE1234F1Z6', '09', null],
      ['08ABCDE1234F1Z6', '08', 'ABCDE9999F'],
      ['8ABCDE1234F1Z6', '08', null],
    ] as const) {
      const result = await attempt(
        p,
        sql`insert into vendors (id, name, gstin, state_code, pan, created_by)
            values (${newId()}, 'vendors-suite gstin', ${gstin}, ${state}, ${pan}, ${p.id})`,
      );
      expect(causeOf(result)).toMatch(/vendors_(gstin|pan)_check/);
    }
  });
});
