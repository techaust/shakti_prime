// Account 360 and timeline latency spike (PRD CRM-07: under 300 ms p95 for a customer with 1,000
// activities): `pnpm spike:account360`, options `-- --activities 1000 --customers 5000 --runs 100
// --warmup 10`.
// Seeds, as app_user under RLS through the set-based lead path the import commit uses
// (`commitLeadBatch`), `--customers` made-up customers of company 1, each with one lead owned by a
// made-up tele-caller of one team, and one more customer with five leads; then, as the migrator
// (the timeline takes no direct writes from a request), five timeline rows for each background
// customer and `--activities` rows for the one customer, half on its leads and half on the
// customer, spread over the last six months so they fall into several monthly partitions. It then
// times, through `executeQuery` as the web actions call it, Account 360 (`loadAccount360`, which
// reads the first timeline page with it), the second timeline page, one lead's timeline and the
// customers list (first page, a name search and a phone search), for the
// team lead of that team, the General Manager of the company and the tele-caller who owns the
// leads. The time is the `durationMs` of executeQuery's `query.completed` line. Prints the plans of
// the timeline query and the customers search under RLS and writes
// docs/04-architecture-appendix/results/account360.json. The seeded customers and leads are removed at the end
// unless `--keep` is given; their timeline rows stay, since the timeline is append-only. Local
// database only (prepareDatabase refuses any other host). Not part of CI.
import { newId, type Principal } from '@shakti/contracts';
import { withRequestContext, type RequestContext } from '@shakti/db';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { memoryAuditSink } from '../../src/audit/sink';
import { defineCommand } from '../../src/command/define-command';
import { executeQuery } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { SLOW_CALL_MS } from '../../src/command/timing';
import { commitLeadBatch } from '../../src/imports/commit-leads';
import { memoryOutboxSink } from '../../src/outbox/sink';
import type { Logger } from '../../src/ports/logger';
import { listCustomers, listTimeline, loadAccount360 } from '../../src/queries/crm/customers';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultFile = join(repoRoot, 'docs', '04-architecture-appendix', 'results', 'account360.json');

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Number(process.argv[index + 1]);
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

const ACTIVITIES = numberArg('activities', 1_000);
const CUSTOMERS = numberArg('customers', 5_000);
const RUNS = numberArg('runs', 100);
const WARMUP = numberArg('warmup', 10);
const BATCH = 500;
const KEEP = process.argv.includes('--keep');
const FOCUS_LEADS = 5;

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The set-based lead path of the import commit, run as a command for one caller's batch. */
const seedLeads = defineCommand({
  name: 'spike.account360.seed',
  permission: 'crm.lead.write',
  auditFields: [],
  input: z
    .object({
      runId: z.string(),
      rows: z.array(z.object({ rowNo: z.number().int(), input: z.unknown() }).strict()),
    })
    .strict(),
  output: z.array(z.object({ rowNo: z.number().int(), id: z.string() }).strict()),
  handler: (ctx, input) => commitLeadBatch(ctx, ctx.tx, input.runId, input.rows),
});

/** A made-up mobile number starting with 6, from the row number and the run. */
function phone(n: number, salt: number): string {
  return `6${String(100_000_000 + (((n + salt) * 7_919) % 900_000_000)).padStart(9, '0')}`;
}

interface CaseResult {
  runs: number;
  p50: number;
  p95: number;
  max: number;
  rows: number;
  overTarget: boolean;
}

async function timeCase<T>(
  principal: Principal,
  name: string,
  read: (context: RequestContext) => Promise<T>,
  rowsOf: (answer: T) => number,
): Promise<CaseResult> {
  const durations: number[] = [];
  const logger: Logger = {
    log(_level, event, fields) {
      if (event === 'query.completed' && typeof fields?.durationMs === 'number') {
        durations.push(fields.durationMs);
      }
    },
  };
  let rows = 0;
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const answer = await executeQuery(principal, {}, read, { name, logger });
    rows = rowsOf(answer);
  }
  const timed = durations.slice(WARMUP).sort((a, b) => a - b);
  const at = (q: number) => timed[Math.min(timed.length - 1, Math.ceil(q * timed.length) - 1)] ?? 0;
  const result = {
    runs: timed.length,
    p50: at(0.5),
    p95: at(0.95),
    max: timed.at(-1) ?? 0,
    rows,
    overTarget: at(0.95) > SLOW_CALL_MS,
  };
  log(
    `  ${name.padEnd(26)} p50 ${String(result.p50).padStart(7)} ms  p95 ${String(result.p95).padStart(7)} ms  max ${String(result.max).padStart(7)} ms  (${String(rows)} rows)`,
  );
  return result;
}

async function main(): Promise<void> {
  await prepareDatabase();
  const salt = Math.floor(Math.random() * 1e8);
  const team = await createTestTeam(1, 'account360 spike team');
  const caller = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  const teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId: team });
  const gm = await createTestPrincipal('general_manager', [1]);

  // Background customers and the one customer's first lead, in batches of the import commit.
  const started = performance.now();
  const leadIds: { rowNo: number; id: string }[] = [];
  const total = CUSTOMERS + 1;
  for (let from = 0; from < total; from += BATCH) {
    const rows: { rowNo: number; input: unknown }[] = [];
    for (let n = from; n < Math.min(total, from + BATCH); n++) {
      rows.push({
        rowNo: n + 1,
        input: {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: `Spike customer ${String(n)}`, phone: phone(n, salt) },
          account: { type: 'farm' },
          site: { type: 'borewell', village: `Spike village ${String(n % 400)}` },
        },
      });
    }
    const made = await withRequestContext(caller, { entityIds: [1] }, (context) =>
      runCommand(
        seedLeads,
        { context, audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        { runId: newId(), rows },
      ),
    );
    leadIds.push(...made);
  }
  const focusLead = leadIds.find((l) => l.rowNo === total);
  if (focusLead === undefined) throw new Error('the focus lead was not made');
  const [focus] = await asMigrator(
    (m) => m<{ account_id: string; pipeline_id: string; stage_id: string }[]>`
      select account_id, pipeline_id, stage_id from opportunities where id = ${focusLead.id}`,
  );
  if (focus === undefined) throw new Error('the focus customer was not found');
  const accountId = focus.account_id;

  // Four more leads of the one customer, then the timeline rows, as the migrator.
  const focusLeads = [focusLead.id];
  await asMigrator(async (m) => {
    for (let i = 1; i < FOCUS_LEADS; i++) {
      const id = newId();
      focusLeads.push(id);
      await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${id}, 1, ${accountId}, ${focus.pipeline_id}, ${focus.stage_id}, ${caller.id}, ${team}, ${caller.id})`;
    }
    await m`
      insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json, created_at)
      select app.uuid_v7(), 1, o.id, o.account_id, 'stage_moved', ${caller.id}, '{}'::jsonb,
             now() - make_interval(secs => (g * 3571) % (180 * 86400))
        from opportunities o, generate_series(1, 5) g
       where o.id = any(${leadIds.map((l) => l.id)}::uuid[]) and o.id <> ${focusLead.id}`;
    await m`
      insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json, body, created_at)
      select app.uuid_v7(), 1,
             case when g % 2 = 0 then (${focusLeads}::uuid[])[1 + g % ${FOCUS_LEADS}] end,
             ${accountId}, case when g % 2 = 0 then 'stage_moved' else 'note' end, ${caller.id},
             '{}'::jsonb,
             case when g % 2 = 0 then null else 'Spike note ' || g end,
             now() - make_interval(secs => (g * 15551) % (180 * 86400))
        from generate_series(1, ${ACTIVITIES}) g`;
  });
  const seededSeconds = Math.round((performance.now() - started) / 100) / 10;
  const [counts] = await asMigrator(
    (m) => m<{ customer: number; all: number; partitions: number }[]>`
      select (select count(*)::int from activities where account_id = ${accountId}) as customer,
             (select count(*)::int from activities) as "all",
             (select count(distinct tableoid)::int from activities where account_id = ${accountId}) as partitions`,
  );
  log(
    `seeded ${String(CUSTOMERS + 1)} customers and ${String(counts?.customer)} timeline rows for one customer in ${String(seededSeconds)} s; ${String(counts?.all)} timeline rows in all, the customer's in ${String(counts?.partitions)} partitions`,
  );

  const callers = { teamLead, generalManager: gm, teleCaller: caller };
  const results: Record<string, Record<string, CaseResult>> = {};
  for (const [who, principal] of Object.entries(callers)) {
    log(`${who}:`);
    const first = await executeQuery(principal, {}, (ctx) =>
      listTimeline(ctx, { entityId: 1, accountId }),
    );
    results[who] = {
      account360: await timeCase(
        principal,
        'loadAccount360',
        (ctx) => loadAccount360(ctx, { accountId, entityId: 1 }),
        (a) => a.timeline.items.length + a.leads.length,
      ),
      timelineNextPage: await timeCase(
        principal,
        'listTimeline (page 2)',
        (ctx) =>
          listTimeline(ctx, {
            entityId: 1,
            accountId,
            ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
          }),
        (p) => p.items.length,
      ),
      customersFirstPage: await timeCase(
        principal,
        'listCustomers',
        (ctx) => listCustomers(ctx, {}),
        (p) => p.items.length,
      ),
      customersByName: await timeCase(
        principal,
        'listCustomers (name)',
        (ctx) => listCustomers(ctx, { q: 'Spike customer 42' }),
        (p) => p.items.length,
      ),
      customersByPhone: await timeCase(
        principal,
        'listCustomers (phone)',
        (ctx) => listCustomers(ctx, { q: phone(4_242, salt).slice(-6) }),
        (p) => p.items.length,
      ),
      leadTimeline: await timeCase(
        principal,
        'listTimeline (one lead)',
        (ctx) => listTimeline(ctx, { entityId: 1, opportunityId: focusLead.id }),
        (p) => p.items.length,
      ),
    };
  }

  const plan = await withRequestContext(
    teamLead,
    {},
    async (ctx) =>
      (await ctx.tx.execute(sql`explain (analyze, buffers, costs off)
        select a.id, a.type, p.display_name from activities a
          left join principals p on p.id = a.actor_principal_id
         where a.entity_id = 1 and a.account_id = ${accountId}
         order by a.created_at desc, a.id desc limit 26`)) as unknown as {
        'QUERY PLAN': string;
      }[],
    { readOnly: true },
  );
  const planText = plan.map((r) => r['QUERY PLAN']);
  log('timeline plan for the team lead:');
  for (const line of planText) log(`  ${line}`);

  // The customers search as listCustomers sends it, for the General Manager of the company.
  const searchPlan = await withRequestContext(
    gm,
    {},
    async (ctx) =>
      (await ctx.tx.execute(sql`explain (analyze, buffers, costs off)
        select ae.id, a.id, a.name from account_entities ae
          join accounts a on a.id = ae.account_id
         where ae.entity_id in (1) and a.archived_at is null
           and a.id in (select candidate from app.customer_search_ids(
                          ${'Spike customer 42'}::text, null::text, 200) as candidate)
           and (a.name ilike ${'%Spike customer 42%'}
             or exists (select 1 from account_contacts ac join contacts c on c.id = ac.contact_id
                         where ac.account_id = a.id and c.name ilike ${'%Spike customer 42%'})
             or exists (select 1 from customer_sites cs
                         where cs.account_id = a.id and cs.village ilike ${'%Spike customer 42%'}
                           and cs.archived_at is null))
         order by a.name asc, ae.id asc limit 51`)) as unknown as { 'QUERY PLAN': string }[],
    { readOnly: true },
  );
  const searchPlanText = searchPlan.map((r) => r['QUERY PLAN']);
  log('customers search plan for the General Manager:');
  for (const line of searchPlanText) log(`  ${line}`);

  writeFileSync(
    resultFile,
    `${JSON.stringify(
      {
        spike: 'account360',
        ranAt: new Date().toISOString(),
        machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) },
        seeded: { customers: CUSTOMERS + 1, customerActivities: counts?.customer, ...counts },
        runs: RUNS,
        warmup: WARMUP,
        targetMs: SLOW_CALL_MS,
        timing:
          'durationMs of the query.completed line of executeQuery: transaction, context settings and queries, in process',
        results,
        timelinePlan: planText,
        customersSearchPlan: searchPlanText,
      },
      null,
      2,
    )}\n`,
  );
  log(`wrote ${resultFile}`);
  if (!KEEP) await removeSeeded(caller.id);
}

/**
 * Removes the customers and leads the run seeded, so later suites and lists do not read them;
 * their timeline rows stay, since the timeline is append-only, and name rows that no longer
 * exist, which no one reads.
 */
async function removeSeeded(owner: string): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`create temp table seeded on commit drop as
        select distinct account_id as id from opportunities where owner_id = ${owner}`;
      await tx`create temp table seeded_contacts on commit drop as
        select contact_id as id from account_contacts where account_id in (select id from seeded)`;
      await tx`delete from opportunities where account_id in (select id from seeded)`;
      await tx`delete from customer_sites where account_id in (select id from seeded)`;
      await tx`delete from contact_phones where contact_id in (select id from seeded_contacts)`;
      await tx`delete from account_contacts where account_id in (select id from seeded)`;
      await tx`delete from contacts where id in (select id from seeded_contacts)`;
      await tx`delete from account_entities where account_id in (select id from seeded)`;
      await tx`delete from accounts where id in (select id from seeded)`;
      await tx`delete from idempotency_keys where principal_id = ${owner}`;
    }),
  );
  log('removed the seeded customers and leads (their timeline rows stay)');
}

main()
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
