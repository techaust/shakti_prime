// Quote list plans (docs/03-roadmap-appendix/phase1.md §7.3, brief S1): `pnpm --filter @shakti/domain
// spike:quotes`. Fills the local database with made-up leads and 20,000 made-up quotes in company
// 2 (customers named `EXPLQ customer …`, quote numbers under `EXPLQ/`), the leads spread over a
// Lead Converter, the rest of a team and the company, then prints `EXPLAIN (ANALYZE, BUFFERS)` for
// `/quotes`, its status filter, the ⌘K search, Account 360's quotes and the board's two new reads,
// run under the policies as an Executive, a General Manager and the Lead Converter, as the screens
// run them. Everything it made is removed at the end. Local database only (prepareDatabase refuses
// any other host). Not part of CI; it lives under tests/ for the testing helpers.
import { newId, type Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { quoteListQuery, quoteSearchQuery } from '../../src/queries/sales/list-quotes';

const ENTITY = 2;
const LEADS = 2000;
const QUOTES = 20_000;
const MINE = 200;

/** The query with its parameters written in, so `explain` can run it as one statement. */
function inline(query: { sql: string; params: unknown[] }): string {
  let text = query.sql;
  for (let i = query.params.length; i >= 1; i -= 1) {
    const value = query.params[i - 1];
    const literal =
      typeof value === 'number'
        ? String(value)
        : value instanceof Date
          ? `'${value.toISOString()}'`
          : `'${String(value).replaceAll("'", "''")}'`;
    text = text.replaceAll(`$${String(i)}`, literal);
  }
  return text;
}

async function explainText(label: string, principal: Principal, text: string): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${text}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function explain(
  label: string,
  principal: Principal,
  build: (ctx: RequestContext) => { toSQL(): { sql: string; params: unknown[] } },
): Promise<void> {
  const text = await asPrincipal(principal, (ctx) => Promise.resolve(inline(build(ctx).toSQL())));
  await explainText(label, principal, text);
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from quotes where quote_no like 'EXPLQ/%'`;
      await tx`delete from opportunities where account_id in
                 (select id from accounts where name like 'EXPLQ customer %')`;
      await tx`delete from account_entities where account_id in
                 (select id from accounts where name like 'EXPLQ customer %')`;
      await tx`delete from accounts where name like 'EXPLQ customer %'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const team = await createTestTeam(ENTITY, 'explain quotes team');
  const lc = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  const other = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  const exec = await createTestPrincipal('executive');
  const gm = await createTestPrincipal('general_manager', [ENTITY]);
  const list = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [pipeline] = await tx<{ id: string; stage: string }[]>`
        select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                       order by s.position limit 1) as stage
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
      if (!pipeline) throw new Error('no farmer_pumps pipeline');
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${list}, (select id from price_tiers where code = 'retail'), ${ENTITY},
                       ${9300 + Math.floor(Math.random() * 1e5)}, '2090-01-01', now())`;
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'farm', 'EXPLQ customer ' || g, ${exec.id}
                 from generate_series(1, ${LEADS}::int) g`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
               select app.uuid_v7(), a.id, ${ENTITY},
                      case when row_number() over (order by a.id) <= ${MINE} then ${lc.id}::uuid
                           else ${other.id}::uuid end,
                      ${team}, ${exec.id}
                 from accounts a where a.name like 'EXPLQ customer %'`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
               select app.uuid_v7(), ${ENTITY}, ae.account_id, ${pipeline.id}, ${pipeline.stage},
                      ae.owner_id, ae.team_id, ${exec.id}
                 from account_entities ae join accounts a on a.id = ae.account_id
                where a.name like 'EXPLQ customer %'`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, state,
                 subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_at, created_by)
               with o as (
                 select id, account_id, row_number() over (order by id) as rn from opportunities
                  where account_id in (select id from accounts where name like 'EXPLQ customer %'))
               select app.uuid_v7(), ${ENTITY}, 'EXPLQ/' || lpad(g::text, 6, '0'), '2026-27', o.id,
                      o.account_id, (select id from price_tiers where code = 'retail'), ${list}, 'none',
                      '08', 'intra', now() - (g || ' minutes')::interval + interval '15 days',
                      (array['draft', 'sent', 'sent', 'expired', 'superseded'])[1 + g % 5],
                      1000, 90, 90, 0, 180, 0, 1180, now() - (g || ' minutes')::interval, ${exec.id}
                 from generate_series(1, ${QUOTES}::int) g
                 join o on o.rn = 1 + (g % ${LEADS})`;
      await tx`analyze quotes`;
      await tx`analyze opportunities`;
    }),
  );

  const now = new Date();
  const firstPage = { limit: 50 };
  await explain('/quotes, Executive, company 2', exec, (ctx) =>
    quoteListQuery({ ...ctx, entityIds: [ENTITY] }, { ...firstPage, entityId: ENTITY }, now),
  );
  await explain('/quotes, Executive, every company', exec, (ctx) =>
    quoteListQuery(ctx, firstPage, now),
  );
  await explain('/quotes, General Manager, company 2, sent', gm, (ctx) =>
    quoteListQuery(ctx, { ...firstPage, entityId: ENTITY, state: 'sent' }, now),
  );
  await explain('/quotes, Lead Converter (own leads), company 2', lc, (ctx) =>
    quoteListQuery(ctx, { ...firstPage, entityId: ENTITY }, now),
  );
  await explain('⌘K quote number, Executive, every company', exec, (ctx) =>
    quoteSearchQuery(ctx, { q: 'EXPLQ/012345', limit: 8 }),
  );
  await explain('⌘K quote number serial, Lead Converter', lc, (ctx) =>
    quoteSearchQuery(ctx, { q: '0123', limit: 8 }),
  );
  const [account] = await asMigrator(
    (m) => m<{ account_id: string }[]>`
      select account_id from quotes where quote_no = 'EXPLQ/000100'`,
  );
  await explainText(
    "Account 360's quotes, Lead Converter",
    lc,
    `select q.id, q.quote_no from quotes q join accounts a on a.id = q.account_id
      where q.account_id = '${account?.account_id ?? ''}' and q.entity_id = ${String(ENTITY)}
      order by q.created_at desc, q.id desc limit 20`,
  );
  const leads = await asMigrator(
    (m) => m<{ id: string }[]>`
      select o.id from opportunities o join accounts a on a.id = o.account_id
       where a.name like 'EXPLQ customer %' limit 50`,
  );
  const ids = leads.map((l) => `'${l.id}'`).join(', ');
  await explainText(
    'board: time in stage of 50 cards, Executive',
    exec,
    `select opportunity_id, max(created_at) from activities
      where opportunity_id in (${ids}) and type = 'stage_moved' group by opportunity_id`,
  );
  await explainText(
    'board: sized kWp or HP of 50 cards, Executive',
    exec,
    `select distinct on (s.opportunity_id) s.opportunity_id, s.kind,
            s.result_json -> 'power' ->> 'standardHp', s.result_json -> 'rooftop' ->> 'recommendedKwp'
       from sizings s join principals p on p.id = s.created_by and p.kind = 'user'
      where s.opportunity_id in (${ids}) and s.engine_version = '2'
      order by s.opportunity_id, s.created_at desc, s.id desc`,
  );
  await cleanUp();
  await asMigrator((m) => m`update price_lists set archived_at = now() where id = ${list}`);
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await closeDb();
    process.exit(1);
  });
