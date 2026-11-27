// Purchase order and goods receipt plans (U2, docs/03-roadmap-appendix/phase3.md §7.2):
// `pnpm --filter @shakti/domain exec tsx tests/spike/po-explain.ts`.
// Fills the local database with 60,000 made-up purchase orders (numbers under `POX/`) of one vendor
// to one hub, across the four companies and the seven states, two lines each with their rates, and
// 30,000 goods receipts of the received ones (written as the table owner, set-based, kept between
// runs), then prints `EXPLAIN (ANALYZE, BUFFERS)` of every statement the orders list, the order
// sheet and the receipts list run, under the policies as a General Manager and an Inventory
// Manager. Local database only (prepareDatabase refuses any other host). Not part of CI.
import type { Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import {
  getPurchaseOrder,
  listGoodsReceipts,
  listPurchaseOrders,
} from '../../src/queries/procurement/order-queries';

const ORDERS = 60_000;
const PREFIX = 'POX/';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

async function explained<T>(
  label: string,
  principal: Principal,
  read: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  return asPrincipal(principal, async (ctx) => {
    let n = 0;
    const tx = new Proxy(ctx.tx, {
      get(target, key, receiver) {
        if (key !== 'execute') return Reflect.get(target, key, receiver) as unknown;
        return async (query: SQL) => {
          n += 1;
          const rows = (await target.execute(
            sql`explain (analyze, buffers, costs off) ${query}`,
          )) as unknown as Record<string, string>[];
          process.stdout.write(
            `\n=== ${label} (statement ${String(n)}) ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
          );
          return target.execute(query);
        };
      },
    });
    return read({ ...ctx, tx });
  });
}

async function seed(createdBy: string): Promise<string> {
  return asMigrator(async (m) => {
    await m`insert into vendors (id, name, created_by)
      select app.uuid_v7(), 'Plan vendor POX', ${createdBy}
       where not exists (select 1 from vendors where name = 'Plan vendor POX')`;
    await m`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
      values (app.uuid_v7(), 'POX-H1', 'Plan hub POX', 'godown', '08', '302001', ${createdBy})
      on conflict do nothing`;
    const [hub] = await m<{ id: string }[]>`select id from warehouses where code = 'POX-H1'`;
    await m`insert into bins (id, warehouse_id, code, kind, created_by)
      select app.uuid_v7(), ${hub?.id ?? ''}, 'RCV', 'receiving', ${createdBy}
       where not exists (select 1 from bins where warehouse_id = ${hub?.id ?? ''} and kind = 'receiving')`;
    await m`insert into items (id, sku, name, category, hsn, unit)
      select app.uuid_v7(), 'POX-' || g, 'Plan item ' || g, 'cable', '8544', 'metre'
        from generate_series(1, 2) g
       where not exists (select 1 from items where sku = 'POX-' || g)`;
    const [have] = await m<{ n: number }[]>`
      select count(*)::int as n from purchase_orders where po_no like ${`${PREFIX}%`}`;
    if ((have?.n ?? 0) < ORDERS) {
      await m`
        with v as (select id from vendors where name = 'Plan vendor POX' limit 1),
             h as (select id from warehouses where code = 'POX-H1'),
             s as (select array['draft','approved','sent','partially_received','received','closed','cancelled'] as states)
        insert into purchase_orders (id, entity_id, po_no, vendor_id, deliver_to_warehouse_id, state,
                                     drafted_by, approved_by, approved_at, sent_at, sent_via,
                                     cancel_reason, close_reason, place_of_supply_state_code,
                                     created_at, created_by)
        select app.uuid_v7(), 1 + g % 4, ${PREFIX} || g, v.id, h.id, st,
               ${createdBy},
               case when st in ('draft', 'cancelled') then null else ${createdBy}::uuid end,
               case when st in ('draft', 'cancelled') then null else now() end,
               case when st in ('sent', 'partially_received', 'received', 'closed') then now() end,
               case when st in ('sent', 'partially_received', 'received', 'closed') then 'by_hand' end,
               case when st = 'cancelled' then 'plan' end,
               case when st = 'closed' then 'plan' end,
               '08', now() - (g || ' minutes')::interval, ${createdBy}
          from generate_series(${(have?.n ?? 0) + 1}::int, ${ORDERS}::int) g, v, h, s,
               lateral (select s.states[1 + (g / 4) % 7] as st) x`;
      await m`
        insert into po_lines (id, po_id, entity_id, line_no, item_id, qty, purchase_unit, unit_factor,
                              qty_received, hsn, created_by)
        select app.uuid_v7(), p.id, p.entity_id, i.n, i.id, 10, 'metre', 1,
               case p.state when 'received' then 10 when 'closed' then 10 when 'partially_received' then 5 else 0 end,
               '8544', ${createdBy}
          from purchase_orders p
          cross join (select id, row_number() over (order by sku)::int as n from items
                       where sku in ('POX-1', 'POX-2')) i
         where p.po_no like ${`${PREFIX}%`}
           and not exists (select 1 from po_lines l where l.po_id = p.id)`;
      await m`
        insert into po_line_rates (po_line_id, entity_id, unit_rate, amount, created_by)
        select l.id, l.entity_id, 12.5, 125.00, ${createdBy}
          from po_lines l join purchase_orders p on p.id = l.po_id
         where p.po_no like ${`${PREFIX}%`}
           and not exists (select 1 from po_line_rates r where r.po_line_id = l.id)`;
      await m`
        insert into goods_receipts (id, entity_id, grn_no, po_id, warehouse_id, received_at,
                                    received_by, created_by)
        select app.uuid_v7(), p.entity_id, 'POX/GRN/' || p.po_no, p.id, p.deliver_to_warehouse_id,
               p.created_at, ${createdBy}, ${createdBy}
          from purchase_orders p
         where p.po_no like ${`${PREFIX}%`}
           and p.state in ('partially_received', 'received', 'closed')
           and not exists (select 1 from goods_receipts r where r.po_id = p.id)`;
      await m`analyze purchase_orders, po_lines, po_line_rates, goods_receipts, goods_receipt_lines`;
    }
    const [one] = await m<{ id: string }[]>`
      select id from purchase_orders where po_no = ${`${PREFIX}1004`}`;
    return one?.id ?? '';
  });
}

async function main(): Promise<void> {
  await prepareDatabase();
  const owner = await createTestPrincipal('executive');
  const orderId = await seed(owner.id);
  const gm = await createTestPrincipal('general_manager', [1]);
  const manager = await createTestPrincipal('inventory_manager', [1]);
  const [counts] = await asMigrator(
    (m) => m<{ orders: number; receipts: number }[]>`
      select (select count(*)::int from purchase_orders) as orders,
             (select count(*)::int from goods_receipts) as receipts`,
  );
  process.stdout.write(
    `orders ${String(counts?.orders)}, receipts ${String(counts?.receipts)} in the database\n`,
  );
  await explained('orders list, sent, first page (General Manager)', gm, (ctx) =>
    listPurchaseOrders(ctx, { entityId: 1, state: 'sent', limit: 50 }),
  );
  const first = await asPrincipal(gm, (ctx) =>
    listPurchaseOrders(ctx, { entityId: 1, state: 'sent', limit: 50 }),
  );
  if (first.nextCursor !== null) {
    await explained('orders list, sent, second page (General Manager)', gm, (ctx) =>
      listPurchaseOrders(ctx, { entityId: 1, state: 'sent', limit: 50, cursor: first.nextCursor ?? '' }),
    );
  }
  await explained('order sheet with rates (Inventory Manager)', manager, (ctx) =>
    getPurchaseOrder(ctx, { purchaseOrderId: orderId }),
  );
  await explained('receipts list, first page (Inventory Manager)', manager, (ctx) =>
    listGoodsReceipts(ctx, { entityId: 1, limit: 50 }),
  );
  await closeDb();
}

void main();
