// Temporary EXPLAIN (ANALYZE) evidence for the AI0 lists; not committed.
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL_MIGRATOR, { max: 1 });
const COPILOT = '01990000-0000-7000-8000-000000000303';

function settings(role, perms, user, team, entities) {
  return `select set_config('app.user_id', '${user}', true), set_config('app.entity_ids', '{${entities}}', true),
                 set_config('app.role', '${role}', true), set_config('app.permissions', '${perms}', true),
                 set_config('app.team_id', '${team ?? ''}', true), set_config('app.request_id', 'explain', true)`;
}

const INBOX_LIST = (cursorless) => `explain (analyze, buffers, costs off)
  select i.*, a.agent, a.action_type, a.autonomy, a.input_json, acc.name, acc.id
    from inbox_items i
    left join agent_actions a on a.id = i.agent_action_id and a.entity_id = i.entity_id
    left join opportunities o on i.subject_type = 'opportunity' and o.id = i.subject_id
    left join accounts acc on acc.id = case when i.subject_type = 'account' then i.subject_id else o.account_id end
   where i.state = 'open' and i.entity_id in (1) ${cursorless}
   order by i.created_at desc, i.id desc limit 51`;
const COUNT = `explain (analyze, buffers, costs off)
  select count(*)::int from (select 1 from inbox_items where state = 'open' and entity_id = any('{1}'::int[]) limit 100) x`;
const SPEND = `explain (analyze, buffers, costs off)
  select agent, coalesce(sum(cost_paise), 0)::bigint, count(*)::int from agent_runs
   where entity_id in (1) and created_at >= now() - interval '1 day' group by agent`;
const RECORD = `explain (analyze, buffers, costs off)
  select agent, action_type, count(*) filter (where state in ('approved','rejected'))::int,
         count(*) filter (where state = 'approved' and not edited)::int
    from agent_actions where entity_id = 1 group by agent, action_type`;

(async () => {
  await sql.begin(async (tx) => {
    // Volume: 20,000 runs and suggestions in company 1, spread over 50 people and 5 teams; rolled back.
    const [team] = await tx`select id from teams where entity_id = 1 limit 1`;
    const people = await tx`select id from principals where kind = 'user' limit 50`;
    await tx.unsafe(`
      create temp table p as select id, row_number() over () as n from principals where kind = 'user' limit 50;
      insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome, request_id, cost_paise, created_at)
        select gen_random_uuid(), 1, 'agent:copilot', '${COPILOT}', 'explain', 'crm.task.create', 'proposed', 'explain', 3,
               now() - (g % 30) * interval '1 day'
          from generate_series(1, 20000) g;
      insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy, state, created_by, decided_by, decided_at)
        select gen_random_uuid(), 1, r.id, 'agent:copilot', 'crm.task.create', '{}'::jsonb, 'suggest',
               case when row_number() over () % 3 = 0 then 'proposed' else 'approved' end, '${COPILOT}',
               case when row_number() over () % 3 = 0 then null else (select id from p limit 1) end,
               case when row_number() over () % 3 = 0 then null else now() end
          from agent_runs r where r.purpose = 'explain';
      insert into inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type, subject_id, state, agent_action_id, created_by, done_by, done_at, created_at)
        select gen_random_uuid(), 1, 'agent_suggestion', (select id from p where n = 1 + (row_number() over () % 50)),
               null, 'opportunity', gen_random_uuid(),
               case when a.state = 'proposed' then 'open' else 'done' end, a.id, '${COPILOT}',
               case when a.state = 'proposed' then null else a.decided_by end,
               case when a.state = 'proposed' then null else now() end,
               now() - (row_number() over () % 1000) * interval '1 minute'
          from agent_actions a join agent_runs r on r.id = a.run_id where r.purpose = 'explain';
      analyze inbox_items; analyze agent_actions; analyze agent_runs;
    `);
    const caller = people[1].id;
    await tx.unsafe('set local role app_user');
    const cases = [
      ['tele-caller, own scope', settings('tele_caller_cc', 'agents.inbox.act:own', caller, team?.id, '1')],
      ['general manager, company scope', settings('general_manager', 'agents.inbox.act:own,agents.inbox.act:team,agents.inbox.act:entity,agents.killswitch:own,agents.killswitch:team,agents.killswitch:entity,agents.killswitch:all', caller, null, '1')],
    ];
    for (const [label, set] of cases) {
      await tx.unsafe(set);
      for (const [name, q] of [['listInbox', INBOX_LIST('')], ['countInbox', COUNT]]) {
        const plan = await tx.unsafe(q);
        console.log(`\n=== ${name}: ${label}`);
        for (const row of plan) console.log(row['QUERY PLAN']);
      }
    }
    for (const [name, q] of [['loadAgentSettings spend today', SPEND], ['loadAgentSettings record', RECORD]]) {
      const plan = await tx.unsafe(q);
      console.log(`\n=== ${name}: general manager`);
      for (const row of plan) console.log(row['QUERY PLAN']);
    }
    throw new Error('rollback');
  }).catch((e) => { if (e.message !== 'rollback') throw e; });
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
