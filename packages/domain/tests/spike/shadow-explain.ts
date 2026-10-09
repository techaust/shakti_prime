// The shadow report's and the AI spend's plans (docs/03-roadmap-appendix/phase1.md §9, A1):
// `pnpm --filter @shakti/domain spike:shadow`. Fills the local database with made-up rows in
// company 2 (3,000 leads; 60 days of the Triage agent's runs, four a lead, 12,000 shadowed actions
// and 3,000 refused runs, beside 20,000 runs of another agent) and prints
// `EXPLAIN (ANALYZE, BUFFERS)` for the report's page, its summary, its refused runs and the AI
// spend, run under the policies as an Executive and a General Manager. Everything it made is
// removed at the end. Local database only (prepareDatabase refuses any other host). Not part of CI.
import { AGENT_PRINCIPAL_IDS, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
  PIPELINE_SEED,
  stageId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { istEndAfter, istStart, shadowedSql } from '../../src/queries/agents/shadow-report';

const E = 2;
const TRIAGE = AGENT_PRINCIPAL_IDS['agent:triage'];
const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];
const PURPOSE = 'explain_spike';

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
      await tx`alter table agent_actions disable trigger agent_actions_append_only`;
      await tx`alter table agent_runs disable trigger agent_runs_append_only`;
      await tx`delete from agent_actions where run_id in (select id from agent_runs where purpose = ${PURPOSE})`;
      await tx`delete from agent_runs where purpose = ${PURPOSE}`;
      await tx`alter table agent_actions enable trigger agent_actions_append_only`;
      await tx`alter table agent_runs enable trigger agent_runs_append_only`;
      await tx`delete from opportunities where account_id in (select id from accounts where name like 'EXPLS %')`;
      await tx`delete from account_entities where account_id in (select id from accounts where name like 'EXPLS %')`;
      await tx`delete from accounts where name like 'EXPLS %'`;
    }),
  );
}

async function main() {
  await prepareDatabase();
  await clean();
  const exec = await createTestPrincipal('executive');
  const gm = await createTestPrincipal('general_manager', [E]);
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('no pipeline');

  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by)
      select gen_random_uuid(), 'farm', 'EXPLS account ' || g, ${exec.id} from generate_series(1, 3000) g`;
    await m`insert into account_entities (id, account_id, entity_id, created_by)
      select gen_random_uuid(), a.id, ${E}, ${exec.id} from accounts a where a.name like 'EXPLS account %'`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, created_by, created_at)
      select gen_random_uuid(), ${E}, a.id, ${pipeline.id}, ${stageId(1, 1)}, ${exec.id},
             now() - (random() * interval '60 days')
        from accounts a where a.name like 'EXPLS account %'`;
    // Four runs a lead at its creation, three of them shadowed and one refused by the filter.
    await m`
      with leads as (
        select o.id, o.created_at, row_number() over () as n from opportunities o
          join accounts a on a.id = o.account_id where a.name like 'EXPLS account %'),
      kinds(kind, action_type) as (values
        (1, 'triage.pipeline.choose'), (2, 'triage.score.adjust'),
        (3, 'crm.opportunity.assign'), (4, 'crm.duplicate.suggest')),
      runs as (
        insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome,
                                filter_reason, cost_paise, request_id, created_at)
        select gen_random_uuid(), ${E}::smallint, 'agent:triage', ${TRIAGE}::uuid, ${PURPOSE}::text, k.action_type,
               case when k.kind = 4 then 'filtered' else 'shadowed' end,
               case when k.kind = 4 then 'unknown_candidate' end,
               case when k.kind = 1 then 15 else 0 end, 'explain', l.created_at
          from leads l cross join kinds k
        returning id, action_type, created_at)
      insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy,
                                 state, created_by, created_at)
      select gen_random_uuid(), ${E}::smallint, r.id, 'agent:triage', r.action_type,
             jsonb_build_object('entityId', ${E}::int, 'opportunityId', l.id)
               || case r.action_type
                    when 'triage.pipeline.choose' then jsonb_build_object('pipelineKey', 'farmer_pumps')
                    when 'triage.score.adjust' then jsonb_build_object('adjustment', 5, 'score', 55)
                    else jsonb_build_object('ownerId', ${exec.id}::uuid) end,
             'shadow', 'shadowed', ${TRIAGE}::uuid, r.created_at
        from runs r join leads l on l.created_at = r.created_at
       where r.action_type <> 'crm.duplicate.suggest'`;
    // Another agent's runs in the same months, which the spend reads and the report never does.
    await m`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome,
                                    cost_paise, request_id, created_at)
      select gen_random_uuid(), ${E}, 'agent:copilot', ${COPILOT}, ${PURPOSE}, 'crm.task.create',
             'nothing_to_do', 3, 'explain', now() - (random() * interval '60 days')
        from generate_series(1, 20000)`;
    await m`analyze agent_actions`;
    await m`analyze agent_runs`;
  });

  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() + 330 * 60_000 - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = istStart(monthAgo);
  const until = istEndAfter(today);
  const base = shadowedSql(E, from, until);
  const page = sql`select * from (${base}) s order by s.created_at desc, s.id desc limit 51`;
  const summary = sql`select s.action_type, s.agreement, count(*)::int from (${base}) s
                       group by s.action_type, s.agreement`;
  const refused = sql`select r.action_type, r.filter_reason, count(*)::int from agent_runs r
     where r.entity_id = ${E} and r.agent = 'agent:triage' and r.outcome = 'filtered'
       and r.created_at >= ${from}::timestamptz and r.created_at < ${until}::timestamptz
     group by r.action_type, r.filter_reason`;
  const day = `${today}T00:00:00+05:30`;
  const month = `${today.slice(0, 8)}01T00:00:00+05:30`;
  const spend = sql`select r.agent, r.entity_id,
           coalesce(sum(r.cost_paise) filter (where r.created_at >= ${day}::timestamptz), 0)::text,
           coalesce(sum(r.cost_paise), 0)::text,
           count(*)::int
      from agent_runs r
     where r.entity_id = any(${`{1,2,3,4}`}::smallint[]) and r.created_at >= ${month}::timestamptz
     group by r.agent, r.entity_id`;

  await explain('shadow report, first page of 30 days, the Executive', exec, page);
  await explain('shadow report, first page of 30 days, the GM', gm, page);
  await explain('shadow report, summary of 30 days, the Executive', exec, summary);
  await explain('shadow report, refused runs of 30 days, the Executive', exec, refused);
  await explain('AI spend this month, the Executive', exec, spend);

  await clean();
  await closeDb();
}

await main();
