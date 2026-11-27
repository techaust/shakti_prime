import { newId, ROLE_KEYS, type Principal, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { STAFF_MATRIX } from '../../seeds/role-permissions';

/**
 * U2 purchase orders and goods receipt (docs/03-roadmap-appendix/phase3.md §7.2): rates only with
 * procurement.rate.read on both pools; orders and receipts read by stock readers without their
 * values; the order's guard (approval, self-approval, drafts only, the machine's moves); the receipt
 * and reorder definers refuse whoever lacks their grant. The role × company matrix covers each
 * table's rows by role and company.
 */

const tag = newId().slice(-8).toUpperCase();
let drafter: Principal;
let approver: Principal;
let executive: Principal;
const ids = {
  hub: newId(),
  bin: newId(),
  item: newId(),
  vendor: newId(),
  order: newId(),
  line: newId(),
  draft: newId(),
  draftLine: newId(),
  receipt: newId(),
  receiptLine: newId(),
};

type Pool = 'app_user' | 'app_reader';
const POOLS: Pool[] = ['app_user', 'app_reader'];

/** How many of this file's rows of `table` (by `key`) `principal` reads on the pool. */
async function visible(
  principal: Principal,
  table: string,
  key: string,
  pool: Pool,
): Promise<number> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)}
             where ${sql.identifier(key)} in (${ids.line}, ${ids.draftLine}, ${ids.receiptLine},
                                              ${ids.order}, ${ids.draft}, ${ids.receipt})`,
      )) as unknown as { n: number }[];
      return rows[0]?.n ?? 0;
    },
    { reader: pool === 'app_reader' },
  );
}

/** The database's own failure of a statement run as `principal`, or the rows it touched. */
async function attempt(
  principal: Principal,
  statement: SQL,
): Promise<number | { code?: string; constraint?: string }> {
  try {
    return await withRequestContext(principal, {}, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      return rows.length;
    });
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const c = cause as { code?: unknown; constraint_name?: unknown };
    return {
      ...(typeof c.code === 'string' ? { code: c.code } : {}),
      ...(typeof c.constraint_name === 'string' ? { constraint: c.constraint_name } : {}),
    };
  }
}

beforeAll(async () => {
  drafter = await createTestPrincipal('inventory_manager', [1]);
  approver = await createTestPrincipal('inventory_manager', [1]);
  executive = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${ids.hub}, ${`PO${tag}`}, ${`po test hub ${tag}`}, 'godown', '08', '302001', ${drafter.id})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by)
        values (${ids.bin}, ${ids.hub}, 'RCV', 'receiving', ${drafter.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit)
        values (${ids.item}, ${`PO-${tag}`}, ${`po test item ${tag}`}, 'cable', '8544', 'metre')`;
      await tx`insert into vendors (id, name, created_by) values (${ids.vendor}, ${`po test vendor ${tag}`}, ${drafter.id})`;
      await tx`insert into purchase_orders (id, entity_id, po_no, vendor_id, deliver_to_warehouse_id, state, drafted_by,
                                            approved_by, approved_at, sent_at, sent_via, place_of_supply_state_code, created_by)
        values (${ids.order}, 1, ${`T${tag}/PO/1`}, ${ids.vendor}, ${ids.hub}, 'sent', ${drafter.id},
                ${approver.id}, now(), now(), 'by_hand', '08', ${drafter.id}),
               (${ids.draft}, 1, ${`T${tag}/PO/2`}, ${ids.vendor}, ${ids.hub}, 'draft', ${drafter.id},
                null, null, null, null, '08', ${drafter.id})`;
      await tx`insert into po_lines (id, po_id, entity_id, line_no, item_id, qty, purchase_unit, unit_factor, hsn, tax_rate_id, tax_rate_pct, created_by)
        values (${ids.line}, ${ids.order}, 1, 1, ${ids.item}, 10, 'metre', 1, '8544', null, null, ${drafter.id}),
               (${ids.draftLine}, ${ids.draft}, 1, 1, ${ids.item}, 10, 'metre', 1, '8544', null, null, ${drafter.id})`;
      await tx`insert into po_line_rates (po_line_id, entity_id, unit_rate, amount, created_by)
        values (${ids.line}, 1, 12.5, 125.00, ${drafter.id}), (${ids.draftLine}, 1, 12.5, 125.00, ${drafter.id})`;
      await tx`insert into goods_receipts (id, entity_id, grn_no, po_id, warehouse_id, received_at, received_by, created_by)
        values (${ids.receipt}, 1, ${`T${tag}/GRN/1`}, ${ids.order}, ${ids.hub}, now(), ${drafter.id}, ${drafter.id})`;
      await tx`insert into goods_receipt_lines (id, receipt_id, entity_id, po_line_id, item_id, bin_id, qty, stock_qty, is_serial_tracked, created_by)
        values (${ids.receiptLine}, ${ids.receipt}, 1, ${ids.line}, ${ids.item}, ${ids.bin}, 1, 1, false, ${drafter.id})`;
      await tx`insert into goods_receipt_line_rates (receipt_line_id, entity_id, unit_rate)
        values (${ids.receiptLine}, 1, 12.5)`;
    }),
  );
});

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table goods_receipt_line_rates disable trigger goods_receipt_line_rates_append_only`;
      await tx`delete from goods_receipt_line_rates where receipt_line_id = ${ids.receiptLine}`;
      await tx`alter table goods_receipt_line_rates enable trigger goods_receipt_line_rates_append_only`;
      await tx`delete from goods_receipt_lines where id = ${ids.receiptLine}`;
      await tx`delete from goods_receipts where id = ${ids.receipt}`;
      await tx`delete from po_lines where po_id in (${ids.order}, ${ids.draft})`;
      await tx`delete from purchase_orders where id in (${ids.order}, ${ids.draft})`;
      await tx`update items set archived_at = now(), is_active = false where id = ${ids.item}`;
    }),
  );
  await closeDb();
});

const holdsRates = (role: RoleKey): boolean =>
  !role.startsWith('agent:') &&
  !role.startsWith('system:') &&
  STAFF_MATRIX['procurement.rate.read'][
    role as keyof (typeof STAFF_MATRIX)['procurement.rate.read']
  ] !== undefined;

describe('rates per role on every table and pool (INV-04)', () => {
  it.each(POOLS)('only a holder of procurement.rate.read reads a rate, on %s', async (pool) => {
    for (const role of ROLE_KEYS) {
      const who = principalFor(role, [1]);
      const rates = holdsRates(role);
      expect(await visible(who, 'po_line_rates', 'po_line_id', pool), `${role} po_line_rates`).toBe(
        rates ? 2 : 0,
      );
      expect(
        await visible(who, 'goods_receipt_line_rates', 'receipt_line_id', pool),
        `${role} goods_receipt_line_rates`,
      ).toBe(rates ? 1 : 0);
    }
  });

  it.each(POOLS)(
    'the General Manager and the Store Manager read orders and receipts without values, on %s',
    async (pool) => {
      for (const role of ['general_manager', 'store_manager'] as const) {
        const who = principalFor(role, [1]);
        expect(await visible(who, 'purchase_orders', 'id', pool)).toBe(2);
        expect(await visible(who, 'po_lines', 'id', pool)).toBe(2);
        expect(await visible(who, 'goods_receipts', 'id', pool)).toBe(1);
        expect(await visible(who, 'goods_receipt_lines', 'id', pool)).toBe(1);
        expect(await visible(who, 'po_line_rates', 'po_line_id', pool)).toBe(0);
        expect(await visible(who, 'goods_receipt_line_rates', 'receipt_line_id', pool)).toBe(0);
      }
      // Another company's people read nothing of company 1's.
      const elsewhere = principalFor('inventory_manager', [2]);
      expect(await visible(elsewhere, 'purchase_orders', 'id', pool)).toBe(0);
      expect(await visible(elsewhere, 'po_line_rates', 'po_line_id', pool)).toBe(0);
    },
  );

  it('carries no rate on the order or receipt rows, and the reporting role reads none of them', async () => {
    const [cols] = await withoutContext<{ n: number }>(sql`
      select count(*)::int as n from information_schema.columns
       where table_name in ('purchase_orders', 'po_lines', 'goods_receipts', 'goods_receipt_lines')
         and (column_name like '%rate' or column_name like '%amount%' or column_name like '%cost%')
         and column_name not like 'tax_rate%'`);
    expect(cols?.n).toBe(0);
    const [granted] = await withoutContext<{ n: number }>(sql`
      select count(*)::int as n from information_schema.role_table_grants
       where grantee = 'readonly_reporter'
         and table_name in ('reorder_rules', 'purchase_orders', 'po_lines', 'po_line_rates',
                            'goods_receipts', 'goods_receipt_lines', 'goods_receipt_line_rates')`);
    expect(granted?.n).toBe(0);
  });

  it('fails closed with no request context', async () => {
    for (const table of ['purchase_orders', 'po_line_rates', 'goods_receipt_line_rates']) {
      const rows = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect(rows[0]?.n, table).toBe(0);
    }
  });
});

describe('the order’s guard', () => {
  const approve = (who: Principal) =>
    sql`update purchase_orders set state = 'approved', approved_by = ${who.id}, approved_at = now(),
               updated_by = ${who.id}
         where id = ${ids.draft} returning id`;

  it('refuses a rate written by a person without procurement.rate.read', async () => {
    const writerOnly = principalFor('inventory_manager', [1], {
      id: drafter.id,
      permissions: [{ key: 'procurement.po.write', scope: 'entity' }],
    });
    expect(
      await attempt(
        writerOnly,
        sql`update po_line_rates set unit_rate = 1, amount = 10, updated_by = ${drafter.id}
             where po_line_id = ${ids.draftLine} returning po_line_id`,
      ),
    ).toBe(0);
  });

  it('refuses the drafter their own approval, and a line without its GST rate', async () => {
    expect(await attempt(drafter, approve(drafter))).toMatchObject({
      constraint: 'po_self_approval',
    });
    expect(await attempt(approver, approve(approver))).toMatchObject({
      constraint: 'po_lines_incomplete',
    });
    expect(await attempt(principalFor('general_manager', [1]), approve(approver))).toBe(0);
  });

  it('refuses a change of a sent order’s terms and lines, and a move the machine lacks', async () => {
    expect(
      await attempt(
        drafter,
        sql`update purchase_orders set notes = 'later', updated_by = ${drafter.id}
                                  where id = ${ids.order} returning id`,
      ),
    ).toMatchObject({ constraint: 'purchase_order_not_draft' });
    expect(
      await attempt(
        drafter,
        sql`update po_lines set qty = 20, updated_by = ${drafter.id}
                                  where id = ${ids.line} returning id`,
      ),
    ).toMatchObject({ constraint: 'purchase_order_not_draft' });
    expect(
      await attempt(
        drafter,
        sql`update purchase_orders set state = 'draft', updated_by = ${drafter.id}
                                  where id = ${ids.order} returning id`,
      ),
    ).toMatchObject({ constraint: 'purchase_order_transition_not_allowed' });
    expect(
      await attempt(
        drafter,
        sql`delete from po_line_rates where po_line_id = ${ids.line} returning po_line_id`,
      ),
    ).toBe(0);
  });

  it('keeps a receipt line’s rate as written, for every role', async () => {
    expect(
      await attempt(
        executive,
        sql`update goods_receipt_line_rates set unit_rate = 1
                                    where receipt_line_id = ${ids.receiptLine} returning receipt_line_id`,
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await attempt(
        executive,
        sql`insert into goods_receipt_line_rates (receipt_line_id, entity_id, unit_rate)
                                    values (${ids.receiptLine}, 1, 1) returning receipt_line_id`,
      ),
    ).toMatchObject({ code: '42501' });
  });
});

describe('the receipt and reorder definers', () => {
  it('refuse whoever lacks procurement.grn.write, and a receipt of another company', async () => {
    for (const role of ['general_manager', 'store_manager', 'accounts', 'agent:chief'] as const) {
      for (const call of [
        sql`select app.goods_receipt_post(${ids.receipt}::uuid, '{}'::jsonb)`,
        sql`select app.goods_receipt_unpost(${ids.receipt}::uuid)`,
      ]) {
        expect(await attempt(principalFor(role, [1]), call), role).toMatchObject({ code: '42501' });
      }
    }
    expect(
      await attempt(
        principalFor('inventory_manager', [2]),
        sql`select app.goods_receipt_post(${ids.receipt}::uuid, '{}'::jsonb)`,
      ),
    ).toMatchObject({ code: '42501' });
    // A receipt already in stock is not posted again.
    expect(
      await attempt(drafter, sql`select app.goods_receipt_post(${ids.receipt}::uuid, '{}'::jsonb)`),
    ).toMatchObject({ constraint: 'goods_receipt_posted' });
  });

  it('refuse the reorder job’s reads and drafts to every person, an Executive included', async () => {
    for (const who of [executive, drafter, principalFor('agent:sizing', [1])]) {
      expect(
        await attempt(who, sql`select * from app.reorder_shortfalls(1::smallint)`),
      ).toMatchObject({
        code: '42501',
      });
      expect(
        await attempt(
          who,
          sql`select app.reorder_draft_po(1::smallint, ${newId()}::uuid, 'X', ${ids.vendor}::uuid,
                                          ${ids.hub}::uuid, '[]'::jsonb)`,
        ),
      ).toMatchObject({ code: '42501' });
    }
  });

  it('are executable by no reporting or reading role', async () => {
    const rows = await withoutContext<{ fn: string; reporter: boolean; reader: boolean }>(sql`
      select p.proname as fn,
             has_function_privilege('readonly_reporter', p.oid, 'EXECUTE') as reporter,
             has_function_privilege('app_reader', p.oid, 'EXECUTE') as reader
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('goods_receipt_post', 'goods_receipt_unpost', 'reorder_shortfalls',
                           'reorder_draft_po')`);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row, row.fn).toMatchObject({ reporter: false, reader: false });
  });
});
