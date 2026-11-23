// Stock ledger plans (H1, docs/03-roadmap-appendix/phase3.md §5 "Reads", brief point 8):
// `pnpm --filter @shakti/domain exec tsx tests/spike/stock-explain.ts`.
// Fills the local database up to 20,000 made-up items (codes under `STX-`), 200 bins in two hubs
// and two million movements with their costs and the balances they leave (one gain of 10 and one
// loss of 3 for each of a million company, bin and item, written as the table owner, set-based,
// kept between runs), then prints `EXPLAIN (ANALYZE, BUFFERS)` of every statement the stock list,
// the stock card and the valuation run, under the policies as an Inventory Manager and Accounts,
// and the time of `app.stock_move()` for batches of 50. Local database only (prepareDatabase
// refuses any other host). Not part of CI; it lives under tests/ for the testing helpers.
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
import {
  getStockCard,
  listStockBalances,
  readStockValuation,
} from '../../src/queries/inventory/stock';
import { stockMove, type StockMoveLine } from '../../src/stock/move';

const ITEMS = 20_000;
const BINS = 200;
const PAIRS = 1_000_000;
const PREFIX = 'STX-';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * Runs `read` with a transaction that also explains every statement it executes, printing each
 * plan under `label`; the read gets its real rows.
 */
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

async function seed(createdBy: string): Promise<{ hubs: string[]; bins: string[] }> {
  return asMigrator(async (m) => {
    const [have] = await m<{ n: number }[]>`
      select count(*)::int as n from items where sku like ${`${PREFIX}%`}`;
    if ((have?.n ?? 0) < ITEMS) {
      await m`
        insert into items (id, sku, name, category, hsn, unit)
        select app.uuid_v7(), ${PREFIX} || lpad(g::text, 5, '0'), 'Made-up stock item ' || g,
               (array['pump', 'cable', 'pipe', 'solar_module', 'structure'])[1 + g % 5], '8544', 'metre'
          from generate_series(${(have?.n ?? 0) + 1}::int, ${ITEMS}::int) g`;
    }
    await m`update items set archived_at = null, is_active = true where sku like ${`${PREFIX}%`}`;
    const hubs = [`${PREFIX}H1`, `${PREFIX}H2`];
    for (const [i, code] of hubs.entries()) {
      await m`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (app.uuid_v7(), ${code}, ${`Plan hub ${String(i + 1)}`}, 'godown', '08', '302001', ${createdBy})
        on conflict do nothing`;
    }
    const hubRows = await m<{ id: string }[]>`
      select id from warehouses where code = any(${hubs}) order by code`;
    for (const hub of hubRows) {
      await m`
        insert into bins (id, warehouse_id, code, kind, created_by)
        select app.uuid_v7(), ${hub.id}, 'P' || lpad(g::text, 3, '0'), 'storage', ${createdBy}
          from generate_series(1, ${BINS / 2}::int) g
        on conflict do nothing`;
    }
    const bins = await m<{ id: string }[]>`
      select b.id from bins b join warehouses w on w.id = b.warehouse_id
       where w.code = any(${hubs}) and b.code like 'P%' order by w.code, b.code`;
    const [moved] = await m<{ n: number }[]>`
      select count(*)::int as n from stock_movements where ref_type = 'stock_plan'`;
    if ((moved?.n ?? 0) === 0) {
      await m.begin(async (tx) => {
        const batch = newId();
        // Pair g: item g mod 20,000, bin (g div 20,000 + g) mod 200, company 1 + (g div 7) mod 4 —
        // each pair once, spread over every bin; a gain of 10 at its cost, then a loss of 3 at it.
        await tx`
          create temporary table plan_pairs on commit drop as
          select g, i.id as item_id, b.id as bin_id, b.warehouse_id as hub_id,
                 (1 + (g / 7) % 4)::smallint as entity_id,
                 now() - make_interval(days => g % 730) as at,
                 (10 + g % 90)::numeric(14, 4) as cost
            from generate_series(0, ${PAIRS - 1}::int) g
            join (select id, row_number() over (order by sku) - 1 as n from items where sku like ${`${PREFIX}%`}) i
              on i.n = g % ${ITEMS}
            join (select b.id, b.warehouse_id, row_number() over (order by w.code, b.code) - 1 as n
                    from bins b join warehouses w on w.id = b.warehouse_id
                   where w.code = any(${hubs}) and b.code like 'P%') b
              on b.n = (g / ${ITEMS} + g) % ${BINS}`;
        await tx`
          insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, ref_type, ref_id,
                                       batch_id, moved_at, moved_by)
          select app.uuid_v7(), entity_id, item_id, bin_id, 10, 'adjust_gain', 'stock_plan', ${batch},
                 ${batch}, at, ${createdBy}
            from plan_pairs`;
        await tx`
          insert into stock_movements (id, entity_id, item_id, from_bin_id, qty, reason, ref_type, ref_id,
                                       batch_id, moved_at, moved_by)
          select app.uuid_v7(), entity_id, item_id, bin_id, 3, 'adjust_loss', 'stock_plan', ${batch},
                 ${batch}, at + interval '1 hour', ${createdBy}
            from plan_pairs`;
        await tx`
          insert into stock_movement_costs (movement_id, entity_id, unit_cost)
          select m.id, m.entity_id, p.cost
            from stock_movements m
            join plan_pairs p on p.item_id = m.item_id and p.entity_id = m.entity_id
                             and p.bin_id = coalesce(m.to_bin_id, m.from_bin_id)
           where m.ref_type = 'stock_plan'`;
        await tx`
          insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand, last_moved_at)
          select app.uuid_v7(), entity_id, hub_id, bin_id, item_id, 7, at + interval '1 hour'
            from plan_pairs
          on conflict (entity_id, warehouse_id, bin_id, item_id)
            do update set qty_on_hand = stock_balances.qty_on_hand + 7`;
      });
    }
    for (const table of [
      'items',
      'bins',
      'warehouses',
      'stock_movements',
      'stock_movement_costs',
      'stock_balances',
    ]) {
      await m.unsafe(`analyze ${table}`);
    }
    return { hubs: hubRows.map((h) => h.id), bins: bins.map((b) => b.id) };
  });
}

async function main(): Promise<void> {
  await prepareDatabase();
  const exec = await createTestPrincipal('executive');
  const manager = await createTestPrincipal('inventory_manager', [1]);
  const accounts = await createTestPrincipal('accounts', [1]);
  const { hubs, bins } = await seed(exec.id);
  const [counts] = await asMigrator(
    (m) => m<{ movements: number; balances: number; items: number }[]>`
      select (select count(*)::int from stock_movements) as movements,
             (select count(*)::int from stock_balances) as balances,
             (select count(*)::int from items) as items`,
  );
  process.stdout.write(`\nrows: ${JSON.stringify(counts)}\n`);

  const first = await explained('stock list, first page of company 1', manager, (ctx) =>
    listStockBalances(ctx, { entityId: 1, limit: 50 }),
  );
  await explained('stock list, next page', manager, (ctx) =>
    listStockBalances(ctx, { entityId: 1, limit: 50, cursor: first.nextCursor ?? undefined }),
  );
  await explained('stock list, one hub and the category cable', manager, (ctx) =>
    listStockBalances(ctx, { entityId: 1, hubId: hubs[1], category: 'cable', limit: 50 }),
  );
  await explained('stock list, one bin', manager, (ctx) =>
    listStockBalances(ctx, { entityId: 1, binId: bins[150], limit: 50 }),
  );
  await explained('stock list, stock code starting STX-1234', manager, (ctx) =>
    listStockBalances(ctx, { entityId: 1, search: 'STX-1234', limit: 50 }),
  );
  const [item] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select m.item_id as id from stock_movements m
       where m.entity_id = 1 and m.ref_type = 'stock_plan' limit 1`,
  );
  await explained('stock card of one item, newest first', manager, (ctx) =>
    getStockCard(ctx, { entityId: 1, itemId: item?.id ?? '', limit: 50 }),
  );
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  await explained('valuation of company 1 today', accounts, (ctx) =>
    readStockValuation(ctx, { entityId: 1, asOf: today }),
  );

  // app.stock_move() for batches of 50 transfers of 50 items between two bins, ten times.
  const pairs = await asMigrator(
    (m) => m<{ item: string }[]>`
      select b.item_id as item from stock_balances b
       where b.entity_id = 1 and b.bin_id = ${bins[0] ?? ''} and b.qty_on_hand >= 7 limit 50`,
  );
  const times: number[] = [];
  for (let round = 0; round < 10; round += 1) {
    const forward = round % 2 === 0;
    const lines: StockMoveLine[] = pairs.map((p) => ({
      reason: 'transfer',
      entityId: 1,
      itemId: p.item,
      fromBinId: (forward ? bins[0] : bins[1]) ?? null,
      toBinId: (forward ? bins[1] : bins[0]) ?? null,
      qty: '1',
    }));
    const started = performance.now();
    await asPrincipal(manager, ({ tx }) => stockMove(tx, lines));
    times.push(performance.now() - started);
  }
  const plan = await asPrincipal(manager, async ({ tx }) => {
    const payload = JSON.stringify(
      pairs.map((p) => ({
        reason: 'transfer',
        entity_id: 1,
        item_id: p.item,
        from_bin_id: bins[0],
        to_bin_id: bins[1],
        qty: '1',
      })),
    );
    const rows = (await tx.execute(
      sql`explain (analyze, buffers, costs off) select app.stock_move(${payload}::jsonb)`,
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== app.stock_move(), a batch of 50 transfers ===\n${plan}\n`);
  process.stdout.write(
    `\napp.stock_move() batches of ${String(pairs.length)}: ${times.map((t) => t.toFixed(0)).join(', ')} ms\n`,
  );
  await asMigrator(
    (m) =>
      m`update items set archived_at = now(), is_active = false where sku like ${`${PREFIX}%`}`,
  );
  await closeDb();
}

await main();
