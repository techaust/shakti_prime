// Notification plans (docs/03-roadmap-appendix/phase1.md §8.1, brief N1): `pnpm --filter @shakti/domain
// spike:notifications`. Fills the local database, in company 2, with made-up people (`EXPLN …`),
// 40,000 leads with their customers, 40,000 open callback tasks due over a week, 10,000 quotes
// lapsing over a month, a pipeline with a 30-minute first-contact limit holding 2,000 never-called
// leads made over three days, and 200,000 notices (2,000 for the person whose centre is read), then
// prints `EXPLAIN (ANALYZE, BUFFERS)` for the centre's first and second page and the bell's count
// under the policies as that person, and for the statements inside the scan's three definers and
// the duplicate owners' definer, as the definers run them (as their owner, whose rows RLS does not
// filter). Everything it made is removed at the end. Local database only (prepareDatabase refuses
// any other host). Not part of CI; it lives under tests/ for the testing helpers.
import { newId, type Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  prepareDatabase,
  principalFor,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { noticeCountQuery, noticeListSql } from '../../src/queries/notifications/notices';

const ENTITY = 2;
const PEOPLE = 100;
const LEADS = 40_000;
const TASKS = 40_000;
const QUOTES = 10_000;
const LATE_LEADS = 2_000;
const NOTICES = 200_000;
const MINE = 2_000;

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

async function explainAs(label: string, principal: Principal, text: string): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql.raw(`explain (analyze, buffers, costs off) ${text}`),
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

/** The plan of a statement built as SQL, run under the policies as the person. */
async function explainSql(
  label: string,
  principal: Principal,
  build: (ctx: RequestContext) => SQL,
): Promise<void> {
  const plan = await asPrincipal(principal, async (ctx) => {
    const rows = (await ctx.tx.execute(
      sql`explain (analyze, buffers, costs off) ${build(ctx)}`,
    )) as unknown as Record<string, string>[];
    return rows.map((r) => Object.values(r)[0]).join('\n');
  });
  process.stdout.write(`\n=== ${label} ===\n${plan}\n`);
}

async function explainOwner(label: string, text: string): Promise<void> {
  const rows = await asMigrator((m) =>
    m.unsafe<Record<string, string>[]>(`explain (analyze, buffers, costs off) ${text}`),
  );
  process.stdout.write(`\n=== ${label} ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`);
}

async function explainQuery(
  label: string,
  principal: Principal,
  build: (ctx: RequestContext) => { toSQL(): { sql: string; params: unknown[] } },
): Promise<void> {
  const text = await asPrincipal(principal, (ctx) => Promise.resolve(inline(build(ctx).toSQL())));
  await explainAs(label, principal, text);
}

async function cleanUp(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const people = tx`select id from principals where display_name like 'EXPLN person %'`;
      await tx`delete from notifications where user_id in (${people})`;
      await tx`delete from quotes where quote_no like 'EXPLN/%'`;
      await tx`delete from tasks where account_id in
                 (select id from accounts where name like 'EXPLN customer %')`;
      await tx`delete from opportunities where account_id in
                 (select id from accounts where name like 'EXPLN customer %')`;
      await tx`delete from account_entities where account_id in
                 (select id from accounts where name like 'EXPLN customer %')`;
      await tx`delete from accounts where name like 'EXPLN customer %'`;
      await tx`delete from pipeline_stages where pipeline_id in
                 (select id from pipelines where key = 'expln-sla')`;
      await tx`delete from pipelines where key = 'expln-sla'`;
      await tx`delete from user_entity_roles where user_id in (${people})`;
      await tx`delete from users where id in (${people})`;
      await tx`delete from principals where display_name like 'EXPLN person %'`;
    }),
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  await cleanUp();
  const list = newId();
  const slaPipeline = newId();
  let me = '';
  await asMigrator((m) =>
    m.begin(async (tx) => {
      // The people: one General Manager and the rest tele-callers of company 2, all active.
      await tx`insert into principals (id, kind, display_name)
               select app.uuid_v7(), 'user', 'EXPLN person ' || lpad(g::text, 4, '0')
                 from generate_series(1, ${PEOPLE}::int) g`;
      await tx`insert into users (id, name, email, status)
               select p.id, p.display_name, 'expln-' || p.id || '@shakti.test', 'active'
                 from principals p where p.display_name like 'EXPLN person %'`;
      await tx`insert into user_entity_roles (id, user_id, entity_id, role_id)
               select app.uuid_v7(), p.id, ${ENTITY},
                      (select id from roles where key = case when p.display_name = 'EXPLN person 0001'
                                                            then 'general_manager' else 'tele_caller_cc' end)
                 from principals p where p.display_name like 'EXPLN person %'`;
      const [mine] = await tx<{ id: string }[]>`
        select id from principals where display_name = 'EXPLN person 0002'`;
      if (!mine) throw new Error('no person');
      me = mine.id;
      const [pipeline] = await tx<{ id: string; stage: string }[]>`
        select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                       order by s.position limit 1) as stage
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
      if (!pipeline) throw new Error('no farmer_pumps pipeline');
      // The leads: customers owned by the tele-callers in turn.
      await tx`insert into accounts (id, type, name, created_by)
               select app.uuid_v7(), 'farm', 'EXPLN customer ' || g, ${me}
                 from generate_series(1, ${LEADS + LATE_LEADS}::int) g`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               with o as (select id, row_number() over (order by id) as rn from principals
                           where display_name like 'EXPLN person %' and display_name <> 'EXPLN person 0001'),
                    a as (select id, row_number() over (order by id) as rn from accounts
                           where name like 'EXPLN customer %')
               select app.uuid_v7(), a.id, ${ENTITY}, o.id, ${me}
                 from a join o on o.rn = 1 + (a.rn % ${PEOPLE - 1})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_by)
               select app.uuid_v7(), ${ENTITY}, ae.account_id, ${pipeline.id}, ${pipeline.stage},
                      ae.owner_id, ${me}
                 from account_entities ae join accounts a on a.id = ae.account_id
                where a.name like 'EXPLN customer %'
                order by a.id limit ${LEADS}`;
      // A pipeline with a first-contact limit and its never-called leads, made over three days.
      await tx`insert into pipelines (id, entity_id, key, name, segment, first_contact_sla_minutes)
               values (${slaPipeline}, ${ENTITY}, 'expln-sla', 'EXPLN pipeline', 'farmer_pumps', 30)`;
      await tx`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position, kind) values
               (app.uuid_v7(), ${slaPipeline}, ${ENTITY}, 'new', 'New', 1, 'open'),
               (app.uuid_v7(), ${slaPipeline}, ${ENTITY}, 'qualified', 'Qualified', 2, 'open')`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_at, created_by)
               select app.uuid_v7(), ${ENTITY}, ae.account_id, ${slaPipeline},
                      (select id from pipeline_stages where pipeline_id = ${slaPipeline} and key = 'new'),
                      ae.owner_id, now() - ((row_number() over (order by a.id)) * interval '2 minutes'), ${me}
                 from account_entities ae join accounts a on a.id = ae.account_id
                where a.name like 'EXPLN customer %'
                  and not exists (select 1 from opportunities o where o.account_id = a.id)`;
      // Open callbacks due over a week either side of now.
      await tx`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at, created_by)
               with o as (select id, account_id, owner_id, row_number() over (order by id) as rn
                            from opportunities where pipeline_id = ${pipeline.id}
                             and account_id in (select id from accounts where name like 'EXPLN customer %'))
               select app.uuid_v7(), ${ENTITY}, o.id, o.account_id, o.owner_id, 'callback',
                      now() - interval '3 days' + (g * interval '15 seconds'), ${me}
                 from generate_series(1, ${TASKS}::int) g join o on o.rn = 1 + (g % ${LEADS})`;
      // Quotes lapsing over the next month, a fifth already sent.
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${list}, (select id from price_tiers where code = 'retail'), ${ENTITY},
                       ${9400 + Math.floor(Math.random() * 1e5)}, '2090-01-01', now())`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, state,
                 subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
               with o as (select id, account_id, row_number() over (order by id) as rn
                            from opportunities where pipeline_id = ${pipeline.id}
                             and account_id in (select id from accounts where name like 'EXPLN customer %'))
               select app.uuid_v7(), ${ENTITY}, 'EXPLN/' || lpad(g::text, 6, '0'), '2026-27', o.id,
                      o.account_id, (select id from price_tiers where code = 'retail'), ${list}, 'none',
                      '08', 'intra', now() + (g * interval '4 minutes'),
                      case when g % 5 = 0 then 'sent' else 'draft' end,
                      1000, 90, 90, 0, 180, 0, 1180, ${me}
                 from generate_series(1, ${QUOTES}::int) g join o on o.rn = 1 + (g % ${LEADS})`;
      // The notices: the reader's own and every other person's, a fifth unread, over 60 days.
      await tx`insert into notifications (id, user_id, entity_id, type, subject_type, subject_id,
                 payload_json, dedupe_key, created_at, read_at, channel_sent_json)
               with p as (select id, row_number() over (order by id) as rn from principals
                           where display_name like 'EXPLN person %' and id <> ${me}),
                    a as (select id, row_number() over (order by id) as rn from accounts
                           where name like 'EXPLN customer %'),
                    qt as (select id, account_id, row_number() over (order by id) as rn from quotes
                            where quote_no like 'EXPLN/%')
               select app.uuid_v7(), case when g <= ${MINE} then ${me}::uuid else p.id end, ${ENTITY},
                      case when g % 10 = 0 then 'quote_expiring' else 'lead_assigned' end,
                      case when g % 10 = 0 then 'quote' else 'opportunity' end, app.uuid_v7(),
                      case when g % 10 = 0
                           then jsonb_build_object('accountId', qt.account_id, 'quoteId', qt.id)
                           else jsonb_build_object('accountId', a.id) end,
                      'expln:' || g,
                      now() - (g * interval '25 seconds'),
                      case when g % 5 = 0 then null else now() end,
                      case when g % 20_000 = 0 then '{"inApp": true, "push": "pending"}'::jsonb
                           else '{"inApp": true, "push": "none"}'::jsonb end
                 from generate_series(1, ${NOTICES}::int) g
                 join p on p.rn = 1 + (g % ${PEOPLE - 1})
                 join a on a.rn = 1 + (g % ${LEADS})
                 join qt on qt.rn = 1 + (g % ${QUOTES})`;
      for (const table of [
        'notifications',
        'tasks',
        'quotes',
        'opportunities',
        'calls',
        'accounts',
      ]) {
        await tx.unsafe(`analyze ${table}`);
      }
    }),
  );

  const reader = principalFor('tele_caller_cc', [ENTITY], { id: me });
  await explainSql('centre, first page (21 rows), the person with 2,000 notices', reader, (ctx) =>
    noticeListSql(ctx, 21),
  );
  const [middle] = await asMigrator(
    (m) => m<{ t: string; id: string }[]>`
      select created_at::text as t, id from notifications where user_id = ${me}
       order by created_at desc, id desc offset 1000 limit 1`,
  );
  if (middle) {
    await explainSql('centre, a page 1,000 notices down (keyset)', reader, (ctx) =>
      noticeListSql(ctx, 21, { t: middle.t, id: middle.id }),
    );
    const gm = principalFor('general_manager', [ENTITY], { id: me });
    await explainSql(
      'centre, first page, as a reader of every customer of the company',
      gm,
      (ctx) => noticeListSql(ctx, 21),
    );
  }
  await explainQuery('bell count (up to 100 unread)', reader, (ctx) => noticeCountQuery(ctx));

  const since = `now() - interval '24 hours'`;
  await explainOwner(
    'scan: calls falling due (app.notice_due_calls body), company 2',
    `select f.id, f.assignee_id, f.opportunity_id, f.account_id, f.k
       from (select t.id, t.assignee_id, t.opportunity_id, t.account_id, t.due_at,
                    'call_due:' || t.id::text || ':' || floor(extract(epoch from t.due_at))::bigint::text as k
               from public.tasks t
              where t.entity_id = ${ENTITY} and t.state = 'open' and t.kind in ('callback', 'nurture')
                and t.due_at <= now() and t.due_at > ${since}) f
      where app.notice_recipient_ok(f.assignee_id, ${ENTITY}::smallint)
        and not exists (select 1 from public.notifications n
                         where n.user_id = f.assignee_id and n.dedupe_key = f.k)
      order by f.due_at, f.id limit 200`,
  );
  await explainOwner(
    'scan: quotes lapsing within a day (app.notice_expiring_quotes body), company 2',
    `select f.id, f.owner_id, f.opportunity_id, f.account_id, f.k
       from (select q.id, o.owner_id, q.opportunity_id, q.account_id, q.valid_until,
                    'quote_expiring:' || q.id::text || ':' || floor(extract(epoch from q.valid_until))::bigint::text as k
               from public.quotes q
               join public.opportunities o on o.id = q.opportunity_id and o.entity_id = q.entity_id
              where q.entity_id = ${ENTITY} and q.state in ('draft', 'sent')
                and q.valid_until > now() and q.valid_until <= now() + interval '1 day'
                and o.owner_id is not null) f
      where app.notice_recipient_ok(f.owner_id, ${ENTITY}::smallint)
        and not exists (select 1 from public.notifications n
                         where n.user_id = f.owner_id and n.dedupe_key = f.k)
      order by f.valid_until, f.id limit 200`,
  );
  await explainOwner(
    'scan: late first calls (app.notice_late_first_calls body), company 2',
    `select f.id, g.user_id, f.account_id, f.k
       from (select o.id, o.account_id, o.created_at, 'first_call_late:' || o.id::text as k
               from public.opportunities o
               join public.pipelines pl on pl.id = o.pipeline_id
               join public.pipeline_stages ps on ps.id = o.stage_id
               left join public.pipeline_stages q
                 on q.pipeline_id = o.pipeline_id and q.key = 'qualified' and q.archived_at is null
              where o.entity_id = ${ENTITY} and o.state = 'open' and o.archived_at is null
                and o.created_at > (${since}) - interval '7 days'
                and ps.kind = 'open' and ps.position < coalesce(q.position, 2147483647)
                and pl.first_contact_sla_minutes is not null
                and o.created_at + make_interval(mins => pl.first_contact_sla_minutes) <= now()
                and o.created_at + make_interval(mins => pl.first_contact_sla_minutes) > ${since}
                and not exists (select 1 from public.calls c where c.opportunity_id = o.id)) f
       join (select uer.user_id from public.user_entity_roles uer
               join public.roles r on r.id = uer.role_id
              where uer.entity_id = ${ENTITY} and r.key = 'general_manager'
                and app.notice_recipient_ok(uer.user_id, ${ENTITY}::smallint)) g on true
      where not exists (select 1 from public.notifications n
                         where n.user_id = g.user_id and n.dedupe_key = f.k)
      order by f.created_at, f.id, g.user_id limit 200`,
  );
  await explainOwner(
    'scan: pushes a cut-off run left pending (app.notice_pending_pushes body), company 2',
    `select n.id, n.user_id, n.type, n.subject_id, n.payload_json
       from public.notifications n
      where n.entity_id = ${ENTITY} and n.channel_sent_json ->> 'push' = 'pending'
        and n.created_at < now() - make_interval(secs => 120)
        and n.created_at > now() - interval '1 day'
      order by n.created_at, n.id limit 200`,
  );
  await explainOwner(
    'write: a repeated notice (the unique key on person and reason)',
    `select 1 from public.notifications where user_id = '${me}' and dedupe_key = 'expln:10'`,
  );
  await cleanUp();
}

try {
  await main();
} finally {
  await closeDb();
}
