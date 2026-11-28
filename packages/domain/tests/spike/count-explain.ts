// Stock count plans (H3, docs/03-roadmap-appendix/phase3.md §7.3):
// `pnpm --filter @shakti/domain exec tsx tests/spike/count-explain.ts`.
// Fills the local database with one made-up godown (code `CTX-H1`, 20 bins) holding 1,000 made-up
// items (codes under `CTX-`) in every bin, with ten earlier gains and losses on each, and 20,000
// earlier counts over four companies (kept between runs). Then starts a count of the whole hub
// (20,000 lines), counts it, moves stock in its bins before and after the count, and prints
// `EXPLAIN (ANALYZE, BUFFERS)` of the list, the counter's sheet and the review: the statements
// the queries run under the policies as the Inventory Manager, and the statements inside the
// definers through `auto_explain` (a migrator connection with the same request settings). It
// ends with the time of the post. Local database only (prepareDatabase refuses any other host).
// Not part of CI; it lives under tests/ for the testing helpers.
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
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  cancelStockCount,
  recordStockCount,
  startStockCount,
  submitStockCount,
} from '../../src/commands/inventory/counts';
import { postStockCount } from '../../src/commands/inventory/counts-post';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  getStockCountReview,
  getStockCountSheet,
  listStockCounts,
} from '../../src/queries/inventory/counts';
import { stockMove, type StockMoveLine } from '../../src/stock/move';

const ITEMS = 1_000;
const BINS = 20;
const HISTORY = 10;
const PAST_COUNTS = 20_000;
const PREFIX = 'CTX-';
const HUB = `${PREFIX}H1`;

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const out = (text: string) => process.stdout.write(text);

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
          out(
            `\n=== ${label} (statement ${String(n)}) ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
          );
          return target.execute(query);
        };
      },
    });
    return read({ ...ctx, tx });
  });
}

/**
 * The plans of the statements inside a definer: the request's settings copied into a migrator
 * connection (the definers run as their owner either way), with `auto_explain` sending each
 * nested statement's plan back as a notice. postgres.js hands a notice to `console.log` when its
 * connection has no handler, so the notices are caught there; a statement run once per line is
 * printed once, with how many times it ran and its slowest run.
 */
async function insideDefiner(label: string, principal: Principal, call: string): Promise<void> {
  const settings = await asPrincipal(principal, async ({ tx }) => {
    const [row] = (await tx.execute(sql`
      select current_setting('app.user_id') as user_id, current_setting('app.entity_ids') as entity_ids,
             current_setting('app.role') as role, current_setting('app.permissions') as permissions,
             current_setting('app.request_id') as request_id`)) as unknown as Record<
      string,
      string
    >[];
    return row ?? {};
  });
  await asMigrator(async (m) => {
    const notices: string[] = [];
    const log = console.log;
    const reserved = await m.reserve();
    try {
      await reserved`set auto_explain.log_min_duration = 0`;
      await reserved`set auto_explain.log_analyze = on`;
      await reserved`set auto_explain.log_buffers = on`;
      await reserved`set auto_explain.log_timing = on`;
      await reserved`set auto_explain.log_nested_statements = on`;
      await reserved`set auto_explain.log_level = 'notice'`;
      await reserved`set client_min_messages = notice`;
      await reserved`begin`;
      await reserved`select set_config('app.user_id', ${settings.user_id ?? ''}, true),
        set_config('app.entity_ids', ${settings.entity_ids ?? ''}, true),
        set_config('app.role', ${settings.role ?? ''}, true),
        set_config('app.permissions', ${settings.permissions ?? ''}, true),
        set_config('app.team_id', '', true), set_config('app.agent_thread_id', '', true),
        set_config('app.voice_session_id', '', true),
        set_config('app.request_id', ${settings.request_id ?? newId()}, true)`;
      console.log = (notice: { message?: string }) => {
        notices.push(notice.message ?? '');
      };
      await reserved.unsafe(call);
      console.log = log;
      await reserved`rollback`;
    } finally {
      console.log = log;
      reserved.release();
    }
    // Grouped by statement: its text up to the plan, then the slowest run's plan.
    const groups = new Map<string, { runs: number; slowest: number; plan: string }>();
    for (const notice of notices) {
      const ms = Number(/duration: ([\d.]+) ms/.exec(notice)?.[1] ?? '0');
      const text =
        notice.replace(/^duration:.*\n/, '').split(/\n(?=Query Parameters:|\S.*\(cost=)/)[0] ?? '';
      const group = groups.get(text) ?? { runs: 0, slowest: -1, plan: '' };
      group.runs += 1;
      if (ms > group.slowest) Object.assign(group, { slowest: ms, plan: notice });
      groups.set(text, group);
    }
    out(`\n=== ${label}: inside the definer ===\n`);
    for (const group of groups.values()) {
      out(`\n--- ran ${String(group.runs)} times, slowest ${group.slowest.toFixed(3)} ms ---\n`);
      out(`${group.plan}\n`);
    }
  });
}

async function seed(createdBy: string): Promise<{ hub: string; bins: string[]; items: string[] }> {
  return asMigrator(async (m) => {
    const [have] = await m<{ n: number }[]>`
      select count(*)::int as n from items where sku like ${`${PREFIX}%`}`;
    if ((have?.n ?? 0) < ITEMS) {
      await m`
        insert into items (id, sku, name, category, hsn, unit)
        select app.uuid_v7(), ${PREFIX} || lpad(g::text, 5, '0'), 'Made-up counted item ' || g,
               'cable', '8544', 'metre'
          from generate_series(${(have?.n ?? 0) + 1}::int, ${ITEMS}::int) g`;
    }
    await m`update items set archived_at = null, is_active = true where sku like ${`${PREFIX}%`}`;
    await m`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
      values (app.uuid_v7(), ${HUB}, 'Plan count godown', 'godown', '08', '302001', ${createdBy})
      on conflict do nothing`;
    await m`alter table warehouses disable trigger warehouses_guard`;
    await m`update warehouses set archived_at = null where code = ${HUB}`;
    await m`alter table warehouses enable trigger warehouses_guard`;
    const [hub] = await m<{ id: string }[]>`select id from warehouses where code = ${HUB}`;
    if (hub === undefined) throw new Error('no plan hub');
    await m`
      insert into bins (id, warehouse_id, code, kind, created_by)
      select app.uuid_v7(), ${hub.id}, 'C' || lpad(g::text, 2, '0'), 'storage', ${createdBy}
        from generate_series(1, ${BINS}::int) g
      on conflict do nothing`;
    const bins = await m<{ id: string }[]>`
      select id from bins where warehouse_id = ${hub.id} and code like 'C%' order by code`;
    const items = await m<{ id: string }[]>`
      select id from items where sku like ${`${PREFIX}%`} order by sku limit ${ITEMS}`;
    const [moved] = await m<{ n: number }[]>`
      select count(*)::int as n from stock_movements where ref_type = 'count_plan'`;
    if ((moved?.n ?? 0) === 0) {
      await m.begin(async (tx) => {
        const batch = newId();
        await tx`
          create temporary table plan_pairs on commit drop as
          select i.id as item_id, b.id as bin_id, (i.n * ${BINS} + b.n)::int as g
            from (select id, row_number() over (order by sku) - 1 as n from items where sku like ${`${PREFIX}%`}) i
           cross join (select id, row_number() over (order by code) - 1 as n from bins
                        where warehouse_id = ${hub.id} and code like 'C%') b`;
        // A gain of 50 a year ago, then ten gains and losses of 2 since, each pair a day apart.
        await tx`
          insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, ref_type, ref_id,
                                       batch_id, moved_at, moved_by)
          select app.uuid_v7(), 1, item_id, bin_id, 50, 'adjust_gain', 'count_plan', ${batch},
                 ${batch}, now() - interval '365 days', ${createdBy}
            from plan_pairs`;
        await tx`
          insert into stock_movements (id, entity_id, item_id, to_bin_id, from_bin_id, qty, reason,
                                       ref_type, ref_id, batch_id, moved_at, moved_by)
          select app.uuid_v7(), 1, item_id,
                 case when h % 2 = 0 then bin_id end, case when h % 2 = 1 then bin_id end, 2,
                 case when h % 2 = 0 then 'adjust_gain' else 'adjust_loss' end, 'count_plan',
                 ${batch}, ${batch}, now() - make_interval(days => 300 - h * 10 - g % 7), ${createdBy}
            from plan_pairs cross join generate_series(0, ${HISTORY * 2 - 1}::int) h`;
        await tx`
          insert into stock_movement_costs (movement_id, entity_id, unit_cost)
          select m.id, 1, 40 from stock_movements m where m.ref_type = 'count_plan'`;
        await tx`
          insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand, last_moved_at)
          select app.uuid_v7(), 1, ${hub.id}, bin_id, item_id, 50, now() - interval '100 days'
            from plan_pairs
          on conflict (entity_id, warehouse_id, bin_id, item_id) do update set qty_on_hand = 50`;
        await tx`
          insert into item_costs (id, entity_id, item_id, moving_avg_cost, last_positive_avg_cost, as_of)
          select app.uuid_v7(), 1, i.id, 40, 40, now() from items i where i.sku like ${`${PREFIX}%`}
          on conflict do nothing`;
      });
    }
    const [past] = await m<{ n: number }[]>`
      select count(*)::int as n from stock_counts where warehouse_id = ${hub.id} and state = 'posted'`;
    if ((past?.n ?? 0) < PAST_COUNTS) {
      await m`
        insert into stock_counts (id, entity_id, warehouse_id, scope, state, started_at, started_by,
                                  submitted_at, submitted_by, posted_at, posted_by, post_note)
        select app.uuid_v7(), (1 + g % 4)::smallint, ${hub.id}, 'hub', 'posted',
               now() - make_interval(hours => 400 + g), ${createdBy},
               now() - make_interval(hours => 399 + g), ${createdBy},
               now() - make_interval(hours => 398 + g), ${createdBy}, 'Earlier count'
          from generate_series(${past?.n ?? 0}::int, ${PAST_COUNTS - 1}::int) g`;
    }
    for (const table of [
      'items',
      'bins',
      'stock_movements',
      'stock_balances',
      'stock_counts',
      'stock_count_lines',
    ]) {
      await m.unsafe(`analyze ${table}`);
    }
    return { hub: hub.id, bins: bins.map((b) => b.id), items: items.map((i) => i.id) };
  });
}

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function main(): Promise<void> {
  await prepareDatabase();
  const exec = await createTestPrincipal('executive');
  const manager = await createTestPrincipal('inventory_manager', [1]);
  const { hub, bins, items } = await seed(exec.id);
  const [first, second] = bins;
  if (first === undefined || second === undefined) throw new Error('no bins');
  // Cancel what an earlier run left live.
  const live = await asMigrator(
    (m) => m<{ id: string }[]>`
      select id from stock_counts
       where warehouse_id = ${hub} and state in ('open', 'counting', 'review')`,
  );
  for (const { id } of live) {
    await run(manager, cancelStockCount, { countId: id, cancelReason: 'Plan run ended' });
  }

  let started = performance.now();
  const count = await run<{ id: string }>(manager, startStockCount, {
    entityId: 1,
    hubId: hub,
    scope: 'hub',
  });
  out(`\ninventory.count.start, whole hub: ${(performance.now() - started).toFixed(0)} ms\n`);

  // Before the counter reaches the first bins: 50 transfers between them, one of each item.
  const transfer = (from: string, to: string, n: number): StockMoveLine[] =>
    items.slice(0, n).map((itemId) => ({
      reason: 'transfer',
      entityId: 1,
      itemId,
      fromBinId: from,
      toBinId: to,
      qty: '1',
    }));
  await asPrincipal(manager, ({ tx }) => stockMove(tx, transfer(first, second, 50)));
  // The first item in the first bin counted through the command (the count moves to counting),
  // then every other line, every tenth one short by one, as the record definer would leave it.
  await run(manager, recordStockCount, {
    countId: count.id,
    binId: first,
    itemId: items[0],
    qty: '50',
  });
  await asMigrator(
    (m) => m`
      update stock_count_lines
         set counted_qty = expected_qty - case when row_n % 10 = 0 then 1 else 0 end,
             counted_by = ${manager.id}, counted_at = now()
        from (select id, row_number() over (order by id) as row_n
                from stock_count_lines where count_id = ${count.id} and counted_at is null) n
       where n.id = stock_count_lines.id`,
  );
  // After the count: 50 more transfers back, left alone by the post.
  await asPrincipal(manager, ({ tx }) => stockMove(tx, transfer(second, first, 50)));
  await asMigrator((m) => m`analyze stock_count_lines`);

  const page = await explained('count list, first page of company 1', manager, (ctx) =>
    listStockCounts(ctx, { entityId: 1, limit: 50 }),
  );
  await explained('count list, next page', manager, (ctx) =>
    listStockCounts(ctx, { entityId: 1, limit: 50, cursor: page.nextCursor ?? undefined }),
  );
  await explained('count list, posted only', manager, (ctx) =>
    listStockCounts(ctx, { entityId: 1, state: 'posted', limit: 50 }),
  );
  await explained('count list, in review only', manager, (ctx) =>
    listStockCounts(ctx, { entityId: 1, state: 'review', limit: 50 }),
  );

  started = performance.now();
  const sheet = await asPrincipal(manager, (ctx) => getStockCountSheet(ctx, { countId: count.id }));
  out(
    `\nthe counter's sheet: ${String(sheet.rows.length)} rows, ${String(JSON.stringify(sheet).length)} characters, ${(performance.now() - started).toFixed(0)} ms\n`,
  );
  await explained('the counter’s sheet', manager, (ctx) =>
    getStockCountSheet(ctx, { countId: count.id }),
  );
  await insideDefiner(
    'app.stock_count_sheet()',
    manager,
    `select count(*) from app.stock_count_sheet('${count.id}'::uuid)`,
  );
  await insideDefiner(
    'app.stock_count_progress()',
    manager,
    `select * from app.stock_count_progress('${count.id}'::uuid)`,
  );

  await run(manager, submitStockCount, { countId: count.id });
  started = performance.now();
  const review = await asPrincipal(manager, (ctx) =>
    getStockCountReview(ctx, { countId: count.id }),
  );
  out(
    `\nthe review: ${String(review.lines.length)} lines, ${String(review.movements.length)} movements during the count, ${(performance.now() - started).toFixed(0)} ms\n`,
  );
  await explained('the review', manager, (ctx) => getStockCountReview(ctx, { countId: count.id }));
  await explained('the review, with values (Executive)', exec, (ctx) =>
    getStockCountReview(ctx, { countId: count.id }),
  );
  await insideDefiner(
    'app.stock_count_review()',
    manager,
    `select count(*) from app.stock_count_review('${count.id}'::uuid)`,
  );

  started = performance.now();
  const posted = await run<{ movementIds: string[] }>(manager, postStockCount, {
    countId: count.id,
    note: 'Plan count of the made-up godown',
  });
  out(
    `\ninventory.count.post: ${String(posted.movementIds.length)} movements, ${(performance.now() - started).toFixed(0)} ms\n`,
  );

  const [left] = await asMigrator(
    (m) => m<{ lines: number; counts: number; movements: number }[]>`
      select (select count(*)::int from stock_count_lines) as lines,
             (select count(*)::int from stock_counts) as counts,
             (select count(*)::int from stock_movements) as movements`,
  );
  out(`\nrows: ${JSON.stringify(left)}\n`);
  await asMigrator(async (m) => {
    await m`update items set archived_at = now(), is_active = false where sku like ${`${PREFIX}%`}`;
    // Archived, so H1's hub commands pair no new hub with it.
    await m`alter table warehouses disable trigger warehouses_guard`;
    await m`update warehouses set archived_at = now() where code = ${HUB}`;
    await m`alter table warehouses enable trigger warehouses_guard`;
  });
  await closeDb();
}

await main();
