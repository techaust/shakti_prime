// Reservation plans (H2, docs/03-roadmap-appendix/phase3.md §7.1; AGENTS.md §10, EXPLAIN evidence):
// `pnpm --filter @shakti/domain exec tsx tests/spike/reservations-explain.ts`.
// Writes, as the table owner and set-based, 2,000 made-up items (codes under `RSX-`), 50 storage
// bins, 10,000 confirmed orders of two lines each in company 1 with their 20,000 needs (half of
// them partly backordered) and 20,000 active reservations held far in the future, then prints
// `EXPLAIN (ANALYZE, BUFFERS)` of the stock card's hold and backorder lists and the order page's
// hold list under the policies as an Inventory Manager, of the statements the fill and the daily
// scan run inside their definers, as the table owner (the fill's count of stock that arrived after a
// need went back on order over 200,000 movements written in a transaction that is rolled back), and
// the time of `app.line_availability()` and of the builder's preview of 200 lines.
// Everything it wrote is removed at the end. Local database only (prepareDatabase refuses any
// other host). Not part of CI; it lives under tests/ for the testing helpers.
import { newId, type Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { listItemBackorders, listReservations } from '../../src/queries/inventory/reservations';

const ITEMS = 2_000;
const BINS = 50;
const ORDERS = 10_000;
const PREFIX = 'RSX-';
const E = 1;

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function print(label: string, rows: Record<string, string>[]): void {
  process.stdout.write(`\n=== ${label} ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`);
}

/** Runs `read`, explaining every statement it executes, under the policies as `principal`. */
async function explained<T>(
  label: string,
  principal: Principal,
  read: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  return asPrincipal(principal, async (ctx) => {
    const tx = new Proxy(ctx.tx, {
      get(target, key, receiver) {
        if (key !== 'execute') return Reflect.get(target, key, receiver) as unknown;
        return async (query: SQL) => {
          print(
            label,
            (await target.execute(
              sql`explain (analyze, buffers, costs off) ${query}`,
            )) as unknown as Record<string, string>[],
          );
          return target.execute(query);
        };
      },
    });
    return read({ ...ctx, tx });
  });
}

async function main(): Promise<void> {
  await prepareDatabase();
  const owner = await createTestPrincipal('executive');
  const manager = await createTestPrincipal('inventory_manager', [E]);
  const hub = newId();
  const account = newId();
  const started = Date.now();
  await asMigrator(async (m) => {
    const [tier] = await m<{ id: string }[]>`select id from price_tiers order by code limit 1`;
    await m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
               values (${hub}, ${`${PREFIX}${hub.slice(-6)}`}, 'Reservation volume hub', 'godown',
                       '08', '302001', ${owner.id})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by)
               select app.uuid_v7(), ${hub}, 'RX-' || g, 'storage', ${owner.id}
                 from generate_series(1, ${BINS}) g`;
      await tx`insert into items (id, sku, name, category, hsn, unit)
               select app.uuid_v7(), ${PREFIX} || ${hub.slice(-6)} || '-' || g,
                      'Reservation volume item ' || g, 'pump', '8413', 'nos'
                 from generate_series(1, ${ITEMS}) g`;
      await tx`insert into accounts (id, type, name, created_by)
               values (${account}, 'farm', 'Reservation volume customer', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               values (app.uuid_v7(), ${account}, ${E}, ${owner.id}, ${owner.id})`;
      await tx`create temp table rsx_items on commit drop as
               select id, row_number() over (order by id) as n from items
                where sku like ${`${PREFIX}${hub.slice(-6)}-%`}`;
      // One spike item's own rate, which every line names: no other item's tax changes.
      const [rate] = await tx<{ id: string }[]>`
        insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        select app.uuid_v7(), i.id, 12.00, '2026-04-01', ${`${PREFIX}spike`}
          from rsx_items i where i.n = 1
        returning id`;
      await tx`create temp table rsx_bins on commit drop as
               select id, row_number() over (order by id) as n from bins where warehouse_id = ${hub}`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id,
                 place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total, round_off,
                 grand_total, state, confirmed_at, confirmed_by, created_by)
               select app.uuid_v7(), ${E}, ${PREFIX} || ${hub.slice(-6)} || '/' || g, '2026-27',
                      ${account}, 'farm', ${tier?.id ?? ''}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0,
                      'confirmed', now() - (g || ' seconds')::interval, ${owner.id}, ${owner.id}
                 from generate_series(1, ${ORDERS}) g`;
      await tx`create temp table rsx_lines on commit drop as
               select app.uuid_v7() as id, x.order_id, x.position, i.id as item_id, x.confirmed_at
                 from (select so.id as order_id, p.position, so.confirmed_at,
                              row_number() over (order by so.id, p.position) as k
                         from sales_orders so cross join (values (1), (2)) as p(position)
                        where so.so_no like ${`${PREFIX}${hub.slice(-6)}/%`}) x
                 join rsx_items i on i.n = 1 + ((x.k + x.position) % ${ITEMS})`;
      await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku,
                 description, unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value,
                 cgst, sgst, igst, line_total)
               select l.id, ${E}, l.order_id, l.position, l.item_id, 'RSX', 'volume line', 'nos', 4, 0,
                      '8413', ${rate?.id ?? ''}, 12.00, 0, 0, 0, 0, 0
                 from rsx_lines l`;
      await tx`insert into reservation_needs (id, entity_id, sales_order_id, sales_order_line_id,
                 item_id, qty_needed, qty_backordered, queued_at)
               select app.uuid_v7(), ${E}, l.order_id, l.id, l.item_id, 4,
                      case when l.position = 1 then 2 else 0 end, l.confirmed_at
                 from rsx_lines l`;
      await tx`insert into reservations (id, entity_id, sales_order_id, sales_order_line_id, item_id,
                 warehouse_id, bin_id, qty, state, expires_at, created_by)
               select app.uuid_v7(), ${E}, l.order_id, l.id, l.item_id, ${hub},
                      (select b.id from rsx_bins b where b.n = 1 + (abs(hashtext(l.id::text)) % ${BINS})),
                      case when l.position = 1 then 2 else 4 end, 'active',
                      '2099-01-01'::timestamptz + (random() * interval '30 days'), ${owner.id}
                 from rsx_lines l`;
    });
    await m`analyze reservations`;
    await m`analyze reservation_needs`;
    await m`analyze sales_orders`;
    await m`analyze sales_order_lines`;
  });
  process.stdout.write(`\nwrote the volume in ${String(Date.now() - started)} ms\n`);

  const [sample] = await asMigrator(
    (m) => m<{ itemId: string; orderId: string }[]>`
      select r.item_id as "itemId", r.sales_order_id as "orderId" from reservations r
       where r.warehouse_id = ${hub} order by r.id limit 1`,
  );
  if (!sample) throw new Error('nothing was written');

  await explained('the stock card: holds of an item', manager, (ctx) =>
    listReservations(ctx, { entityId: E, itemId: sample.itemId }),
  );
  await explained('the order page: holds of an order', manager, (ctx) =>
    listReservations(ctx, { entityId: E, orderId: sample.orderId }),
  );
  await explained('the stock card: backorders of an item', manager, (ctx) =>
    listItemBackorders(ctx, { entityId: E, itemId: sample.itemId }),
  );

  await asMigrator(async (m) => {
    print(
      'the fill: the orders an item waits on, first in the queue first (inside app.fill_backorders())',
      await m.unsafe(
        `explain (analyze, buffers, costs off)
         select n.sales_order_id, min(n.queued_at)
           from reservation_needs n
           join sales_orders so on so.id = n.sales_order_id
                                and so.state in ('confirmed', 'partially_dispatched')
          where n.entity_id = $1 and n.item_id = $2 and n.qty_backordered > 0
          group by n.sales_order_id order by min(n.queued_at), n.sales_order_id limit 500`,
        [E, sample.itemId],
      ),
    );
    print(
      'the daily scan: holds past their date (inside app.lapse_reservations())',
      await m.unsafe(
        `explain (analyze, buffers, costs off)
         select r.id from reservations r
          where r.entity_id = $1 and r.state = 'active' and r.expires_at <= now()
          order by r.expires_at, r.id limit 500`,
        [E],
      ),
    );
    print(
      'the daily scan: holds due a reminder (inside app.reservation_reminders())',
      await m.unsafe(
        `explain (analyze, buffers, costs off)
         select r.id from reservations r
          where r.entity_id = $1 and r.state = 'active' and r.reminded_at is null
            and r.expires_at <= now() + interval '2 days'
          order by r.expires_at, r.id limit 500`,
        [E],
      ),
    );
    print(
      'the daily scan: items open orders wait for (inside app.backordered_items())',
      await m.unsafe(
        `explain (analyze, buffers, costs off)
         select distinct n.item_id from reservation_needs n
           join sales_orders so on so.id = n.sales_order_id
                                and so.state in ('confirmed', 'partially_dispatched')
          where n.entity_id = $1 and n.qty_backordered > 0 order by n.item_id limit 500`,
        [E],
      ),
    );
  });

  // The stock that entered a storage bin after a need went back on order: 200,000 movements of the
  // volume items into the volume bins over a year, written and rolled back.
  const ROLLED_BACK = 'rolled back';
  await asMigrator((m) =>
    m
      .begin(async (tx) => {
        await tx`with i as (select id, row_number() over (order by id) as n from items
                             where sku like ${`${PREFIX}${hub.slice(-6)}-%`}),
                      b as (select id, row_number() over (order by id) as n from bins
                             where warehouse_id = ${hub})
                 insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, batch_id,
                                              moved_at, moved_by)
                 select app.uuid_v7(), ${E}, i.id, b.id, 1, 'adjust_gain', app.uuid_v7(),
                        now() - (g || ' minutes')::interval, ${owner.id}
                   from generate_series(1, 200000) g
                   join i on i.n = 1 + (g % ${ITEMS})
                   join b on b.n = 1 + (g % ${BINS})`;
        await tx`analyze stock_movements`;
        print(
          'the fill: stock that arrived after a need went back on order (inside app.fill_backorders())',
          await tx.unsafe(
            `explain (analyze, buffers, costs off)
             select coalesce(sum(m.qty), 0)
               from stock_movements m
               join bins tb on tb.id = m.to_bin_id and tb.kind = 'storage'
               left join bins fb on fb.id = m.from_bin_id
              where m.entity_id = $1 and m.item_id = $2
                and m.moved_at > now() - interval '7 days'
                and (fb.id is null or fb.kind <> 'storage')`,
            [E, sample.itemId],
          ),
        );
        throw new Error(ROLLED_BACK);
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.message === ROLLED_BACK)) throw e;
      }),
  );

  const t0 = performance.now();
  await asPrincipal(manager, (ctx) =>
    ctx.tx.execute(sql`select * from app.line_availability('order', ${sample.orderId}::uuid)`),
  );
  process.stdout.write(
    `\n=== app.line_availability() of a confirmed order: ${(performance.now() - t0).toFixed(1)} ms ===\n`,
  );
  const items = await asMigrator(
    (m) => m<{ id: string }[]>`
      select id from items where sku like ${`${PREFIX}${hub.slice(-6)}-%`} order by id limit 200`,
  );
  const lines = JSON.stringify(
    items.map((it, i) => ({
      line_id: null,
      position: i + 1,
      item_id: it.id,
      kit_id: null,
      qty: '3',
    })),
  );
  const t1 = performance.now();
  await asPrincipal(manager, (ctx) =>
    ctx.tx.execute(sql`select * from app.preview_availability(${E}::smallint, ${lines}::jsonb)`),
  );
  process.stdout.write(
    `\n=== app.preview_availability() of 200 lines: ${(performance.now() - t1).toFixed(1)} ms ===\n`,
  );

  // Everything written goes: the orders take their lines, needs and reservations with them.
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      await tx`set local session_replication_role = origin`;
      const orders = tx`select id from sales_orders where so_no like ${`${PREFIX}${hub.slice(-6)}/%`}`;
      await tx`alter table sales_order_lines disable trigger sales_order_lines_append_only`;
      await tx`delete from sales_order_lines where sales_order_id in (${orders})`;
      await tx`delete from sales_orders where so_no like ${`${PREFIX}${hub.slice(-6)}/%`}`;
      await tx`alter table sales_order_lines enable trigger sales_order_lines_append_only`;
      await tx`delete from tax_rates where source_ref = ${`${PREFIX}spike`}`;
      await tx`delete from account_entities where account_id = ${account}`;
      await tx`delete from accounts where id = ${account}`;
      await tx`delete from items where sku like ${`${PREFIX}${hub.slice(-6)}-%`}`;
      await tx`delete from bins where warehouse_id = ${hub}`;
      await tx`delete from warehouses where id = ${hub}`;
    });
  });
  await closeDb();
}

await main();
