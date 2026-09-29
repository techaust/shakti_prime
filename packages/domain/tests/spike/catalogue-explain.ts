// Catalogue list plans (design §6.1, brief C1): `pnpm --filter @shakti/domain spike:catalogue`.
// Fills the local database up to 5,000 catalogue items (made-up codes and names under the `EXPL-`
// prefix, kept between runs), prices them all on one list of a tier of its own and gives one item
// a history of changes across three lists, then prints `EXPLAIN (ANALYZE, BUFFERS)` for the items
// grid and the change log, run under the policies as a Store reader and an Executive, as the
// screens run them. Local database only (prepareDatabase refuses any other host). Not part of CI;
// it lives under tests/ for the testing helpers.
import { newId, type Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { itemsQuery } from '../../src/queries/catalogue/list-items';
import { priceChangesQuery } from '../../src/queries/pricing/price-history';

const TARGET = 5000;
const PREFIX = 'EXPL-';

/** The query with its parameters written in, so `explain` can run it as one statement. */
function inline(query: { sql: string; params: unknown[] }): string {
  let text = query.sql;
  for (let i = query.params.length; i >= 1; i -= 1) {
    const value = query.params[i - 1];
    const literal =
      typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    text = text.replaceAll(`$${String(i)}`, literal);
  }
  return text;
}

async function explain(
  label: string,
  principal: Principal,
  build: (ctx: Pick<RequestContext, 'tx'>) => { toSQL(): { sql: string; params: unknown[] } },
): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const text = inline(build(ctx).toSQL());
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${text}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function main(): Promise<void> {
  await prepareDatabase();
  const exec = await createTestPrincipal('executive');
  const tier = { id: newId(), code: `expl_${newId().slice(-6)}` };
  const itemId = await asMigrator(async (m) => {
    const [count] = await m<{ n: number }[]>`
      select count(*)::int as n from items where sku like ${`${PREFIX}%`}`;
    const have = count?.n ?? 0;
    if (have < TARGET) {
      await m`
        insert into items (id, sku, name, category, hsn, unit)
        select app.uuid_v7(), ${PREFIX} || lpad(g::text, 5, '0'), 'Made-up item ' || g,
               (array['pump', 'cable', 'pipe', 'solar_module', 'other'])[1 + g % 5], '8413', 'nos'
          from generate_series(${have + 1}::int, ${TARGET}::int) g`;
    }
    await m`insert into price_tiers (id, code, name) values (${tier.id}, ${tier.code}, 'Plan tier')`;
    const lists = [newId(), newId(), newId()];
    for (const [i, id] of lists.entries()) {
      await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
        values (${id}, ${tier.id}, null, ${i + 1}, '2026-04-01', now())`;
    }
    await m`
      insert into price_list_items (id, price_list_id, item_id, price, created_by)
      select app.uuid_v7(), ${lists[0] ?? ''}, i.id, 1000, ${exec.id}
        from items i where i.sku like ${`${PREFIX}%`}`;
    const [first] = await m<{ id: string }[]>`select id from items where sku = ${`${PREFIX}00001`}`;
    const firstId = first?.id ?? '';
    for (const listId of lists.slice(1)) {
      await m`insert into price_list_items (id, price_list_id, item_id, price, created_by)
        values (app.uuid_v7(), ${listId}, ${firstId}, 1100, ${exec.id})`;
    }
    await m`update price_list_items set price = price + 1, updated_by = ${exec.id} where item_id = ${firstId}`;
    await m`update price_tiers set is_active = false, archived_at = now() where id = ${tier.id}`;
    await m`analyze items`;
    await m`analyze price_list_items`;
    await m`analyze price_change_log`;
    return firstId;
  });

  const store = principalFor('store_manager', [1]);
  await explain('items grid, first page by name', store, (ctx) => itemsQuery(ctx, {}));
  await explain('items grid, last change first', store, (ctx) =>
    itemsQuery(ctx, { sort: { column: 'updated', direction: 'desc' } }),
  );
  await explain('items grid, pumps whose name or code holds "0042"', store, (ctx) =>
    itemsQuery(ctx, { category: 'pump', q: '0042' }),
  );
  await explain('change log of one item, newest first', exec, (ctx) =>
    priceChangesQuery(ctx, { itemId, limit: 25 }),
  );
  await closeDb();
}

await main();
