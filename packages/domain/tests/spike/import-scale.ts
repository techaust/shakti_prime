// Import scale spike (design §8, IMP-01): `pnpm spike:import`, options
// `-- --rows 50000 --batch 500 --budget 420`.
// Builds a made-up leads file in memory (invented names and villages, made-up mobile numbers) and
// runs the real commands in process through executeCommand, against the local database only
// (prepareDatabase refuses any other host): imports.job.create → map → preview → commit →
// commit_batch in batches (one transaction each, as the worker runs them) until the job is
// committed or the time budget (`--budget`, seconds) runs out, then imports.job.rollback so the
// leads are archived again (a job still committing is left as it is).
// The commit rate follows the round trip to the database, which the spike measures too. Writes
// docs/spikes/results/import-scale.json. Not part of CI. It lives under tests/ because it
// creates its caller with the testing helpers, which scripts outside the tests may not import.
import { IMPORT_LIMITS, newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal, prepareDatabase } from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCommand } from '../../src/command/execute';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { parseImportFile } from '../../src/imports/parse';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultFile = join(repoRoot, 'docs', 'spikes', 'results', 'import-scale.json');

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Number(process.argv[index + 1]);
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

const ROWS = Math.min(numberArg('rows', IMPORT_LIMITS.maxRows), IMPORT_LIMITS.maxRows);
const BATCH = Math.min(numberArg('batch', IMPORT_LIMITS.batchSize), IMPORT_LIMITS.batchSize);
const BUDGET_SECONDS = numberArg('budget', 420);
const ENTITY = 1;

// Syllables put together, so no row names a real person or place.
const FIRST = ['Ravok', 'Keluv', 'Mivra', 'Tanvor', 'Joruk', 'Pavid', 'Sanko', 'Dilum', 'Herav'];
const LAST = ['Kantarvi', 'Velorin', 'Dharvik', 'Sumelok', 'Tordan', 'Pakhrin', 'Lovantu'];
const PLACE = ['Kherovan', 'Balvanti', 'Sotikul', 'Mandravi', 'Rupalko', 'Tikhalam', 'Verajun'];

/** A made-up Indian mobile number from the row number: unique within a file of 50,000 rows. */
function mobile(n: number): string {
  return `7${String(100_000_000 + ((n * 7_919) % 900_000_000)).padStart(9, '0')}`;
}

function csv(rows: number, offset: number): string {
  const lines = ['Name,Mobile,Village'];
  for (let i = offset; i < offset + rows; i++) {
    const name = `${FIRST[i % FIRST.length] ?? ''} ${LAST[Math.floor(i / 9) % LAST.length] ?? ''}`;
    const village = `${PLACE[i % PLACE.length] ?? ''} ${String(Math.floor(i / 64) % 250)}`;
    lines.push(`${name},${mobile(i + 1)},${village}`);
  }
  return `${lines.join('\n')}\n`;
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

/** Parse, create, map and preview a made-up file; the job ends previewed. */
async function previewedJob(gm: Principal, rows: number, offset: number) {
  let t = performance.now();
  const bytes = new TextEncoder().encode(csv(rows, offset));
  const parsed = await parseImportFile(bytes);
  const parse = { seconds: seconds(t), bytes: bytes.length };

  t = performance.now();
  const job = await executeCommand(gm, scope, createImportJob, {
    entityId: ENTITY,
    kind: 'leads',
    file: {
      name: 'import-scale-spike.csv',
      contentType: 'text/csv',
      size: bytes.length,
      // A new job each run: the same file may not start a second job in a company.
      sha256: createHash('sha256').update(bytes).update(newId()).digest('hex'),
      bucket: 'memory',
      key: `imports/${String(ENTITY)}/${newId()}`,
    },
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

async function main(): Promise<void> {
  await prepareDatabase();
  const gm = await createTestPrincipal('general_manager', [ENTITY]);
  const rtt = await roundTripMs();
  log(`database round trip: ${String(rtt)} ms`);
  const result: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    database:
      'local Docker Postgres 17 on Windows (127.0.0.1:54322), shared with the test suites, in process, one connection',
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
  Object.assign(result, file.timings, { jobId, commit });

  writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  log(`wrote ${resultFile}`);
}

try {
  await main();
} finally {
  await closeDb();
}
