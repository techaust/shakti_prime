// List and search latency spike (BLUEPRINT §6.4, p95 interaction < 300 ms): `pnpm spike:lists`,
// options `-- --leads 50000 --runs 50 --warmup 5 --keep`.
// Seeds made-up leads across the four companies through the set-based lead path the import
// commit uses (`commitLeadBatch`, as `app_user` under RLS, 500 rows a transaction), each lead
// owned by one of ten made-up tele-callers of its company, then times the reads the screens make
// through `executeQuery`, as the web actions call them, for three callers: an Executive of all
// four companies, a General Manager of one company and a tele-caller of that company, who sees
// only their own leads. Each case runs `--warmup` times untimed, then `--runs` times; the time is
// the `durationMs` of the `query.completed` line executeQuery logs (transaction, context settings
// and query, in process). Writes docs/spikes/results/lists.json. The seeded leads are deleted at
// the end unless `--keep` is given. Local database only (prepareDatabase refuses any other host).
// Not part of CI. It lives under tests/ because it makes its callers with the testing helpers.
import { hasGrant, newId, type Principal } from '@shakti/contracts';
import { withRequestContext, type RequestContext } from '@shakti/db';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
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
import { queryAudit } from '../../src/queries/audit/query-audit';
import { searchPeople } from '../../src/queries/admin/search-people';
import { listBoardLeads } from '../../src/queries/crm/list-board-leads';
import { listLeads, type LeadPage } from '../../src/queries/crm/list-leads';
import { searchLeads } from '../../src/queries/crm/search-leads';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultFile = join(repoRoot, 'docs', 'spikes', 'results', 'lists.json');

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Number(process.argv[index + 1]);
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

const LEADS = numberArg('leads', 50_000);
const RUNS = numberArg('runs', 50);
const WARMUP = numberArg('warmup', 5);
const KEEP = process.argv.includes('--keep');
const CALLERS_PER_COMPANY = 10;
const BATCH = 500;
/** The page size of the leads list and the Activity log (their inputs' default). */
const PAGE = 50;
/** The later page timed: the 11th, after 500 leads. */
const LATER_PAGE = 11;
/** Hits of each kind the ⌘K palette asks for (`HITS_PER_KIND` in actions/search.ts). */
const PALETTE_HITS = 8;

// Syllables put together, so no row names a real person or place.
const FIRST_A = ['Ra', 'Ke', 'Mi', 'Ta', 'Jo', 'Pa', 'Sa', 'Di', 'He', 'Vo', 'Lu', 'Ba', 'Ni'];
const FIRST_B = ['vok', 'luv', 'vra', 'nor', 'ruk', 'vid', 'nko', 'lum', 'rav', 'desh', 'mil'];
const LAST = ['Kantarvi', 'Velorin', 'Dharvik', 'Sumelok', 'Tordan', 'Pakhrin', 'Lovantu'];
const LAST_B = ['', 'wal', 'dar', 'ot'];
const PLACE_A = ['Kher', 'Bal', 'Soti', 'Mand', 'Rupal', 'Tikh', 'Vera', 'Gond', 'Pith', 'Lun'];
const PLACE_B = ['ovan', 'vanti', 'kul', 'ravi', 'ko', 'alam', 'jun', 'wara', 'sar', 'pura'];
const PLACE_C = ['', ' Kalan', ' Khurd', ' Bujurg', ' Tanda'];

function pick<T>(list: readonly T[], n: number): T {
  return list[n % list.length] as T;
}

/** A made-up customer from the row number: 4,004 names and 500 villages spread over the rows. */
function madeUpLead(n: number) {
  const name = `${pick(FIRST_A, n)}${pick(FIRST_B, Math.floor(n / 13))} ${pick(LAST, Math.floor(n / 143))}${pick(LAST_B, Math.floor(n / 1001))}`;
  const village = `${pick(PLACE_A, n * 7)}${pick(PLACE_B, Math.floor(n / 10) * 3)}${pick(PLACE_C, Math.floor(n / 100))}`;
  // A made-up mobile number starting with 7, unique within 900 million rows.
  const phone = `7${String(100_000_000 + (((n + 3_000_000) * 7_919) % 900_000_000)).padStart(9, '0')}`;
  const pumps = n % 10 < 7;
  return {
    name,
    village,
    phone,
    input: {
      entityId: 0,
      pipelineKey: pumps ? 'farmer_pumps' : 'residential_rooftop',
      contact: { name, phone },
      account: { type: pumps ? 'farm' : 'household' },
      site: { type: pumps ? 'borewell' : 'rooftop', village },
    },
  };
}

/** The set-based lead path of the import commit, run as a command for one caller's batch. */
const seedLeads = defineCommand({
  name: 'spike.leads.seed',
  permission: 'crm.lead.write',
  auditFields: [],
  input: z
    .object({
      runId: z.string(),
      rows: z.array(z.object({ rowNo: z.number().int(), input: z.unknown() }).strict()),
    })
    .strict(),
  output: z.object({ created: z.number().int() }).strict(),
  handler: async (ctx, input) => ({
    created: (await commitLeadBatch(ctx, ctx.tx, input.runId, input.rows)).length,
  }),
});

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function seconds(from: number): number {
  return Math.round((performance.now() - from) / 10) / 100;
}

/** The median time of one statement inside a transaction, in milliseconds. */
async function roundTripMs(): Promise<number> {
  const times: number[] = [];
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (let i = 0; i < 50; i++) {
        const t = performance.now();
        await tx`select 1`;
        times.push(performance.now() - t);
      }
    }),
  );
  times.sort((a, b) => a - b);
  return Math.round((times[Math.floor(times.length / 2)] ?? 0) * 100) / 100;
}

interface Seeded {
  callers: Map<number, Principal[]>;
  sample: { name: string; village: string; phoneLast4: string };
  seconds: number;
}

/**
 * Seeds `LEADS` leads, a quarter per company, split evenly over each company's callers. The
 * events and the audit summary stay in memory: the outbox refuses deletes, and the spike cleans
 * up after itself. The idempotency keys and the rows are real.
 */
async function seed(): Promise<Seeded> {
  const t = performance.now();
  const runId = newId();
  const callers = new Map<number, Principal[]>();
  for (const entityId of ALL_ENTITY_IDS) {
    const list: Principal[] = [];
    for (let i = 0; i < CALLERS_PER_COMPANY; i++) {
      list.push(await createTestPrincipal('tele_caller_cc', [entityId]));
    }
    callers.set(entityId, list);
  }
  const perCaller = Math.ceil(LEADS / (ALL_ENTITY_IDS.length * CALLERS_PER_COMPANY));
  let rowNo = 0;
  let created = 0;
  let sample: Seeded['sample'] | undefined;
  for (const entityId of ALL_ENTITY_IDS) {
    for (const caller of callers.get(entityId) ?? []) {
      for (let done = 0; done < perCaller && rowNo < LEADS; done += BATCH) {
        const rows: { rowNo: number; input: unknown }[] = [];
        for (let i = 0; i < Math.min(BATCH, perCaller - done) && rowNo < LEADS; i++, rowNo++) {
          const lead = madeUpLead(rowNo);
          // The second lead of the tele-caller the spike reads as (the first one's number ends
          // in 0000): what the search cases type.
          if (rowNo === 1) {
            sample = { name: lead.name, village: lead.village, phoneLast4: lead.phone.slice(-4) };
          }
          rows.push({ rowNo, input: { ...lead.input, entityId } });
        }
        const out = await withRequestContext(caller, { entityIds: [entityId] }, (context) =>
          runCommand(
            seedLeads,
            { context, audit: memoryAuditSink(), outbox: memoryOutboxSink() },
            { runId, rows },
          ),
        );
        created += out.created;
      }
    }
    log(`seeded company ${String(entityId)}: ${String(created)} leads so far`);
  }
  if (sample === undefined) throw new Error('nothing was seeded');
  const owners = [...callers.values()].flat().map((p) => p.id);
  // Spread the leads over the four open stages of their pipeline and the last year, as a
  // year of work would leave them, then let the planner see the new rows. The trigger that stamps
  // updated_at is off only inside this one transaction.
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table opportunities disable trigger set_updated_at`;
      await tx`
        update opportunities o
           set stage_id = x.stage_id,
               updated_at = now() - (((hashtext(o.id::text) & 1023) / 1024.0) * interval '365 days')
          from (select l.id,
                       (select s.id from pipeline_stages s
                         where s.pipeline_id = l.pipeline_id and s.kind = 'open'
                           and s.entity_id is null and s.archived_at is null
                         order by s.position
                        offset abs(hashtext(l.id::text || 'stage')) % 4 limit 1) as stage_id
                  from opportunities l where l.owner_id in ${tx(owners)}) x
         where o.id = x.id and x.stage_id is not null`;
      await tx`alter table opportunities enable trigger set_updated_at`;
    }),
  );
  await asMigrator(
    (m) =>
      m`analyze opportunities, accounts, account_entities, contacts, account_contacts, contact_phones, customer_sites`,
  );
  log(`seeded ${String(created)} leads in ${String(seconds(t))} s`);
  return { callers, sample, seconds: seconds(t) };
}

/** Deletes every row the seed wrote: its callers own every seeded lead. */
async function removeSeeded(owners: readonly string[]): Promise<Record<string, number>> {
  return asMigrator((m) =>
    m.begin(async (tx) => {
      const counts: Record<string, number> = {};
      await tx`create temp table spike_accounts on commit drop as
        select distinct account_id as id from opportunities where owner_id in ${tx(owners)}`;
      await tx`create temp table spike_contacts on commit drop as
        select contact_id as id from account_contacts where account_id in (select id from spike_accounts)`;
      counts.opportunities = (
        await tx`delete from opportunities where owner_id in ${tx(owners)}`
      ).count;
      counts.customerSites = (
        await tx`delete from customer_sites where account_id in (select id from spike_accounts)`
      ).count;
      counts.contactPhones = (
        await tx`delete from contact_phones where contact_id in (select id from spike_contacts)`
      ).count;
      counts.accountContacts = (
        await tx`delete from account_contacts where account_id in (select id from spike_accounts)`
      ).count;
      counts.contacts = (
        await tx`delete from contacts where id in (select id from spike_contacts)`
      ).count;
      counts.accountEntities = (
        await tx`delete from account_entities where account_id in (select id from spike_accounts)`
      ).count;
      counts.accounts = (
        await tx`delete from accounts where id in (select id from spike_accounts)`
      ).count;
      counts.idempotencyKeys = (
        await tx`delete from idempotency_keys where principal_id in ${tx(owners)}`
      ).count;
      return counts;
    }),
  );
}

interface CaseResult {
  runs: number;
  p50: number;
  p95: number;
  max: number;
  rows: number;
  overTarget: boolean;
}

/** Times one read: `WARMUP` untimed runs, then `RUNS` timed ones, from executeQuery's own line. */
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
    `  ${name.padEnd(22)} p50 ${String(result.p50).padStart(7)} ms  p95 ${String(result.p95).padStart(7)} ms  max ${String(result.max).padStart(7)} ms  (${String(rows)} rows)`,
  );
  return result;
}

/** The cursor of page `page` of the leads list, followed from the first page. */
async function cursorOfPage(principal: Principal, page: number): Promise<string | undefined> {
  let cursor: string | undefined;
  for (let i = 1; i < page; i++) {
    const next: LeadPage = await executeQuery(principal, {}, (context) =>
      listLeads(context, { limit: PAGE, cursor }),
    );
    if (next.nextCursor === null) return undefined;
    cursor = next.nextCursor;
  }
  return cursor;
}

/** The ⌘K palette's one read, as actions/search.ts makes it: leads, and people for an admin. */
function palette(principal: Principal, q: string) {
  return async (context: RequestContext) => ({
    leads: await searchLeads(context, { q, limit: PALETTE_HITS }),
    people: hasGrant(principal.permissions, 'admin.users.write', 'all')
      ? await searchPeople(context, { q, limit: PALETTE_HITS })
      : [],
  });
}

async function measure(principal: Principal, sample: Seeded['sample']) {
  const cases: Record<string, CaseResult | { skipped: string }> = {};
  cases.leadsFirstPage = await timeCase(
    principal,
    'leads list, first page',
    (context) => listLeads(context, { limit: PAGE }),
    (a) => a.items.length,
  );
  const cursor = await cursorOfPage(principal, LATER_PAGE);
  cases.leadsLaterPage =
    cursor === undefined
      ? { skipped: `fewer than ${String(LATER_PAGE)} pages` }
      : await timeCase(
          principal,
          `leads list, page ${String(LATER_PAGE)}`,
          (context) => listLeads(context, { limit: PAGE, cursor }),
          (a) => a.items.length,
        );
  cases.board = await timeCase(
    principal,
    'board, farmer pumps',
    (context) => listBoardLeads(context, { pipelineKey: 'farmer_pumps' }),
    (a) => a.items.length,
  );
  const hits = (a: { leads: unknown[]; people: unknown[] }) => a.leads.length + a.people.length;
  cases.searchName = await timeCase(
    principal,
    'search, name',
    palette(principal, sample.name),
    hits,
  );
  // The leads half of the palette alone, to tell it from the people search an admin also runs.
  cases.searchNameLeadsOnly = await timeCase(
    principal,
    'search, name, leads',
    (context) => searchLeads(context, { q: sample.name, limit: PALETTE_HITS }),
    (a) => a.length,
  );
  cases.searchVillage = await timeCase(
    principal,
    'search, village',
    palette(principal, sample.village),
    hits,
  );
  cases.searchPhoneLast4 = await timeCase(
    principal,
    'search, phone last 4',
    palette(principal, sample.phoneLast4),
    hits,
  );
  if (hasGrant(principal.permissions, 'audit.read', 'entity')) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    cases.auditFirstPage = await timeCase(
      principal,
      'activity log, page 1',
      (context) =>
        queryAudit(context, { from: from.toISOString(), to: to.toISOString(), limit: PAGE }),
      (a) => a.items.length,
    );
  } else {
    cases.auditFirstPage = { skipped: 'the role may not read the Activity log' };
  }
  return cases;
}

async function main(): Promise<void> {
  await prepareDatabase();
  const rtt = await roundTripMs();
  log(`database round trip: ${String(rtt)} ms`);
  const seeded = await seed();
  const owners = [...seeded.callers.values()].flat().map((p) => p.id);
  const teleCaller = seeded.callers.get(1)?.[0];
  if (teleCaller === undefined) throw new Error('no tele-caller was made');

  try {
    const [visible] = await asMigrator(
      (m) => m<{ opportunities: number; audit: number }[]>`
        select (select count(*)::int from opportunities where archived_at is null) as opportunities,
               (select count(*)::int from audit_logs
                 where created_at >= now() - interval '30 days') as audit`,
    );
    const principals = {
      executive: await createTestPrincipal('executive', ALL_ENTITY_IDS),
      generalManager: await createTestPrincipal('general_manager', [1]),
      teleCaller,
    };
    const results: Record<string, unknown> = {};
    for (const [key, principal] of Object.entries(principals)) {
      log(`${key} (${principal.roleKey}, companies ${principal.entityIds.join(', ')}):`);
      results[key] = await measure(principal, seeded.sample);
    }

    const result = {
      ranAt: new Date().toISOString(),
      machine: {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        cpus: `${String(cpus().length)} × ${cpus()[0]?.model.trim() ?? 'unknown'}`,
        memoryGb: Math.round(totalmem() / 1024 ** 3),
      },
      database:
        'local Docker Postgres 17 (supabase/postgres), in process, one connection, as app_user under RLS',
      roundTripMs: rtt,
      seed: {
        leads: LEADS,
        companies: ALL_ENTITY_IDS.length,
        callersPerCompany: CALLERS_PER_COMPANY,
        leadsPerCaller: Math.ceil(LEADS / (ALL_ENTITY_IDS.length * CALLERS_PER_COMPANY)),
        seconds: seeded.seconds,
        path: 'commitLeadBatch (the import commit set-based path), 500 rows a transaction',
        openLeadsInDatabase: visible?.opportunities ?? null,
        auditRowsLast30Days: visible?.audit ?? null,
      },
      method: {
        warmupRuns: WARMUP,
        timedRuns: RUNS,
        pageSize: PAGE,
        laterPage: LATER_PAGE,
        paletteHitsPerKind: PALETTE_HITS,
        timing:
          'durationMs of the query.completed line of executeQuery: transaction, context settings and query, in process',
        targetP95Ms: SLOW_CALL_MS,
        searchTerms: {
          name: seeded.sample.name,
          village: seeded.sample.village,
          phoneLast4: seeded.sample.phoneLast4,
        },
      },
      results,
    };
    writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
    log(`wrote ${resultFile}`);
  } finally {
    if (KEEP) {
      log('--keep: the seeded leads stay in the database');
    } else {
      const removed = await removeSeeded(owners);
      log(`removed the seeded rows: ${JSON.stringify(removed)}`);
    }
  }
}

try {
  await main();
} finally {
  await closeDb();
}
