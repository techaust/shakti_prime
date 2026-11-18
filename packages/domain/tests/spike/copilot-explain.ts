// The Caller Co-pilot's plans (docs/03-roadmap-appendix/phase2.md §7.3, A2):
// `pnpm --filter @shakti/domain spike:copilot`. Fills the local database with made-up rows in
// company 2 (3,000 leads, each with a brief, an ended dial and its summary, half of them logged,
// over 60 days, with an assignment event each, a brief request for a third and as many events of
// another type) and prints `EXPLAIN (ANALYZE, BUFFERS)` for the panel's reads (the newest brief
// and summary of a lead and the caller's own latest dial, as its tele-caller; when a brief was last
// started, as `app.copilot_brief_started_at()` reads it) and the shadow report's (its page, its two
// summaries, the summaries callers saw and the refused runs, as an Executive). Everything it made is removed at the end. Local database
// only (prepareDatabase refuses any other host). Not part of CI.
import { AGENT_PRINCIPAL_IDS, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  prepareDatabase,
  PIPELINE_SEED,
  stageId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { copilotSummariesSql } from '../../src/queries/agents/copilot';
import { istEndAfter, istStart } from '../../src/queries/agents/shadow-report';

const E = 2;
const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];
const MARK = 'EXPLCP';

async function explain(label: string, principal: Principal, query: ReturnType<typeof sql>) {
  const plan = await asPrincipal(principal, async (ctx) => {
    const text = new PgDialect().sqlToQuery(query);
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

/** A definer's query, explained as the definer's owner runs it. */
async function explainAsOwner(label: string, query: ReturnType<typeof sql>) {
  const text = new PgDialect().sqlToQuery(query);
  let q = text.sql;
  for (let i = text.params.length; i >= 1; i -= 1) {
    const v = text.params[i - 1];
    q = q.replaceAll(`$${String(i)}`, typeof v === 'number' ? String(v) : `'${String(v)}'`);
  }
  const rows = await asMigrator((m) => m.unsafe(`explain (analyze, buffers, costs off) ${q}`));
  const plan = (rows as unknown as Record<string, string>[])
    .map((r) => Object.values(r)[0])
    .join('\n');
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function clean() {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const leads = tx`select o.id from opportunities o join accounts a on a.id = o.account_id
                        where a.name like ${`${MARK} %`}`;
      // The spike's events carry its mark; the outbox keeps every other row as it is.
      await tx`alter table outbox_events disable trigger outbox_events_delivery_only`;
      await tx`delete from outbox_events where payload_json ->> 'mark' = ${MARK}`;
      await tx`alter table outbox_events enable trigger outbox_events_delivery_only`;
      await tx`alter table copilot_notes disable trigger copilot_notes_append_only`;
      await tx`alter table provider_calls disable trigger provider_calls_no_delete`;
      await tx`delete from copilot_notes where opportunity_id in (${leads})`;
      await tx`delete from provider_calls where opportunity_id in (${leads})`;
      await tx`alter table copilot_notes enable trigger copilot_notes_append_only`;
      await tx`alter table provider_calls enable trigger provider_calls_no_delete`;
      await tx`delete from calls where opportunity_id in (${leads})`;
      await tx`delete from opportunities where id in (${leads})`;
      await tx`delete from account_entities where account_id in (select id from accounts where name like ${`${MARK} %`})`;
      await tx`delete from accounts where name like ${`${MARK} %`}`;
    }),
  );
}

async function main() {
  await prepareDatabase();
  await clean();
  const exec = await createTestPrincipal('executive');
  const user = await createTestUser([{ entityId: E, roleKey: 'tele_caller_lc' }]);
  const caller = await createTestPrincipal('tele_caller_lc', [E], { id: user.id });
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('no pipeline');

  await asMigrator(async (m) => {
    const [outcome] = await m<{ id: string }[]>`
      select id from call_dispositions where entity_id is null and archived_at is null
       order by position limit 1`;
    if (outcome === undefined) throw new Error('no call outcome');
    await m`insert into accounts (id, type, name, created_by)
      select gen_random_uuid(), 'farm', ${`${MARK} `} || g, ${exec.id} from generate_series(1, 3000) g`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
      select gen_random_uuid(), a.id, ${E}, ${caller.id}, ${exec.id} from accounts a where a.name like ${`${MARK} %`}`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_by, created_at)
      select gen_random_uuid(), ${E}, a.id, ${pipeline.id}, ${stageId(1, 1)}, ${caller.id}, ${exec.id},
             now() - (random() * interval '60 days')
        from accounts a where a.name like ${`${MARK} %`}`;
    // Each lead: an ended dial, its summary with an outcome, a brief, and for half a logged call.
    await m`
      with leads as (
        select o.id, o.created_at, row_number() over () as n from opportunities o
          join accounts a on a.id = o.account_id where a.name like ${`${MARK} %`}),
      dials as (
        insert into provider_calls (id, entity_id, opportunity_id, caller_id, direction, series, purpose,
                                    status, started_at, ended_at, duration_s)
        select gen_random_uuid(), ${E}::smallint, l.id, ${caller.id}::uuid, 'outbound', '140', 'promotional',
               'completed', l.created_at, l.created_at + interval '4 minutes', 240
          from leads l
        returning id, opportunity_id, started_at)
      insert into copilot_notes (id, entity_id, opportunity_id, provider_call_id, kind, body, fields_json,
                                 suggested_disposition_id, created_at, created_by)
      select gen_random_uuid(), ${E}::smallint, d.opportunity_id, d.id, 'call_summary',
             'Farmer wants a pump.', '{"pumpDepthFt":120}'::jsonb, ${outcome.id}::uuid,
             d.started_at + interval '6 minutes', ${COPILOT}::uuid
        from dials d`;
    await m`insert into copilot_notes (id, entity_id, opportunity_id, kind, body, created_at, created_by)
      select gen_random_uuid(), ${E}, o.id, 'brief', 'Ask the bore depth first.', o.created_at, ${COPILOT}
        from opportunities o join accounts a on a.id = o.account_id where a.name like ${`${MARK} %`}`;
    // Each lead's assignment, a brief asked for on a third, and as many events of another type,
    // all published (the spike's own mark in the payload, so its clean-up finds them).
    for (const [type, every] of [
      ['crm.opportunity.assigned', 1],
      ['agents.brief.requested', 3],
      ['crm.lead.created', 1],
    ] as const) {
      await m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json,
                                         created_at, published_at)
        select gen_random_uuid(), ${E}, ${type}, 'opportunity', o.id::text,
               jsonb_build_object('v', 1, 'mark', ${MARK}::text), o.created_at, o.created_at
          from opportunities o join accounts a on a.id = o.account_id
         where a.name like ${`${MARK} %`} and (substr(a.name, ${MARK.length + 2})::int % ${every}) = 0`;
    }
    await m`analyze outbox_events`;
    await m`analyze copilot_notes`;
    await m`analyze provider_calls`;
  });

  const [lead] = await asMigrator(
    (m) => m<
      { id: string }[]
    >`select o.id from opportunities o join accounts a on a.id = o.account_id
                                where a.name like ${`${MARK} %`} limit 1`,
  );
  if (lead === undefined) throw new Error('no lead');
  const brief = sql`select n.id, n.kind, n.body, n.fields_json, n.provider_call_id,
                           n.suggested_disposition_id, d.label, n.created_at
                      from copilot_notes n left join call_dispositions d on d.id = n.suggested_disposition_id
                     where n.opportunity_id = ${lead.id} and n.kind = 'brief'
                     order by n.created_at desc, n.id desc limit 1`;
  const summary = sql`select n.id, n.body, d.label, n.created_at, pc.call_id is not null as logged
                        from copilot_notes n
                        join provider_calls pc on pc.id = n.provider_call_id
                         and pc.opportunity_id = n.opportunity_id and pc.direction = 'outbound'
                        left join call_dispositions d on d.id = n.suggested_disposition_id
                       where n.opportunity_id = ${lead.id} and n.kind = 'call_summary'
                       order by n.created_at desc, n.id desc limit 1`;

  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() + 330 * 60_000 - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = istStart(monthAgo);
  const until = istEndAfter(today);
  const base = copilotSummariesSql(E, from, until);
  const page = sql`select * from (${copilotSummariesSql(E, from, until, { after: undefined, limit: 51 })}) s
                     order by s.created_at desc, s.id desc`;
  const outcomes = sql`select count(*) filter (where s.outcome_agreement = 'agree')::int from (${base}) s`;
  const refused = sql`select r.filter_reason, count(*)::int from agent_runs r
     where r.entity_id = ${E} and r.agent = 'agent:copilot' and r.outcome = 'filtered'
       and r.created_at >= ${from}::timestamptz and r.created_at < ${until}::timestamptz
     group by r.filter_reason`;

  const ownDial = sql`select pc.id, pc.call_id is not null as logged from provider_calls pc
                       where pc.opportunity_id = ${lead.id} and pc.entity_id = ${E}
                         and pc.direction = 'outbound' and pc.caller_id = ${caller.id}
                       order by pc.started_at desc, pc.id desc limit 1`;
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const started = sql`select max(e.created_at) from outbox_events e
     where e.aggregate_id = ${lead.id} and e.type in ('agents.brief.requested', 'crm.opportunity.assigned')
       and e.created_at > ${hourAgo}::timestamptz and e.entity_id = ${E} and e.aggregate_type = 'opportunity'
       and (e.type = 'agents.brief.requested'
            or not exists (select 1 from copilot_notes n
                            where n.opportunity_id = ${lead.id} and n.entity_id = ${E} and n.kind = 'brief'
                              and n.created_at <= e.created_at
                              and n.created_at > e.created_at - interval '24 hours'))`;
  const shown = sql`select count(*)::int from copilot_notes n
     where n.entity_id = ${E} and n.kind = 'call_summary' and n.suggestions_shown
       and n.created_at >= ${from}::timestamptz and n.created_at < ${until}::timestamptz`;

  await explain('the panel: the newest brief of a lead, its tele-caller', caller, brief);
  await explain('the panel: the caller’s own latest dial of a lead, its tele-caller', caller, ownDial);
  await explainAsOwner('when a brief was last started (the definer, as its owner)', started);
  await explain('the Co-pilot report, summaries callers saw over 30 days, the Executive', exec, shown);
  await explain('the panel: the newest summary of a lead, its tele-caller', caller, summary);
  await explain('the Co-pilot report, first page of 30 days, the Executive', exec, page);
  await explain('the Co-pilot report, outcomes agreed over 30 days, the Executive', exec, outcomes);
  await explain('the Co-pilot report, refused runs over 30 days, the Executive', exec, refused);
  await clean();
  await closeDb();
}

await main();
