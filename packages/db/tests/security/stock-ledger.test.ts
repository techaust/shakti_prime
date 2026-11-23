import { newId, ROLE_KEYS, STAFF_ROLE_KEYS, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  PERMISSION_SHARED_TABLES,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * H1 (docs/03-roadmap-appendix/phase3.md §5, §6.2): hubs and bins read by any holder of
 * inventory.stock.read in a request with a company and written only with inventory.stock.adjust
 * for every company; the ledger, its costs, the balances, the serials and the moving average
 * written by no request role; the cost tables read only with finance.cost.read. The role ×
 * company matrix covers each company table's rows by role.
 */

const tag = newId().slice(-8).toUpperCase();
const hubId = newId();
const binId = newId();
let owner: Principal;

/** The database's own error, whether thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const code = (cause as { code?: unknown }).code;
    return {
      ...(typeof code === 'string' ? { code } : {}),
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  throw new Error('expected the statement to fail');
}

async function count(principal: Principal, table: string): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where id in (${hubId}, ${binId})`,
    )) as unknown as { n: number }[];
    return rows[0]?.n ?? 0;
  });
}

beforeAll(async () => {
  owner = await createTestPrincipal('executive');
  await asMigrator(async (m) => {
    await m`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
      values (${hubId}, ${`SL${tag}`}, 'ledger test hub', 'godown', '08', '302001', ${owner.id})`;
    await m`insert into bins (id, warehouse_id, code, kind, created_by)
      values (${binId}, ${hubId}, 'SL-A1', 'storage', ${owner.id})`;
  });
});

describe('hubs and bins: read with inventory.stock.read in a company', () => {
  it.each(PERMISSION_SHARED_TABLES)(
    '%s returns no row without a request context',
    async (table) => {
      const [row] = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect(row?.n).toBe(0);
    },
  );

  it.each(PERMISSION_SHARED_TABLES)(
    '%s returns no row to an Executive whose request names no company',
    async (table) => {
      expect(await count(principalFor('executive', []), table)).toBe(0);
    },
  );

  it.each(ROLE_KEYS)(
    '%s reads them exactly when it holds inventory.stock.read',
    async (roleKey) => {
      const principal = principalFor(roleKey, [1]);
      const holds = principal.permissions.some((g) => g.key === 'inventory.stock.read');
      expect(await count(principal, 'warehouses')).toBe(holds ? 1 : 0);
      expect(await count(principal, 'bins')).toBe(holds ? 1 : 0);
    },
  );

  it('are written only with inventory.stock.adjust for every company, by the caller', async () => {
    for (const roleKey of ['inventory_manager', 'general_manager', 'store_manager'] as const) {
      const who = await createTestPrincipal(roleKey, [1]);
      const refused = await failure(
        asPrincipal(who, ({ tx }) =>
          tx.execute(sql`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
            values (${newId()}, ${`SX${tag}`}, 'refused hub', 'godown', '08', '302001', ${who.id})`),
        ),
      );
      expect(refused.code, roleKey).toBe('42501');
      const updated = await asPrincipal(who, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`update bins set code = 'SL-B1' where id = ${binId} returning id`,
        )) as unknown as unknown[];
        return rows.length;
      });
      expect(updated, roleKey).toBe(0);
    }
    const exec = await createTestPrincipal('executive', [1]);
    // Never as another person.
    expect(
      (
        await failure(
          asPrincipal(exec, ({ tx }) =>
            tx.execute(sql`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
              values (${newId()}, ${`SY${tag}`}, 'hub', 'godown', '08', '302001', ${owner.id})`),
          ),
        )
      ).code,
    ).toBe('42501');
    const id = newId();
    await asPrincipal(exec, ({ tx }) =>
      tx.execute(sql`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${id}, ${`SZ${tag}`}, 'written hub', 'godown', '08', '302001', ${exec.id})`),
    );
    const [row] = await asMigrator(
      (m) => m<{ name: string }[]>`select name from warehouses where id = ${id}`,
    );
    expect(row?.name).toBe('written hub');
  });

  it('may be selected, inserted and updated by app_user, never deleted; app_reader only selects', async () => {
    for (const table of PERMISSION_SHARED_TABLES) {
      const [row] = await withoutContext<Record<string, boolean>>(sql`
        select has_table_privilege('app_user', ${table}, 'SELECT') as s,
               has_table_privilege('app_user', ${table}, 'INSERT') as i,
               has_table_privilege('app_user', ${table}, 'UPDATE') as u,
               has_table_privilege('app_user', ${table}, 'DELETE') as d,
               has_table_privilege('app_reader', ${table}, 'SELECT') as rs,
               has_table_privilege('app_reader', ${table}, 'INSERT, UPDATE, DELETE') as rw
      `);
      expect({ table, ...row }).toEqual({
        table,
        s: true,
        i: true,
        u: true,
        d: false,
        rs: true,
        rw: false,
      });
    }
  });

  it('a hub keeps its kind, a bin its hub, and a transit bin pairs two other hubs', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    expect(
      (
        await failure(
          asPrincipal(exec, ({ tx }) =>
            tx.execute(sql`update warehouses set kind = 'factory' where id = ${hubId}`),
          ),
        )
      ).message,
    ).toMatch(/keeps its kind/);
    expect(
      (
        await failure(
          asPrincipal(exec, ({ tx }) =>
            tx.execute(sql`update bins set kind = 'receiving' where id = ${binId}`),
          ),
        )
      ).message,
    ).toMatch(/keeps its hub/);
    expect(
      (
        await failure(
          asPrincipal(exec, ({ tx }) =>
            tx.execute(sql`insert into bins (id, warehouse_id, code, kind, pair_a_warehouse_id, pair_b_warehouse_id, created_by)
              values (${newId()}, ${hubId}, 'SL-T', 'transit', ${hubId}, ${newId()}, ${exec.id})`),
          ),
        )
      ).code,
    ).toBe('23514');
  });
});

describe('the ledger, its costs, the balances, the serials and item costs', () => {
  const LEDGER = [
    'stock_movements',
    'stock_movement_costs',
    'stock_balances',
    'serials',
    'item_costs',
  ] as const;

  it.each(LEDGER)(
    '%s takes no insert, update or delete from app_user or app_reader',
    async (table) => {
      const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', ${table}, 'INSERT') or has_table_privilege('app_user', ${table}, 'UPDATE')
               or has_table_privilege('app_user', ${table}, 'DELETE') as app,
             has_table_privilege('app_reader', ${table}, 'INSERT') or has_table_privilege('app_reader', ${table}, 'UPDATE')
               or has_table_privilege('app_reader', ${table}, 'DELETE') as reader,
             has_any_column_privilege('app_user', ${table}, 'INSERT') or has_any_column_privilege('app_user', ${table}, 'UPDATE') as columns
    `);
      expect({ table, ...row }).toEqual({ table, app: false, reader: false, columns: false });
    },
  );

  it('refuses a direct write even to an Executive holding every stock and cost grant', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const attempts = [
      sql`insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, batch_id, moved_by)
          select ${newId()}, 1, i.id, ${binId}, 1, 'adjust_gain', ${newId()}, ${exec.id} from items i limit 1`,
      sql`insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand)
          select ${newId()}, 1, ${hubId}, ${binId}, i.id, 5 from items i limit 1`,
      sql`update stock_balances set qty_on_hand = qty_on_hand + 1`,
      sql`update serials set state = 'scrapped'`,
      sql`delete from stock_movements`,
      sql`update item_costs set moving_avg_cost = 1`,
      sql`insert into item_costs (id, item_id, entity_id) select ${newId()}, i.id, 1 from items i limit 1`,
    ];
    for (const statement of attempts) {
      expect((await failure(asPrincipal(exec, ({ tx }) => tx.execute(statement)))).code).toBe(
        '42501',
      );
    }
  });

  it('a movement and its cost stay as written, for the table owner too', async () => {
    const movements = await asMigrator(
      (m) => m<{ id: string }[]>`select id from stock_movements limit 1`,
    );
    const movement = movements[0];
    if (movement === undefined) return;
    await expect(
      asMigrator((m) => m`update stock_movements set qty = qty where id = ${movement.id}`),
    ).rejects.toMatchObject({ message: expect.stringMatching(/append-only/) as unknown });
    await expect(
      asMigrator((m) => m`delete from stock_movement_costs where movement_id = ${movement.id}`),
    ).rejects.toMatchObject({ message: expect.stringMatching(/append-only/) as unknown });
  });
});

describe('the cost tables, role by role', () => {
  // Fixture rows of the role × company matrix are written by its own file; here every table's
  // policy itself is asked, so a role without finance.cost.read reads no row at all.
  it.each(STAFF_ROLE_KEYS)('%s reads costs only with finance.cost.read', async (roleKey) => {
    const principal = principalFor(roleKey, [1, 2, 3, 4]);
    const holds = principal.permissions.some((g) => g.key === 'finance.cost.read');
    const [policy] = await asPrincipal(
      principal,
      async ({ tx }) =>
        (await tx.execute(sql`
        select app.has_perm('finance.cost.read:entity') as c,
               (select count(*)::int from stock_movement_costs) as costs,
               (select count(*)::int from item_costs) as items
      `)) as unknown as { c: boolean; costs: number; items: number }[],
    );
    expect(policy?.c).toBe(holds);
    if (!holds)
      expect({ costs: policy?.costs, items: policy?.items }).toEqual({ costs: 0, items: 0 });
  });

  it('no agent reads a cost', async () => {
    for (const agent of ROLE_KEYS.filter((r) => r.startsWith('agent:'))) {
      const [row] = await asPrincipal(
        principalFor(agent, [1, 2, 3, 4]),
        async ({ tx }) =>
          (await tx.execute(sql`
          select (select count(*)::int from stock_movement_costs) as costs,
                 (select count(*)::int from item_costs) as items
        `)) as unknown as { costs: number; items: number }[],
      );
      expect({ agent, ...row }).toEqual({ agent, costs: 0, items: 0 });
    }
  });
});

describe('the definers', () => {
  it('app.stock_move() is run by app_user only and checks its grants inside', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.stock_move(jsonb)', 'execute') as app,
             has_function_privilege('app_reader', 'app.stock_move(jsonb)', 'execute') as reader,
             has_function_privilege('readonly_reporter', 'app.stock_move(jsonb)', 'execute') as reporter,
             has_function_privilege('public', 'app.stock_move(jsonb)', 'execute') as pub,
             has_function_privilege('app_user', 'app.stock_refuse(text,jsonb)', 'execute') as refuse,
             has_function_privilege('app_user', 'app.stock_bin(uuid)', 'execute') as bin
    `);
    expect(row).toEqual({
      app: true,
      reader: false,
      reporter: false,
      pub: false,
      refuse: false,
      bin: false,
    });
    expect((await failure(withoutContext(sql`select app.stock_move('[]'::jsonb)`))).code).toBe(
      '42501',
    );
  });

  it('app.stock_balance_check() answers the workers principal only', async () => {
    expect(
      (
        await failure(
          asPrincipal(principalFor('executive'), ({ tx }) =>
            tx.execute(sql`select * from app.stock_balance_check()`),
          ),
        )
      ).code,
    ).toBe('42501');
    const rows = await asPrincipal(
      principalFor('system:workers'),
      async ({ tx }) =>
        (await tx.execute(
          sql`select count(*)::int as n from app.stock_balance_check()`,
        )) as unknown as {
          n: number;
        }[],
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(0);
  });
});
