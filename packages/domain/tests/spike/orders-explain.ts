// Order and dealer credit plans (docs/03-roadmap-appendix/phase1.md §8.3, brief S2): `pnpm --filter
// @shakti/domain spike:orders`. Fills the local database with made-up customers, leads and quotes
// in company 2 (customers named `EXPLO customer …`, dealers `EXPLO dealer …`, numbers under
// `EXPLO/`): 2,000 orders of accepted quotes and 18,000 orders of 200 dealers, each dealer with
// terms and an outstanding entry. Then prints `EXPLAIN (ANALYZE, BUFFERS)` for `/orders`, its
// status filter, Account 360's orders, `/dealer-credit` and the confirmation's credit position,
// run under the policies as an Executive, a General Manager, a Lead Converter and Accounts, as the
// screens run them. Everything it made is removed at the end. Local database only
// (prepareDatabase refuses any other host). Not part of CI; it lives under tests/ for the helpers.
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
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { dealerCreditQuery } from '../../src/queries/sales/dealer-credit';
import { salesOrderListQuery } from '../../src/queries/sales/list-orders';

const ENTITY = 2;
const LEADS = 2000;
const DEALERS = 200;
const DEALER_ORDERS = 18_000;
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
          : value === null
            ? 'null'
            : `'${(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll("'", "''")}'`;
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

/** A raw `sql` fragment as one statement with its parameters written in. */
async function explainSql(
  label: string,
  principal: Principal,
  build: (ctx: RequestContext) => SQL,
): Promise<void> {
  const text = await asPrincipal(principal, (ctx) => {
    const query = new PgDialect().sqlToQuery(build(ctx));
    return Promise.resolve(inline(query));
  });
  await explainText(label, principal, text);
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const customers = tx`select id from accounts where name like 'EXPLO %'`;
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      await tx`delete from dealer_terms where account_id in (${customers})`;
      await tx`delete from dealer_outstanding where account_id in (${customers})`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`delete from sales_orders where so_no like 'EXPLO/%'`;
      await tx`delete from quotes where quote_no like 'EXPLO/%'`;
      await tx`delete from opportunities where account_id in (${customers})`;
      await tx`delete from account_entities where account_id in (${customers})`;
      await tx`delete from accounts where name like 'EXPLO %'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const team = await createTestTeam(ENTITY, 'explain orders team');
  const lc = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  const other = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  const exec = await createTestPrincipal('executive');
  const gm = await createTestPrincipal('general_manager', [ENTITY]);
  const accounts = await createTestPrincipal('accounts', [ENTITY]);
  const list = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [pipeline] = await tx<{ id: string; stage: string }[]>`
        select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                       order by s.position limit 1) as stage
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
      if (!pipeline) throw new Error('no farmer_pumps pipeline');
      const tier = tx`(select id from price_tiers where code = 'dealer')`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${list}, ${tier}, ${ENTITY}, ${9400 + Math.floor(Math.random() * 1e5)},
                       '2090-01-01', now())`;
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'farm', 'EXPLO customer ' || g, ${exec.id}
                 from generate_series(1, ${LEADS}::int) g`;
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'dealer', 'EXPLO dealer ' || lpad(g::text, 4, '0'), ${exec.id}
                 from generate_series(1, ${DEALERS}::int) g`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
               select app.uuid_v7(), a.id, ${ENTITY},
                      case when row_number() over (order by a.id) <= ${MINE} then ${lc.id}::uuid
                           else ${other.id}::uuid end,
                      ${team}, ${exec.id}
                 from accounts a where a.name like 'EXPLO %'`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
               select app.uuid_v7(), ${ENTITY}, ae.account_id, ${pipeline.id}, ${pipeline.stage},
                      ae.owner_id, ae.team_id, ${exec.id}
                 from account_entities ae join accounts a on a.id = ae.account_id
                where a.name like 'EXPLO customer %'`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, state,
                 accepted_via, signed_file_id, subtotal, cgst, sgst, igst, tax_total, round_off,
                 grand_total, created_by)
               select app.uuid_v7(), ${ENTITY}, 'EXPLO/Q/' || row_number() over (order by o.id),
                      '2026-27', o.id, o.account_id, ${tier}, ${list}, 'none', '08', 'intra',
                      now() + interval '15 days', 'accepted', 'whatsapp_reply', null,
                      1000, 90, 90, 0, 180, 0, 1180, ${exec.id}
                 from opportunities o
                where o.account_id in (select id from accounts where name like 'EXPLO customer %')`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                 tier_id, price_list_id, place_of_supply_state, supply_kind, state, confirmed_at,
                 confirmed_by, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total,
                 created_at, created_by)
               select app.uuid_v7(), ${ENTITY}, 'EXPLO/L/' || row_number() over (order by q.id),
                      '2026-27', q.id, q.opportunity_id, q.account_id, ${tier}, ${list}, '08',
                      'intra', 'confirmed', now(), ${exec.id}, 1000, 90, 90, 0, 180, 0, 1180,
                      now() - (row_number() over (order by q.id) || ' minutes')::interval, ${exec.id}
                 from quotes q where q.quote_no like 'EXPLO/Q/%'`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id, price_list_id,
                 place_of_supply_state, supply_kind, state, confirmed_at, confirmed_by, cancel_reason,
                 subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_at, created_by)
               with d as (
                 select id, row_number() over (order by id) as rn from accounts
                  where name like 'EXPLO dealer %')
               select app.uuid_v7(), ${ENTITY}, 'EXPLO/D/' || lpad(g::text, 6, '0'), '2026-27',
                      d.id, ${tier}, ${list}, '08', 'intra',
                      (array['draft', 'confirmed', 'confirmed', 'cancelled'])[1 + g % 4],
                      case when g % 4 in (1, 2) then now() - (g || ' minutes')::interval end,
                      case when g % 4 in (1, 2) then ${exec.id}::uuid end,
                      case when g % 4 = 3 then 'made up' end,
                      1000, 90, 90, 0, 180, 0, 1180, now() - (g || ' minutes')::interval, ${exec.id}
                 from generate_series(1, ${DEALER_ORDERS}::int) g
                 join d on d.rn = 1 + (g % ${DEALERS})`;
      await tx`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by)
               select app.uuid_v7(), ${ENTITY}, a.id, 100000, 30, ${exec.id}
                 from accounts a, generate_series(1, 3) g where a.name like 'EXPLO dealer %'`;
      await tx`insert into dealer_outstanding (id, entity_id, account_id, outstanding, as_of, entered_by)
               select app.uuid_v7(), ${ENTITY}, a.id, 5000, current_date - g, ${exec.id}
                 from accounts a, generate_series(1, 5) g where a.name like 'EXPLO dealer %'`;
      await tx`analyze sales_orders`;
      await tx`analyze accounts`;
      await tx`analyze account_entities`;
      await tx`analyze dealer_terms`;
      await tx`analyze dealer_outstanding`;
    }),
  );

  const firstPage = { limit: 50 };
  await explain('/orders, Executive, company 2', exec, (ctx) =>
    salesOrderListQuery({ ...ctx, entityIds: [ENTITY] }, { ...firstPage, entityId: ENTITY }),
  );
  await explain('/orders, Executive, every company', exec, (ctx) =>
    salesOrderListQuery(ctx, firstPage),
  );
  await explain('/orders, General Manager, company 2, confirmed', gm, (ctx) =>
    salesOrderListQuery(ctx, { ...firstPage, entityId: ENTITY, state: 'confirmed' }),
  );
  await explain('/orders, Lead Converter (own leads and dealers), company 2', lc, (ctx) =>
    salesOrderListQuery(ctx, { ...firstPage, entityId: ENTITY }),
  );
  const [dealer] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from accounts where name = 'EXPLO dealer 0001'`,
  );
  await explainText(
    "Account 360's orders of a dealer, Executive",
    exec,
    `select so.id, so.so_no from sales_orders so join accounts a on a.id = so.account_id
      where so.account_id = '${dealer?.id ?? ''}' and so.entity_id = ${String(ENTITY)}
      order by so.created_at desc, so.id desc limit 20`,
  );
  await explainSql('/dealer-credit, Accounts, company 2', accounts, (ctx) =>
    dealerCreditQuery(ctx, { entityId: ENTITY, limit: 50 }),
  );
  await explainText(
    "a dealer's credit position (the confirmation's exposure), Accounts",
    accounts,
    `select * from app.dealer_credit_position(${String(ENTITY)}::smallint, '${dealer?.id ?? ''}'::uuid, null)`,
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
