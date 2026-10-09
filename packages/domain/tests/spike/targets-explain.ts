// Targets and home page plans (docs/03-roadmap-appendix/phase1.md §9, brief R1): `pnpm --filter
// @shakti/domain spike:targets`. Fills the local database with made-up rows in company 2 (a team
// of 25 callers, 6,000 leads, 30,000 calls, 4,000 stage moves, 3,000 confirmed orders, 1,500
// quotes, 200 dealers with credit entries, 600 targets) and prints `EXPLAIN (ANALYZE, BUFFERS)`
// for the progress definer, the target in force, the history, the pipeline by stage, the response
// times, the month's sales and the dealer credit counts, run under the policies as the callers,
// team lead, General Manager, Executive and Accounts run them. Everything it made is removed at
// the end. Local database only (prepareDatabase refuses any other host). Not part of CI.
import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  prepareDatabase,
  PIPELINE_SEED,
  stageId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import {
  creditSummarySql,
  pipelineByStageSql,
  responseTimeSql,
  salesThisMonthSql,
} from '../../src/queries/home/home';
import { periodBounds, periodStartOn } from '../../src/sales/targets';
import { teamQueueCountsSql } from '../../src/queries/calls/call-queue';
import {
  effectiveTargetsSql,
  targetActualsSql,
  targetHistorySql,
  currentStarts,
} from '../../src/queries/sales/targets';

const E = 2;
const NOW = new Date();
const TIER = newId();
const LIST = newId();

async function explain(label: string, principal: Principal, query: ReturnType<typeof sql>) {
  const plan = await asPrincipal(principal, async (ctx) => {
    const text = new (await import('drizzle-orm/pg-core')).PgDialect().sqlToQuery(query);
    let q = text.sql;
    for (let i = text.params.length; i >= 1; i -= 1) {
      const v = text.params[i - 1];
      const lit =
        typeof v === 'number'
          ? String(v)
          : `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
      q = q.replaceAll(`$${String(i)}`, lit);
    }
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${q}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function clean() {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table targets disable trigger targets_append_only`;
      await tx`delete from targets where team_id in (select id from teams where name = 'EXPLT team')`;
      await tx`alter table targets enable trigger targets_append_only`;
      await tx`alter table calls disable trigger calls_append_only`;
      await tx`delete from calls where opportunity_id in (select id from opportunities where owner_id in (select id from principals where display_name like 'EXPLT %'))`;
      await tx`alter table calls enable trigger calls_append_only`;
      await tx`delete from sales_orders where tier_id = ${TIER} or so_no like 'EXPLT/%'`;
      await tx`delete from quotes where quote_no like 'EXPLT/%'`;
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      await tx`delete from dealer_terms where account_id in (select id from accounts where name like 'EXPLT %')`;
      await tx`delete from dealer_outstanding where account_id in (select id from accounts where name like 'EXPLT %')`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`delete from opportunities where account_id in (select id from accounts where name like 'EXPLT %')`;
      await tx`delete from account_entities where account_id in (select id from accounts where name like 'EXPLT %')`;
      await tx`delete from accounts where name like 'EXPLT %'`;
    }),
  );
}

async function main() {
  await prepareDatabase();
  await clean();
  const team = await createTestTeam(E, 'EXPLT team');
  await asMigrator((m) => m`update teams set name = 'EXPLT team' where id = ${team}`);
  const callers: Principal[] = [];
  for (let i = 0; i < 25; i += 1) {
    const u = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc', teamId: team }], {
      name: `EXPLT caller ${i}`,
    });
    await asMigrator(
      (m) => m`update principals set display_name = ${`EXPLT caller ${i}`} where id = ${u.id}`,
    );
    callers.push(await createTestPrincipal('tele_caller_cc', [E], { id: u.id, teamId: team }));
  }
  const leadUser = await createTestUser([
    { entityId: E, roleKey: 'sales_team_lead', teamId: team },
  ]);
  const lead = await createTestPrincipal('sales_team_lead', [E], { id: leadUser.id, teamId: team });
  const gm = await createTestPrincipal('general_manager', [E]);
  const exec = await createTestPrincipal('executive');
  const accounts = await createTestPrincipal('accounts', [E]);
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('no pipeline');
  const ids = callers.map((c) => c.id);

  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by)
      select gen_random_uuid(), case when g <= 200 then 'dealer' else 'farm' end, 'EXPLT account ' || g, ${exec.id}
        from generate_series(1, 6000) g`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
      select gen_random_uuid(), a.id, ${E}, ${ids[0] ?? ''}, ${team}, ${exec.id} from accounts a where a.name like 'EXPLT account %'`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by, created_at)
      select gen_random_uuid(), ${E}, a.id, ${pipeline.id}, ${stageId(1, 1)},
             (${ids}::uuid[])[1 + (row_number() over ())::int % 25], ${team}, ${exec.id},
             now() - ((row_number() over ())::int % 400) * interval '1 hour'
        from accounts a where a.name like 'EXPLT account %' and a.type = 'farm'`;
    await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
      select gen_random_uuid(), ${E}, o.id, o.owner_id, 'outbound', 'manual',
             (select id from call_dispositions where entity_id is null and segment is null and archived_at is null order by position limit 1),
             1, now() - (g % 60) * interval '12 hours'
        from (select id, owner_id from opportunities where owner_id = any(${ids}::uuid[]) and entity_id = ${E} limit 6000) o
        cross join generate_series(1, 5) g`;
    await m`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json, created_at)
      select gen_random_uuid(), ${E}, o.id, o.account_id, 'stage_moved', o.owner_id,
             jsonb_build_object('toStageKey', case when g % 4 = 0 then 'qualified' else 'quoted' end),
             now() - (g % 40) * interval '1 day'
        from (select id, account_id, owner_id from opportunities where owner_id = any(${ids}::uuid[]) and entity_id = ${E} limit 4000) o
        cross join generate_series(1, 1) g`;
    await m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id, price_list_id, scheme,
                  place_of_supply_state, supply_kind, valid_until, state, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
        select gen_random_uuid(), ${E}, 'EXPLT/' || row_number() over (), '2098-99', o.id, o.account_id, ${TIER}, ${LIST}, 'none', '08', 'intra',
               now() + interval '10 days', case when row_number() over () % 3 = 0 then 'sent' else 'draft' end, 0, 0, 0, 0, 0, 0, 0, ${exec.id}
          from (select id, account_id from opportunities where entity_id = ${E} limit 1500) o`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, tier_id, place_of_supply_state, supply_kind,
                  state, confirmed_at, confirmed_by, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
        select gen_random_uuid(), ${E}, 'EXPLT/' || row_number() over (), '2098-99', gen_random_uuid(), o.id, o.account_id, ${TIER}, '08', 'intra',
               'confirmed', now() - (row_number() over () % 30) * interval '1 day', o.owner_id, 100, 0, 0, 0, 0, 0, 100, ${exec.id}
          from (select id, account_id, owner_id from opportunities where owner_id = any(${ids}::uuid[]) and entity_id = ${E} limit 3000) o`;
    });
    await m`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by)
      select gen_random_uuid(), ${E}, a.id, 100000, 30, ${exec.id} from accounts a where a.name like 'EXPLT account %' and a.type = 'dealer'`;
    await m`insert into dealer_outstanding (id, entity_id, account_id, outstanding, as_of, entered_by)
      select gen_random_uuid(), ${E}, a.id, 5000, (now() at time zone 'Asia/Kolkata')::date, ${exec.id} from accounts a where a.name like 'EXPLT account %' and a.type = 'dealer'`;
    await m`insert into targets (id, entity_id, scope, subject_id, team_id, metric, period, starts_on, value, set_by)
      select gen_random_uuid(), ${E}, 'caller', (${ids}::uuid[])[1 + g % 25], ${team}, (array['calls','qualified','orders','kw'])[1 + g % 4],
             'day', date '2026-01-01' + (g % 150), 10 + g % 50, ${exec.id}
        from generate_series(1, 600) g`;
    await m`analyze`;
  });

  const starts = currentStarts(NOW);
  const day = periodBounds('day', periodStartOn('day', NOW));
  const month = periodBounds('month', periodStartOn('month', NOW));
  const caller = callers[0] as Principal;
  await explain(
    'target_actuals, a caller for themselves, today',
    caller,
    targetActualsSql(E, day.from, day.to, [caller.id]),
  );
  await explain(
    'target_actuals, the team lead for 25 callers, today',
    lead,
    targetActualsSql(E, day.from, day.to, ids),
  );
  await explain(
    'target_actuals, the team lead for 25 callers, this month',
    lead,
    targetActualsSql(E, month.from, month.to, ids),
  );
  await explain(
    'targets in force, the team lead, 25 callers',
    lead,
    effectiveTargetsSql(E, 'caller', ids, starts),
  );
  await explain(
    'targets in force, a caller, self',
    caller,
    effectiveTargetsSql(E, 'caller', [caller.id], starts),
  );
  await explain('history, the team lead', lead, targetHistorySql(E, 30));
  await explain('history, the GM', gm, targetHistorySql(E, 30));
  await explain('home queue counts, a caller', caller, teamQueueCountsSql([caller.id], [E], NOW));
  await explain('pipeline by stage, the GM', gm, pipelineByStageSql([E]));
  await explain('pipeline by stage, the Executive', exec, pipelineByStageSql([1, 2, 3, 4]));
  await explain('response times, the GM', gm, responseTimeSql([E], NOW));
  await explain(
    'sales this month, the Executive',
    exec,
    salesThisMonthSql([1, 2, 3, 4], month.from, month.to),
  );
  await explain('dealer credit counts, Accounts', accounts, creditSummarySql([E]));

  await clean();
  await closeDb();
}

await main();
