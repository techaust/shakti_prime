'use server';

import {
  CommitImportJobInput,
  DomainError,
  GetImportJobInput,
  ListImportJobsInput,
  ListImportRowsInput,
  ListImportTemplatesInput,
  MapImportJobInput,
  PreviewImportJobInput,
  RollbackImportJobInput,
  StartImportInput,
  type ImportJobDto,
  type ImportJobPage,
  type ImportKind,
  type ImportRowPage,
  type ImportTemplateDto,
  type Principal,
} from '@shakti/contracts';
import {
  checkPermission,
  commitImportJob as commitImportJobCommand,
  createImportJob,
  executeCommand,
  executeQuery,
  getImportJob as getImportJobQuery,
  getStoredFile,
  listImportJobs as listImportJobsQuery,
  listImportRows as listImportRowsQuery,
  listImportTemplates as listImportTemplatesQuery,
  mapImportJob as mapImportJobCommand,
  parseImportFile,
  previewImportJob as previewImportJobCommand,
  rollbackImportJob as rollbackImportJobCommand,
  sha256Hex,
} from '@shakti/domain';
import { requireFileStore } from '../files/uploads';
import { logger } from '../log';
import { scheduleImportCommit } from '../workers/imports';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Thin wrappers for the import screens (docs/API.md §4, docs/design/phase1.md §6.3): session →
 * parse → request context → command or query → the result envelope.
 */

/**
 * The companies a job's request acts for: a leads file works in its own company; a customers file
 * may name any company the person is working in, and the PIN code master needs every one of them
 * (the commands refuse it otherwise).
 */
function importScope(principal: Principal, entityId: number, kind: ImportKind): number[] {
  if (!principal.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the caller', { entityId });
  }
  return kind === 'leads' ? [entityId] : [...principal.entityIds];
}

/** The scope of an existing job, by its kind, read in its own company first. */
async function jobScope(
  principal: Principal,
  input: { entityId: number; jobId: string },
  requestId: string,
): Promise<number[]> {
  const job = await executeQuery(
    principal,
    { entityIds: [input.entityId], requestId },
    (ctx) => getImportJobQuery(ctx, input),
    { name: 'imports.jobScope' },
  );
  return importScope(principal, input.entityId, job.kind);
}

/**
 * The second step of the upload, once the file came through the pre-signed upload and passed its
 * checks: the server reads the stored file (a workbook through the streaming reader), checks it
 * against the limits, and `imports.job.create` records the job and its rows. A file still in its
 * checks answers `import_file_not_ready`, and the screen asks again in a moment.
 */
export async function startImport(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('startImport', async () => {
    const principal = await signedIn();
    const input = parseInput(StartImportInput, rawInput);
    // Nothing is read for someone who may not import.
    checkPermission(principal, 'imports.write', 'entity');
    const scope = importScope(principal, input.entityId, input.kind);
    const meta = await requestMeta();
    const file = await executeQuery(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      (ctx) => getStoredFile(ctx, input.fileId),
      { name: 'startImport.file' },
    );
    if (file?.purpose !== 'import' || file.entityId !== input.entityId) {
      throw new DomainError('not_found', 'the import file is not available', {
        reason: 'import_file_missing',
      });
    }
    if (file.status === 'rejected') {
      throw new DomainError('validation_failed', 'the import file did not pass its checks', {
        reason: 'import_file_unreadable',
      });
    }
    if (file.status !== 'ready') {
      throw new DomainError('conflict', 'the import file is still being checked', {
        reason: 'import_file_not_ready',
      });
    }
    const store = requireFileStore();
    const bytes = store.bucket === file.bucket ? await store.get(file.key) : undefined;
    if (bytes === undefined || sha256Hex(bytes) !== file.sha256) {
      throw new DomainError('integration_unavailable', 'the stored import file is not readable', {
        reason: 'import_store_failed',
        entityId: input.entityId,
      });
    }
    const parsed = await parseImportFile(bytes);
    return executeCommand(
      principal,
      { entityIds: scope, requestId: meta.requestId },
      createImportJob,
      {
        entityId: input.entityId,
        kind: input.kind,
        fileId: file.id,
        format: parsed.format,
        columns: parsed.columns,
        rows: parsed.rows,
      },
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function mapImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('mapImportJob', async () => {
    const principal = await signedIn();
    const input = parseInput(MapImportJobInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: await jobScope(principal, input, meta.requestId), requestId: meta.requestId },
      mapImportJobCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function previewImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('previewImportJob', async () => {
    const principal = await signedIn();
    const input = parseInput(PreviewImportJobInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: await jobScope(principal, input, meta.requestId), requestId: meta.requestId },
      previewImportJobCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * Starts the commit and hands it to the import worker. If the worker cannot be reached the job
 * stays committing, and asking again starts the worker again without changing anything else.
 */
export async function commitImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('commitImportJob', async () => {
    const principal = await signedIn();
    const input = parseInput(CommitImportJobInput, rawInput);
    const meta = await requestMeta();
    const scope = await jobScope(principal, input, meta.requestId);
    const job = await executeCommand(
      principal,
      { entityIds: scope, requestId: meta.requestId },
      commitImportJobCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    if (job.state !== 'committing') return job;
    try {
      await scheduleImportCommit(
        {
          jobId: job.id,
          entityId: job.entityId,
          userId: principal.id,
          ...(scope.length > 1 ? { entityIds: scope } : {}),
        },
        job.committedRows,
      );
    } catch (error) {
      logger.log('warn', 'imports.schedule_failed', { jobId: job.id, error });
      return job;
    }
    // Locally the first batches ran in this process, so the job may have moved on.
    return executeQuery(
      principal,
      { entityIds: [job.entityId], requestId: meta.requestId },
      (ctx) => getImportJobQuery(ctx, { entityId: job.entityId, jobId: job.id }),
      { name: 'commitImportJob.readBack' },
    );
  });
}

export async function rollbackImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('rollbackImportJob', async () => {
    const principal = await signedIn();
    const input = parseInput(RollbackImportJobInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: await jobScope(principal, input, meta.requestId), requestId: meta.requestId },
      rollbackImportJobCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function getImportJob(rawInput: unknown): Promise<ActionResult<ImportJobDto>> {
  return toResult('getImportJob', async () => {
    const principal = await signedIn();
    const input = parseInput(GetImportJobInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => getImportJobQuery(ctx, input),
      { name: 'getImportJob' },
    );
  });
}

/**
 * The import screen's list: one company's jobs, or those of every company being viewed when no
 * company is named, newest first, a page at a time.
 */
export async function listImportJobs(rawInput: unknown): Promise<ActionResult<ImportJobPage>> {
  return toResult('listImportJobs', async () => {
    const principal = await signedIn();
    const input = parseInput(ListImportJobsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (ctx) => listImportJobsQuery(ctx, input),
      { name: 'listImportJobs' },
    );
  });
}

export async function listImportRows(rawInput: unknown): Promise<ActionResult<ImportRowPage>> {
  return toResult('listImportRows', async () => {
    const principal = await signedIn();
    const input = parseInput(ListImportRowsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => listImportRowsQuery(ctx, input),
      { name: 'listImportRows' },
    );
  });
}

export async function listImportTemplates(
  rawInput: unknown,
): Promise<ActionResult<ImportTemplateDto[]>> {
  return toResult('listImportTemplates', async () => {
    const principal = await signedIn();
    const input = parseInput(ListImportTemplatesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => listImportTemplatesQuery(ctx, input),
      { name: 'listImportTemplates' },
    );
  });
}
