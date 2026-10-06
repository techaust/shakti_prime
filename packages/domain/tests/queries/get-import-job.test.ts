import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import { schema } from '@shakti/db';
import {
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
} from '@shakti/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createImportJob } from '../../src/commands/imports/create-job';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { getImportJob } from '../../src/queries/imports/import-queries';

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

/** A mobile number no earlier run used. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** A job for a one-row CSV in the given company, as the upload action makes it. */
async function uploadedJob(principal: Principal, entityId: number): Promise<ImportJobDto> {
  const bytes = new TextEncoder().encode(`Name,Mobile\nGomti,${phone()}\n`);
  const parsed = await parseImportFile(bytes);
  const fileId = await createReadyImportFile(entityId, principal.id, {
    name: `get-job-${newId()}.csv`,
    size: bytes.length,
  });
  return asPrincipal(principal, (context) =>
    runCommand(
      createImportJob,
      { context, audit, outbox },
      {
        entityId,
        kind: 'leads',
        fileId,
        format: parsed.format,
        columns: parsed.columns,
        rows: parsed.rows,
      },
    ),
  );
}

/** What the caller's own reads of the job's tables return, past any code guard (RLS only). */
function tablesSeenBy(principal: Principal, jobId: string, fileId: string) {
  return asPrincipal(principal, async ({ tx }) => ({
    jobs: await tx.select().from(schema.importJobs).where(eq(schema.importJobs.id, jobId)),
    rows: await tx.select().from(schema.importRows).where(eq(schema.importRows.jobId, jobId)),
    files: await tx.select().from(schema.files).where(eq(schema.files.id, fileId)),
  }));
}

let gm: Principal;
let otherGm: Principal;
let executive: Principal;
let caller: Principal;
let job: ImportJobDto;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  otherGm = await createTestPrincipal('general_manager', [2]);
  executive = await createTestPrincipal('executive', [1, 2]);
  // Works in the first company but may not import.
  caller = await createTestPrincipal('tele_caller_cc', [1]);
  job = await uploadedJob(gm, 1);
});

describe('getImportJob', () => {
  it('answers the job to someone who may import in its company', async () => {
    const seen = await asPrincipal(gm, (ctx) => getImportJob(ctx, { entityId: 1, jobId: job.id }));
    expect(seen).toEqual(job);
    expect(seen).toMatchObject({ entityId: 1, state: 'uploaded', totalRows: 1, createdBy: gm.id });
    // An Executive of both companies sees it too, under its own company.
    await expect(
      asPrincipal(executive, (ctx) => getImportJob(ctx, { entityId: 1, jobId: job.id })),
    ).resolves.toEqual(job);
  });

  it('shows another company nothing', async () => {
    // Its own company named: the job is not there.
    await expect(
      asPrincipal(otherGm, (ctx) => getImportJob(ctx, { entityId: 2, jobId: job.id })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'import_job_missing' } });
    // The job's company named: outside the caller, refused before any read.
    await expect(
      asPrincipal(otherGm, (ctx) => getImportJob(ctx, { entityId: 1, jobId: job.id })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The wrong company named by someone who sees both: still not there.
    await expect(
      asPrincipal(executive, (ctx) => getImportJob(ctx, { entityId: 2, jobId: job.id })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'import_job_missing' } });
    // And the tables themselves hold nothing for them.
    expect(await tablesSeenBy(otherGm, job.id, job.file.id)).toEqual({
      jobs: [],
      rows: [],
      files: [],
    });
  });

  it('shows someone without the import permission nothing', async () => {
    await expect(
      asPrincipal(caller, (ctx) => getImportJob(ctx, { entityId: 1, jobId: job.id })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await tablesSeenBy(caller, job.id, job.file.id)).toEqual({
      jobs: [],
      rows: [],
      files: [],
    });
    // The owner company's importer sees all three, so the empty answers above are the policies.
    const own = await tablesSeenBy(gm, job.id, job.file.id);
    expect([own.jobs.length, own.rows.length, own.files.length]).toEqual([1, 1, 1]);
  });

  it('answers not found for a job that does not exist', async () => {
    await expect(
      asPrincipal(gm, (ctx) => getImportJob(ctx, { entityId: 1, jobId: newId() })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'import_job_missing' } });
  });
});
