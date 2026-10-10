// Converter board plans (docs/03-roadmap-appendix/phase1.md §9, brief L1): `pnpm --filter @shakti/domain
// spike:converting`. Fills the local database with 20,000 made-up leads in company 2 (customers
// named `EXPLC customer …`), 150 of them the Lead Converter's own at Qualified and the rest
// spread over twenty colleagues, each with a callback, a sizing and a quote, and a held order
// on some, then prints `EXPLAIN (ANALYZE, BUFFERS)` for the board's lead query and each read of
// facts for the converter's 150 leads, run under the policies as the Lead Converter, as their
// team lead and as an Executive. Everything it made is removed at the end. Local database only
// (prepareDatabase refuses any other host). Not part of CI; it lives under tests/ for the testing
// helpers.
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
import {
  callbacksQuery,
  convertingLeadsQuery,
  heldOrdersQuery,
  loadConvertingBoard,
  quotesQuery,
  sizedLeadsQuery,
} from '../../src/queries/crm/converting-board';

const ENTITY = 2;
const LEADS = 20_000;
const MINE = 150;

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

async function explain(
  label: string,
  principal: Principal,
  build: (ctx: RequestContext) => { toSQL(): { sql: string; params: unknown[] } },
): Promise<void> {
  const text = await asPrincipal(principal, (ctx) => Promise.resolve(inline(build(ctx).toSQL())));
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${text}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from sales_orders where so_no like 'EXPLC/%'`;
      await tx`delete from quotes where quote_no like 'EXPLC/%'`;
      await tx`alter table sizings disable trigger sizings_append_only`;
      await tx`delete from sizings where opportunity_id in (select o.id from opportunities o
                 join accounts a on a.id = o.account_id where a.name like 'EXPLC customer %')`;
      await tx`alter table sizings enable trigger sizings_append_only`;
      await tx`delete from tasks where opportunity_id in (select o.id from opportunities o
                 join accounts a on a.id = o.account_id where a.name like 'EXPLC customer %')`;
      await tx`delete from opportunities where account_id in
                 (select id from accounts where name like 'EXPLC customer %')`;
      await tx`delete from account_entities where account_id in
                 (select id from accounts where name like 'EXPLC customer %')`;
      await tx`delete from accounts where name like 'EXPLC customer %'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const team = await createTestTeam(ENTITY, 'explain converting team');
  const lc = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  const teamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { teamId: team });
  const exec = await createTestPrincipal('executive');
  const colleagues: Principal[] = [];
  for (let n = 0; n < 20; n += 1) {
    colleagues.push(await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team }));
  }
  const list = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [pipeline] = await tx<{ id: string; stage: string }[]>`
        select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                       and s.key = 'qualified') as stage
          from pipelines p where p.key = 'residential_rooftop' and p.entity_id is null`;
      if (!pipeline) throw new Error('no residential_rooftop pipeline');
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${list}, (select id from price_tiers where code = 'retail'), ${ENTITY},
                       ${9400 + Math.floor(Math.random() * 1e5)}, '2090-01-01', now())`;
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'household', 'EXPLC customer ' || g, ${exec.id}
                 from generate_series(1, ${LEADS}::int) g`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
               select app.uuid_v7(), a.id, ${ENTITY},
                      case when row_number() over (order by a.id) <= ${MINE} then ${lc.id}::uuid
                           else (${colleagues.map((c) => c.id)}::uuid[])[1 + (row_number() over (order by a.id))::int % 20] end,
                      ${team}, ${exec.id}
                 from accounts a where a.name like 'EXPLC customer %'`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
               select app.uuid_v7(), ${ENTITY}, ae.account_id, ${pipeline.id}, ${pipeline.stage},
                      ae.owner_id, ae.team_id, ${exec.id}
                 from account_entities ae join accounts a on a.id = ae.account_id
                where a.name like 'EXPLC customer %'`;
      await tx`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at, created_by)
               select app.uuid_v7(), o.entity_id, o.id, o.account_id, o.owner_id, 'callback',
                      now() + (random() * 100 - 50 || ' hours')::interval, ${exec.id}
                 from opportunities o join accounts a on a.id = o.account_id
                where a.name like 'EXPLC customer %'`;
      await tx`insert into sizings (id, entity_id, opportunity_id, kind, inputs_json, result_json,
                                    in_bounds, reasons_json, engine_version, created_by)
               select app.uuid_v7(), o.entity_id, o.id, 'rooftop', '{}'::jsonb,
                      '{"rooftop": {"recommendedKwp": 3}}'::jsonb, true, '[]'::jsonb, '2', ${exec.id}
                 from opportunities o join accounts a on a.id = o.account_id
                where a.name like 'EXPLC customer %'`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, state,
                 subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
               select app.uuid_v7(), o.entity_id, 'EXPLC/' || lpad(row_number() over ()::text, 6, '0'),
                      '2026-27', o.id, o.account_id, (select id from price_tiers where code = 'retail'),
                      ${list}, 'none', '08', 'intra', now() + interval '15 days', 'sent',
                      1000, 90, 90, 0, 180, 0, 1180, ${exec.id}
                 from opportunities o join accounts a on a.id = o.account_id
                where a.name like 'EXPLC customer %'`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                 tier_id, price_list_id, place_of_supply_state, supply_kind, state, credit_held_at,
                 credit_hold_reason, credit_hold_json, subtotal, cgst, sgst, igst, tax_total,
                 round_off, grand_total, created_by)
               select app.uuid_v7(), q.entity_id, 'EXPLC/SO/' || q.quote_no, '2026-27', q.id,
                      q.opportunity_id, q.account_id, q.tier_id, ${list}, '08', 'intra', 'draft', now(),
                      'credit_limit_missing', '{}'::jsonb, 1000, 0, 0, 0, 0, 0, 1000, ${exec.id}
                 from quotes q where q.quote_no like 'EXPLC/%' and right(q.quote_no, 1) = '7'`;
      await tx`analyze opportunities`;
      await tx`analyze tasks`;
      await tx`analyze sizings`;
      await tx`analyze quotes`;
    }),
  );

  const mine = await asMigrator(
    (m) => m<{ id: string }[]>`select id from opportunities where owner_id = ${lc.id} limit 200`,
  );
  const ids = mine.map((r) => r.id);
  const now = new Date();
  for (const [who, principal, owner] of [
    ['Lead Converter', lc, lc.id],
    ['team lead, for the converter', teamLead, lc.id],
    ['Executive, for the converter', exec, lc.id],
  ] as const) {
    await explain(`board leads, ${who}`, principal, (ctx) =>
      convertingLeadsQuery(ctx, owner, [ENTITY]),
    );
  }
  await explain('callbacks of 150 leads, Lead Converter', lc, (ctx) =>
    callbacksQuery(ctx, ids, lc.id),
  );
  await explain('quotes of 150 leads, Lead Converter', lc, (ctx) => quotesQuery(ctx, ids));
  await explain('sized leads of 150 leads, Lead Converter', lc, (ctx) => sizedLeadsQuery(ctx, ids));
  await explain('held orders of 150 leads, Lead Converter', lc, (ctx) => heldOrdersQuery(ctx, ids));
  const started = performance.now();
  const board = await asPrincipal(lc, (ctx) => loadConvertingBoard(ctx, {}, now));
  process.stdout.write(
    `\nwhole board, Lead Converter: ${String(board.leads.length)} leads, ${String(board.actions.length)} rows, ${String(Math.round(performance.now() - started))} ms\n`,
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
