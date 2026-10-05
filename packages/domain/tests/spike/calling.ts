// Cold Caller queue latency spike (docs/design/phase1.md §7.2, PRD TEL-01; under 300 ms p95):
// `pnpm spike:calling`, options `-- --callers 10 --leads 2000 --runs 100 --warmup 10`.
// Seeds, as app_user under RLS through the set-based lead path the import commit uses
// (`commitLeadBatch`), `--leads` made-up leads of company 1 for each of `--callers` made-up
// tele-callers of one team; then, as the migrator, a call history on the first caller's leads as
// a working queue has it: a third called once without an answer with the retry set for tomorrow, a
// tenth with a callback due now, a twentieth nurtured with its day-7 call due, a twentieth moved to
// Qualified. It then times, through `executeQuery` as the web actions call it, the caller's queue
// (first and second page), the workspace's lead and the team view, for the tele-caller, the team
// lead of the team and the General Manager of the company (the team lead and the GM read the
// caller's queue through `callerId`). The time is the `durationMs` of executeQuery's
// `query.completed` line. Prints the plan of the queue's own statement (`callQueuePageSql`) under
// RLS for the tele-caller and the team lead, and writes docs/spikes/results/calling.json. The
// seeded rows are removed at the end unless `--keep` is given; their timeline rows stay, since the
// timeline is append-only. Local database only (prepareDatabase refuses any other host). Not CI.
import { newId, type Principal } from '@shakti/contracts';
import { withRequestContext, type RequestContext } from '@shakti/db';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
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
import {
  callQueuePageSql,
  listCallQueue,
  listTeamQueues,
  loadCallLead,
} from '../../src/queries/calls/call-queue';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultFile = join(repoRoot, 'docs', 'spikes', 'results', 'calling.json');

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Number(process.argv[index + 1]);
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

const CALLERS = numberArg('callers', 10);
const LEADS = numberArg('leads', 2_000);
const RUNS = numberArg('runs', 100);
const WARMUP = numberArg('warmup', 10);
const BATCH = 500;
const KEEP = process.argv.includes('--keep');

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The set-based lead path of the import commit, run as a command for one caller's batch. */
const seedLeads = defineCommand({
  name: 'spike.calling.seed',
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
    `  ${name.padEnd(24)} p50 ${String(result.p50).padStart(7)} ms  p95 ${String(result.p95).padStart(7)} ms  max ${String(result.max).padStart(7)} ms  (${String(rows)} rows)`,
  );
  return result;
}

async function explain(principal: Principal, callerId: string, asOf: Date): Promise<string[]> {
  return withRequestContext(
    principal,
    {},
    async (ctx) => {
      const query = callQueuePageSql(callerId, ctx.entityIds, asOf, 51);
      const rows = (await ctx.tx.execute(
        sql`explain (analyze, buffers, costs off) ${query}`,
      )) as unknown as { 'QUERY PLAN': string }[];
      return rows.map((r) => r['QUERY PLAN']);
    },
    { readOnly: true },
  );
}

async function main(): Promise<void> {
  await prepareDatabase();
  const salt = Math.floor(Math.random() * 1e8);
  const team = await createTestTeam(1, 'calling spike team');
  const callers: Principal[] = [];
  for (let c = 0; c < CALLERS; c++) {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId: team }], {
      name: `Spike caller ${String(c)}`,
    });
    callers.push(await createTestPrincipal('tele_caller_cc', [1], { id: user.id, teamId: team }));
  }
  const leadUser = await createTestUser([
    { entityId: 1, roleKey: 'sales_team_lead', teamId: team },
  ]);
  const teamLead = await createTestPrincipal('sales_team_lead', [1], {
    id: leadUser.id,
    teamId: team,
  });
  const gm = await createTestPrincipal('general_manager', [1]);
  const caller = callers[0];
  if (caller === undefined) throw new Error('no caller');

  const started = performance.now();
  for (const [c, owner] of callers.entries()) {
    for (let from = 0; from < LEADS; from += BATCH) {
      const rows: { rowNo: number; input: unknown }[] = [];
      for (let n = from; n < Math.min(LEADS, from + BATCH); n++) {
        const k = c * LEADS + n;
        rows.push({
          rowNo: n + 1,
          input: {
            entityId: 1,
            pipelineKey: k % 3 === 0 ? 'residential_rooftop' : 'farmer_pumps',
            contact: { name: `Spike customer ${String(k)}`, phone: phone(k, salt) },
            account: { type: 'farm' },
            site: { type: 'borewell', village: `Spike village ${String(k % 400)}` },
          },
        });
      }
      await withRequestContext(owner, { entityIds: [1] }, (context) =>
        runCommand(
          seedLeads,
          { context, audit: memoryAuditSink(), outbox: memoryOutboxSink() },
          { runId: newId(), rows },
        ),
      );
    }
  }

  // The first caller's call history, as a working queue has it.
  await asMigrator(async (m) => {
    await m`update opportunities set score = 20 + (abs(hashtext(id::text)) % 70)
             where owner_id in ${m(callers.map((p) => p.id))}`;
    const [outcomes] = await m<{ retry: string; callback: string }[]>`
      select (select id from call_dispositions where entity_id is null and segment is null
                and archived_at is null and next_action = 'retry' order by key limit 1) as retry,
             (select id from call_dispositions where entity_id is null and segment is null
                and archived_at is null and next_action = 'callback' order by key limit 1) as callback`;
    if (!outcomes) throw new Error('the seed wrote no call outcomes');
    await m`create temp table spike_leads as
      select id, entity_id, account_id, row_number() over (order by id) as n
        from opportunities where owner_id = ${caller.id}`;
    // A third: one unanswered call, the retry tomorrow.
    await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                               disposition_id, attempt_no, started_at)
            select app.uuid_v7(), entity_id, id, ${caller.id}, 'outbound', 'manual', ${outcomes.retry},
                   1, now() - interval '2 hours'
              from spike_leads where n % 3 = 0`;
    await m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind,
                               due_at, created_by)
            select app.uuid_v7(), entity_id, id, account_id, ${caller.id}, ${team}, 'callback',
                   now() + interval '1 day', ${caller.id}
              from spike_leads where n % 3 = 0`;
    // A tenth: an answered call, the callback due now.
    await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                               disposition_id, attempt_no, started_at)
            select app.uuid_v7(), entity_id, id, ${caller.id}, 'outbound', 'manual',
                   ${outcomes.callback}, 1, now() - interval '1 day'
              from spike_leads where n % 10 = 1`;
    await m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind,
                               due_at, created_by)
            select app.uuid_v7(), entity_id, id, account_id, ${caller.id}, ${team}, 'callback',
                   now() - interval '1 hour', ${caller.id}
              from spike_leads where n % 10 = 1`;
    // A twentieth: nurtured, the day-7 call due.
    await m`update opportunities set state = 'nurture'
             where id in (select id from spike_leads where n % 20 = 2)`;
    await m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind,
                               due_at, created_by)
            select app.uuid_v7(), entity_id, id, account_id, ${caller.id}, ${team}, 'nurture',
                   now() - interval '3 hours', ${caller.id}
              from spike_leads where n % 20 = 2`;
    // A twentieth: qualified, out of the queue.
    await m`update opportunities o set stage_id = q.id
              from pipeline_stages q
             where q.pipeline_id = o.pipeline_id and q.key = 'qualified'
               and o.id in (select id from spike_leads where n % 20 = 7)`;
    await m`analyze opportunities`;
    await m`analyze calls`;
    await m`analyze tasks`;
  });
  const seededSeconds = Math.round((performance.now() - started) / 100) / 10;
  const [counts] = await asMigrator(
    (m) => m<{ leads: number; calls: number; tasks: number; allLeads: number }[]>`
      select (select count(*)::int from opportunities where owner_id = ${caller.id}) as leads,
             (select count(*)::int from calls where caller_id = ${caller.id}) as calls,
             (select count(*)::int from tasks where assignee_id = ${caller.id}) as tasks,
             (select count(*)::int from opportunities where entity_id = 1) as "allLeads"`,
  );
  log(
    `seeded ${String(CALLERS * LEADS)} leads for ${String(CALLERS)} callers in ${String(seededSeconds)} s; the first caller has ${String(counts?.leads)} leads, ${String(counts?.calls)} calls and ${String(counts?.tasks)} tasks; company 1 has ${String(counts?.allLeads)} leads`,
  );

  const asOf = new Date();
  const first = await executeQuery(caller, {}, (ctx) => listCallQueue(ctx, { limit: 50 }, asOf));
  const focus = first.items[0];
  if (focus === undefined) throw new Error('the queue is empty');
  const readers = { teleCaller: caller, teamLead, generalManager: gm };
  const results: Record<string, Record<string, CaseResult>> = {};
  for (const [who, principal] of Object.entries(readers)) {
    log(`${who}:`);
    const own = principal === caller ? {} : { callerId: caller.id };
    const page1 = await executeQuery(principal, {}, (ctx) =>
      listCallQueue(ctx, { limit: 50, ...own }, asOf),
    );
    results[who] = {
      queue: await timeCase(
        principal,
        'listCallQueue',
        (ctx) => listCallQueue(ctx, { limit: 50, ...own }, asOf),
        (p) => p.items.length,
      ),
      queueNextPage: await timeCase(
        principal,
        'listCallQueue (page 2)',
        (ctx) =>
          listCallQueue(
            ctx,
            {
              limit: 50,
              ...own,
              ...(page1.nextCursor === null ? {} : { cursor: page1.nextCursor }),
            },
            asOf,
          ),
        (p) => p.items.length,
      ),
      lead: await timeCase(
        principal,
        'loadCallLead',
        (ctx) => loadCallLead(ctx, { entityId: 1, opportunityId: focus.opportunityId }),
        (l) => l.recentActivity.length,
      ),
      ...(principal === caller
        ? {}
        : {
            teamQueues: await timeCase(
              principal,
              'listTeamQueues',
              (ctx) => listTeamQueues(ctx, {}, asOf),
              (rows) => rows.length,
            ),
          }),
    };
  }

  const callerPlan = await explain(caller, caller.id, asOf);
  log('queue plan for the tele-caller:');
  for (const line of callerPlan) log(`  ${line}`);
  const teamLeadPlan = await explain(teamLead, caller.id, asOf);
  log('queue plan for the team lead reading the caller’s queue:');
  for (const line of teamLeadPlan) log(`  ${line}`);

  writeFileSync(
    resultFile,
    `${JSON.stringify(
      {
        spike: 'calling',
        ranAt: new Date().toISOString(),
        machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) },
        seeded: { callers: CALLERS, leadsPerCaller: LEADS, ...counts },
        runs: RUNS,
        warmup: WARMUP,
        targetMs: SLOW_CALL_MS,
        timing:
          'durationMs of the query.completed line of executeQuery: transaction, context settings and queries, in process',
        results,
        queuePlanTeleCaller: callerPlan,
        queuePlanTeamLead: teamLeadPlan,
      },
      null,
      2,
    )}\n`,
  );
  log(`wrote ${resultFile}`);
  if (!KEEP) await removeSeeded(callers.map((p) => p.id));
}

/** Removes the leads, customers, calls and tasks the run seeded; the timeline rows stay. */
async function removeSeeded(owners: string[]): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`create temp table seeded on commit drop as
        select distinct account_id as id from opportunities where owner_id in ${tx(owners)}`;
      await tx`create temp table seeded_contacts on commit drop as
        select contact_id as id from account_contacts where account_id in (select id from seeded)`;
      await tx`alter table calls disable trigger calls_append_only`;
      await tx`delete from calls where caller_id in ${tx(owners)}`;
      await tx`alter table calls enable trigger calls_append_only`;
      await tx`delete from tasks where assignee_id in ${tx(owners)}`;
      await tx`delete from opportunities where account_id in (select id from seeded)`;
      await tx`delete from customer_sites where account_id in (select id from seeded)`;
      await tx`delete from contact_phones where contact_id in (select id from seeded_contacts)`;
      await tx`delete from account_contacts where account_id in (select id from seeded)`;
      await tx`delete from contacts where id in (select id from seeded_contacts)`;
      await tx`delete from account_entities where account_id in (select id from seeded)`;
      await tx`delete from accounts where id in (select id from seeded)`;
      await tx`delete from idempotency_keys where principal_id in ${tx(owners)}`;
    }),
  );
  log('removed the seeded leads, customers, calls and tasks (their timeline rows stay)');
}

main()
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
