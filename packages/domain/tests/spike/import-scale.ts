// Import scale spike (design §6.3 and §8, IMP-01): `pnpm spike:import`, options
// `-- --rows 50000 --batch 500 --budget 420 --dedupe 5000 --csv`.
// Builds a made-up leads file in memory (invented names and villages, made-up mobile numbers): a
// workbook by default, written with ExcelJS's streaming writer, which stores the workbook part
// last, or a CSV with `--csv`. The file is read as the server reads an uploaded one
// (`parseImportFile`, the streaming reader for a workbook) while the process's memory is sampled,
// and recorded as a checked upload (`files`, `ready`, as the pre-signed upload leaves it). The
// real commands then run in process through executeCommand, against the local database only
// (prepareDatabase refuses any other host): imports.job.create → map → preview → commit →
// commit_batch in batches (one transaction each, as the worker runs them) until the job is
// committed or the time budget (`--budget`, seconds) runs out.
// With the job's customers in place, a second file of `--dedupe` rows (0 to skip) names the same
// people and villages with new numbers: its preview is timed, and the name-and-village search of
// its first thousand rows is shown with `EXPLAIN (ANALYZE, BUFFERS)` under the policies, as the
// preview runs it. Then imports.job.rollback archives the leads again (a job still committing is
// left as it is, and the next run fails and undoes it first).
// Writes docs/spikes/results/import-scale-xlsx.json (or import-scale-csv.json) and the plan to
// docs/spikes/results/import-dedupe-plan.txt. Not part of CI. It lives under tests/ because it
// creates its caller with the testing helpers, which scripts outside the tests may not import.
import { IMPORT_LIMITS, type ImportJobDto, type Principal } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { executeCommand } from '../../src/command/execute';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { failImportJob } from '../../src/commands/imports/fail-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import {
  existingByNameAndVillage,
  previewImportJob,
} from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { matchKey } from '../../src/imports/leads';
import { parseImportFile } from '../../src/imports/parse';

const here = dirname(fileURLToPath(import.meta.url));
const results = resolve(here, '..', '..', '..', '..', 'docs', 'spikes', 'results');

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Number(process.argv[index + 1]);
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

const ROWS = Math.min(numberArg('rows', IMPORT_LIMITS.maxRows), IMPORT_LIMITS.maxRows);
const BATCH = Math.min(numberArg('batch', IMPORT_LIMITS.batchSize), IMPORT_LIMITS.batchSize);
const BUDGET_SECONDS = numberArg('budget', 420);
const DEDUPE_ROWS = Math.min(numberArg('dedupe', 5000), IMPORT_LIMITS.maxRows);
const FORMAT: 'xlsx' | 'csv' = process.argv.includes('--csv') ? 'csv' : 'xlsx';
const ENTITY = 1;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Syllables put together, so no row names a real person or place.
const FIRST = ['Ravok', 'Keluv', 'Mivra', 'Tanvor', 'Joruk', 'Pavid', 'Sanko', 'Dilum', 'Herav'];
const LAST = ['Kantarvi', 'Velorin', 'Dharvik', 'Sumelok', 'Tordan', 'Pakhrin', 'Lovantu'];
const PLACE = ['Kherovan', 'Balvanti', 'Sotikul', 'Mandravi', 'Rupalko', 'Tikhalam', 'Verajun'];

/** A made-up Indian mobile number: unique for every n below 900 million. */
function mobile(n: number): string {
  return `7${String(100_000_000 + ((n * 7_919) % 900_000_000)).padStart(9, '0')}`;
}

/** Row i of a file: a name and a village from i, the number from i + `numberOffset`. */
function fileRow(i: number, numberOffset: number): [string, string, string] {
  const name = `${FIRST[i % FIRST.length] ?? ''} ${LAST[Math.floor(i / 9) % LAST.length] ?? ''}`;
  const village = `${PLACE[i % PLACE.length] ?? ''} ${String(Math.floor(i / 64) % 250)}`;
  return [name, mobile(i + 1 + numberOffset), village];
}

function csv(rows: number, numberOffset: number): Uint8Array {
  const lines = ['Name,Mobile,Village'];
  for (let i = 0; i < rows; i++) lines.push(fileRow(i, numberOffset).join(','));
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

/** The same rows as a workbook, written as a stream, as a spreadsheet program's export is. */
async function xlsx(rows: number, numberOffset: number): Promise<Uint8Array> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((done) => out.on('end', done));
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useSharedStrings: true });
  const sheet = book.addWorksheet('Leads');
  sheet.addRow(['Name', 'Mobile', 'Village']).commit();
  for (let i = 0; i < rows; i++) sheet.addRow(fileRow(i, numberOffset)).commit();
  sheet.commit();
  await book.commit();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function seconds(from: number): number {
  return Math.round((performance.now() - from) / 10) / 100;
}

function rate(rows: number, secs: number): number {
  return secs === 0 ? 0 : Math.round(rows / secs);
}

const MB = 1024 * 1024;
const mb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10;

/** Reads a file as the server does, sampling the process's memory every 10 ms meanwhile. */
async function measuredParse(bytes: Uint8Array) {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const before = process.memoryUsage();
  let peakRss = before.rss;
  let peakHeap = before.heapUsed;
  const sample = setInterval(() => {
    const now = process.memoryUsage();
    peakRss = Math.max(peakRss, now.rss);
    peakHeap = Math.max(peakHeap, now.heapUsed);
  }, 10);
  const t = performance.now();
  try {
    const parsed = await parseImportFile(bytes);
    const secs = seconds(t);
    const after = process.memoryUsage();
    peakRss = Math.max(peakRss, after.rss);
    peakHeap = Math.max(peakHeap, after.heapUsed);
    return {
      parsed,
      timing: {
        seconds: secs,
        rows: parsed.rows.length,
        fileMB: mb(bytes.length),
        rssBeforeMB: mb(before.rss),
        rssPeakMB: mb(peakRss),
        rssGrowthMB: mb(peakRss - before.rss),
        heapBeforeMB: mb(before.heapUsed),
        heapPeakMB: mb(peakHeap),
        heapGrowthMB: mb(peakHeap - before.heapUsed),
        // The rows read, as text: what any reader must hand on, whatever it holds meanwhile.
        rowsTextMB: mb(parsed.rows.reduce((n, r) => n + r.join('').length * 2, 0)),
        collectedBeforeRead: gc !== undefined,
      },
    };
  } finally {
    clearInterval(sample);
  }
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

const scope = { entityIds: [ENTITY] };

/** Make, read, record, create, map and preview a made-up file; the job ends previewed. */
async function previewedJob(gm: Principal, rows: number, numberOffset: number) {
  let t = performance.now();
  const bytes = FORMAT === 'xlsx' ? await xlsx(rows, numberOffset) : csv(rows, numberOffset);
  const makeSecs = seconds(t);
  const { parsed, timing: parse } = await measuredParse(bytes);
  log(
    `${String(rows)} rows: ${FORMAT} of ${String(parse.fileMB)} MB made in ${String(makeSecs)} s, read in ${String(parse.seconds)} s, memory +${String(parse.rssGrowthMB)} MB (heap +${String(parse.heapGrowthMB)} MB)`,
  );
  const fileId = await createReadyImportFile(ENTITY, gm.id, {
    name: `import-scale-spike.${FORMAT}`,
    contentType: FORMAT === 'xlsx' ? XLSX : 'text/csv',
    size: bytes.length,
    // A new checksum each run: the same file may not start a second job in a company.
    sha256: createHash('sha256').update(bytes).update(randomUUID()).digest('hex'),
  });

  t = performance.now();
  const job = await executeCommand(gm, scope, createImportJob, {
    entityId: ENTITY,
    kind: 'leads',
    fileId,
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
  const createSecs = seconds(t);

  t = performance.now();
  await executeCommand(gm, scope, mapImportJob, {
    entityId: ENTITY,
    jobId: job.id,
    mapping: {
      columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
      defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
    },
  });
  const mapSecs = seconds(t);

  t = performance.now();
  const previewed = await executeCommand(gm, scope, previewImportJob, {
    entityId: ENTITY,
    jobId: job.id,
  });
  const previewSecs = seconds(t);
  const timings = {
    rows,
    format: FORMAT,
    make: { seconds: makeSecs },
    parse,
    create: { seconds: createSecs, rowsPerSecond: rate(rows, createSecs) },
    map: { seconds: mapSecs },
    preview: {
      seconds: previewSecs,
      rowsPerSecond: rate(rows, previewSecs),
      validRows: previewed.validRows,
      invalidRows: previewed.invalidRows,
      skippedRows: previewed.skippedRows,
    },
  };
  log(
    `${String(rows)} rows: create ${String(createSecs)} s (${String(timings.create.rowsPerSecond)} rows/s), preview ${String(previewSecs)} s (${String(timings.preview.rowsPerSecond)} rows/s), ${String(previewed.validRows)} valid`,
  );
  return { job: previewed, timings };
}

/**
 * The second file's preview against the customers the first one made, and the plan of its
 * name-and-village search: the query `existingByNameAndVillage` sends, run under `explain` as the
 * General Manager, inside the policies.
 */
async function dedupeAtScale(gm: Principal) {
  const [customers] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from customer_sites s
                               join account_entities ae on ae.account_id = s.account_id
                              where s.archived_at is null and ae.entity_id = ${ENTITY}`,
  );
  const second = await previewedJob(gm, DEDUPE_ROWS, 10_000_000);
  const [suggested] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from import_rows
                               where job_id = ${second.job.id}
                                 and dedupe_json -> 'existing' @> '[{"matchedBy": "name_village"}]'`,
  );
  const pairs = Array.from({ length: Math.min(DEDUPE_ROWS, 1000) }, (_, i) => {
    const [name, , village] = fileRow(i, 0);
    return { name: matchKey(name), village: matchKey(village) };
  });
  let plan = '';
  await asPrincipal(gm, async (ctx) => {
    const explaining = {
      async execute(query: SQL) {
        const rows = (await ctx.tx.execute(
          sql`explain (analyze, buffers, costs off) ${query}`,
        )) as unknown as Record<string, string>[];
        plan = rows.map((r) => Object.values(r)[0]).join('\n');
        return [];
      },
    } as unknown as RequestTx;
    await existingByNameAndVillage(explaining, pairs);
  });
  const text = [
    `Name-and-village search of the import preview (existingByNameAndVillage), ${String(pairs.length)} pairs,`,
    `run as a General Manager of company ${String(ENTITY)} under the policies, with ${String(customers?.n ?? 0)} live customer sites in the company.`,
    `Recorded by pnpm spike:import on ${new Date().toISOString()}.`,
    '',
    plan,
    '',
  ].join('\n');
  writeFileSync(join(results, 'import-dedupe-plan.txt'), text);
  log(`dedupe: ${String(suggested?.n ?? 0)} rows suggested by name and village`);
  log(plan);
  return {
    liveSitesInCompany: customers?.n ?? 0,
    secondFile: second.timings,
    rowsSuggestedByNameAndVillage: suggested?.n ?? 0,
    explainedPairs: pairs.length,
    planExecutionMs: Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? Number.NaN),
    planUsesIndexes: {
      village: plan.includes('customer_sites_village_key_idx'),
      name: plan.includes('contacts_name_key_idx'),
    },
  };
}

/** An earlier run stopped part-way leaves its job committing or committed: it is undone first. */
async function undoEarlierRuns(gm: Principal): Promise<void> {
  const left = await asMigrator(
    (m) => m<{ id: string; state: string }[]>`
      select j.id, j.state from import_jobs j join files f on f.id = j.file_id
       where j.entity_id = ${ENTITY} and f.name like 'import-scale-spike.%'
         and j.state in ('committing', 'committed', 'failed')`,
  );
  for (const job of left) {
    const ref = { entityId: ENTITY, jobId: job.id };
    if (job.state === 'committing') await executeCommand(gm, scope, failImportJob, ref);
    await executeCommand(gm, scope, rollbackImportJob, ref);
    log(`undid the job ${job.id} an earlier run left ${job.state}`);
  }
}

async function main(): Promise<void> {
  await prepareDatabase();
  const gm = await createTestPrincipal('general_manager', [ENTITY]);
  await undoEarlierRuns(gm);
  const rtt = await roundTripMs();
  log(`database round trip: ${String(rtt)} ms`);
  const host = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/\/.*$/, '');
  const result: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    database: `local Docker Postgres 17 on Windows (${host}), in process, one connection`,
    node: process.version,
    roundTripMs: rtt,
    batchSize: BATCH,
    budgetSeconds: BUDGET_SECONDS,
  };

  const file = await previewedJob(gm, ROWS, 0);
  const jobId = file.job.id;
  let t = performance.now();
  let current: ImportJobDto = await executeCommand(gm, scope, commitImportJob, {
    entityId: ENTITY,
    jobId,
  });
  const batchTimes: number[] = [];
  while (current.state === 'committing' && seconds(t) < BUDGET_SECONDS) {
    const b = performance.now();
    current = await executeCommand(gm, scope, commitImportBatch, {
      entityId: ENTITY,
      jobId,
      batchSize: BATCH,
    });
    batchTimes.push(seconds(b));
    if (batchTimes.length % 10 === 0) {
      log(`commit: ${String(current.committedRows)} rows after ${String(seconds(t))} s`);
    }
  }
  const commitSecs = seconds(t);
  const sorted = [...batchTimes].sort((a, b) => a - b);
  const commitRate = current.committedRows / Math.max(commitSecs, 0.01);
  const commit: Record<string, unknown> = {
    seconds: commitSecs,
    committedRows: current.committedRows,
    state: current.state,
    batches: batchTimes.length,
    rowsPerSecond: Math.round(commitRate * 10) / 10,
    msPerRow:
      current.committedRows === 0 ? null : Math.round((commitSecs * 1000) / current.committedRows),
    batchSecondsMedian: sorted[Math.floor(sorted.length / 2)] ?? 0,
    batchSecondsMax: sorted[sorted.length - 1] ?? 0,
    projectedSecondsFor50k:
      commitRate === 0 ? null : Math.round(IMPORT_LIMITS.maxRows / commitRate),
  };
  log(
    `commit: ${String(current.committedRows)} rows in ${String(commitSecs)} s, ${String(commit.rowsPerSecond)} rows/s, ${current.state}`,
  );

  const dedupe = DEDUPE_ROWS > 0 ? await dedupeAtScale(gm) : { skipped: true };

  if (current.state === 'committed') {
    t = performance.now();
    const rolled = await executeCommand(gm, scope, rollbackImportJob, { entityId: ENTITY, jobId });
    const rollbackSecs = seconds(t);
    commit.rollback = {
      seconds: rollbackSecs,
      rowsPerSecond: rate(current.committedRows, rollbackSecs),
      state: rolled.state,
    };
    log(`rollback: ${String(rollbackSecs)} s, ${rolled.state}`);
  } else {
    commit.rollback = { skipped: true, jobState: current.state, jobId };
  }
  Object.assign(result, file.timings, { jobId, commit, dedupe });

  const resultFile = join(results, `import-scale-${FORMAT}.json`);
  writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  log(`wrote ${resultFile}`);
}

try {
  await main();
} finally {
  await closeDb();
}
