// Import scale spike (design §8, IMP-01): `pnpm spike:import [-- --rows 50000 --budget 420]`.
// Builds a made-up leads file in memory (invented names, made-up mobile numbers, invented
// villages), then runs imports.job.create → map → preview → commit → commit_batch (500 rows a
// batch, one transaction each, as the worker does) → rollback through executeCommand against the
// local database only (prepareDatabase refuses any other host), and reports rows per second for
// each step. The commit stops at the time budget; a job left committing is reported as such and
// is not rolled back (a job can be rolled back only once it has finished). Writes
// docs/spikes/results/import-scale.json. Not part of CI. It lives under tests/ because it creates
// its caller with the testing helpers, which scripts outside the tests may not import.
import { IMPORT_LIMITS, newId, type ImportJobDto } from '@shakti/contracts';
import { closeDb, createTestPrincipal, prepareDatabase } from '@shakti/db/testing';
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
const BUDGET_SECONDS = numberArg('budget', 420);
const ENTITY = 1;

// Syllables put together, so no row names a real person or place.
const FIRST = ['Ravo', 'Kelu', 'Mira', 'Tanvi', 'Joru', 'Pavi', 'Sanko', 'Dilu', 'Heru', 'Nimo'];
const LAST = ['Kantar', 'Velori', 'Dharvik', 'Sumel', 'Tordan', 'Pakhri', 'Lovant', 'Minder'];
const PLACE = ['Kheru', 'Balvan', 'Soti', 'Mandor', 'Rupal', 'Tikhal', 'Veraj', 'Gondi'];

/** A made-up Indian mobile number from the row number: unique within the file. */
function mobile(n: number): string {
  return `7${String(100_000_000 + ((n * 7_919) % 900_000_000)).padStart(9, '0')}`;
}

function csv(rows: number): string {
  const lines = ['Name,Mobile,Village'];
  for (let i = 0; i < rows; i++) {
    const name = `${FIRST[i % FIRST.length] ?? ''} ${LAST[Math.floor(i / 10) % LAST.length] ?? ''}`;
    const village = `${PLACE[i % PLACE.length] ?? ''} ${String(Math.floor(i / 64) % 250)}`;
    lines.push(`${name},${mobile(i + 1)},${village}`);
  }
  return `${lines.join('\n')}\n`;
}

function seconds(from: number): number {
  return Math.round((performance.now() - from) / 10) / 100;
}

function rate(rows: number, secs: number): number {
  return secs === 0 ? 0 : Math.round(rows / secs);
}

async function main(): Promise<void> {
  await prepareDatabase();
  const gm = await createTestPrincipal('general_manager', [ENTITY]);
  const scope = { entityIds: [ENTITY] };
  const result: Record<string, unknown> = {
    rows: ROWS,
    batchSize: IMPORT_LIMITS.batchSize,
    budgetSeconds: BUDGET_SECONDS,
    database: 'local Docker Postgres 17 (127.0.0.1:54322), shared with the test suites',
    ranAt: new Date().toISOString(),
  };

  let t = performance.now();
  const bytes = new TextEncoder().encode(csv(ROWS));
  const parsed = await parseImportFile(bytes);
  result.parse = { seconds: seconds(t), bytes: bytes.length };
  console.log(`parsed ${String(parsed.rows.length)} rows in ${String(seconds(t))} s`);

  t = performance.now();
  const job = await executeCommand(gm, scope, createImportJob, {
    entityId: ENTITY,
    kind: 'leads',
    file: {
      name: 'import-scale-spike.csv',
      contentType: 'text/csv',
      size: bytes.length,
      sha256: createHash('sha256')
        .update(bytes)
        .update(newId()) // a new job each run: the same file may not start a second job
        .digest('hex'),
      bucket: 'memory',
      key: `imports/${String(ENTITY)}/${newId()}`,
    },
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
  const createSecs = seconds(t);
  result.create = { seconds: createSecs, rowsPerSecond: rate(ROWS, createSecs) };
  console.log(`create: ${String(createSecs)} s`);

  t = performance.now();
  await executeCommand(gm, scope, mapImportJob, {
    entityId: ENTITY,
    jobId: job.id,
    mapping: {
      columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
      defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
    },
  });
  result.map = { seconds: seconds(t) };

  t = performance.now();
  const previewed = await executeCommand(gm, scope, previewImportJob, {
    entityId: ENTITY,
    jobId: job.id,
  });
  const previewSecs = seconds(t);
  result.preview = {
    seconds: previewSecs,
    rowsPerSecond: rate(ROWS, previewSecs),
    validRows: previewed.validRows,
    invalidRows: previewed.invalidRows,
    skippedRows: previewed.skippedRows,
  };
  console.log(
    `preview: ${String(previewSecs)} s, ${String(rate(ROWS, previewSecs))} rows/s, ${String(previewed.validRows)} valid`,
  );

  t = performance.now();
  let current: ImportJobDto = await executeCommand(gm, scope, commitImportJob, {
    entityId: ENTITY,
    jobId: job.id,
  });
  const batchTimes: number[] = [];
  while (current.state === 'committing' && seconds(t) < BUDGET_SECONDS) {
    const b = performance.now();
    current = await executeCommand(gm, scope, commitImportBatch, {
      entityId: ENTITY,
      jobId: job.id,
      batchSize: IMPORT_LIMITS.batchSize,
    });
    batchTimes.push(seconds(b));
    if (batchTimes.length % 10 === 0) {
      console.log(`commit: ${String(current.committedRows)} rows after ${String(seconds(t))} s`);
    }
  }
  const commitSecs = seconds(t);
  const sorted = [...batchTimes].sort((a, b) => a - b);
  result.commit = {
    seconds: commitSecs,
    committedRows: current.committedRows,
    state: current.state,
    batches: batchTimes.length,
    rowsPerSecond: rate(current.committedRows, commitSecs),
    batchSecondsMedian: sorted[Math.floor(sorted.length / 2)] ?? 0,
    batchSecondsMax: sorted[sorted.length - 1] ?? 0,
    finishedWithinBudget: current.state === 'committed',
  };
  console.log(
    `commit: ${String(current.committedRows)} rows in ${String(commitSecs)} s, ${String(rate(current.committedRows, commitSecs))} rows/s, ${current.state}`,
  );

  if (current.state === 'committed' && !process.argv.includes('--keep')) {
    t = performance.now();
    const rolled = await executeCommand(gm, scope, rollbackImportJob, {
      entityId: ENTITY,
      jobId: job.id,
    });
    const rollbackSecs = seconds(t);
    result.rollback = {
      seconds: rollbackSecs,
      rowsPerSecond: rate(current.committedRows, rollbackSecs),
      state: rolled.state,
    };
    console.log(`rollback: ${String(rollbackSecs)} s, ${rolled.state}`);
  } else {
    result.rollback = { skipped: true, jobId: job.id, jobState: current.state };
  }

  writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${resultFile}`);
}

try {
  await main();
} finally {
  await closeDb();
}
