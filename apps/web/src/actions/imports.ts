'use server';

import {
  CommitImportJobInput,
  DomainError,
  GetImportJobInput,
  IMPORT_LIMITS,
  ListImportJobsInput,
  ListImportRowsInput,
  ListImportTemplatesInput,
  MapImportJobInput,
  PreviewImportJobInput,
  RollbackImportJobInput,
  UploadImportFileInput,
  type ImportFormat,
  type ImportJobDto,
  type ImportJobPage,
  type ImportRowPage,
  type ImportTemplateDto,
} from '@shakti/contracts';
import {
  checkPermission,
  commitImportJob as commitImportJobCommand,
  createImportJob,
  executeCommand,
  executeQuery,
  getImportJob as getImportJobQuery,
  listImportJobs as listImportJobsQuery,
  listImportRows as listImportRowsQuery,
  listImportTemplates as listImportTemplatesQuery,
  mapImportJob as mapImportJobCommand,
  parseImportFile,
  previewImportJob as previewImportJobCommand,
  rollbackImportJob as rollbackImportJobCommand,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { fileStore } from '../files/store';
import { logger } from '../log';
import { scheduleImportCommit } from '../workers/imports';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Thin wrappers for the import screens (docs/API.md §4, docs/design/backend-weeks-3-5.md §8):
 * session → parse → request context → command or query → the result envelope.
 */

const CONTENT_TYPES: Record<ImportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * The upload form (`entityId`, `kind`, `file`): the caller's right to import is checked first,
 * then the file is read and checked against the limits, the bytes are stored under a key named by
 * their SHA-256, and only then does `imports.job.create` record the file and its rows. A job
 * therefore never names bytes the store does not hold: a failed save refuses the upload with
 * nothing recorded, and the person can try again. A command refused after the save leaves the
 * bytes in the store unreferenced, which is harmless: the key names the content, so the next upload
 * of the same file in that company reuses them. Until the S3 store arrives (Phase 1) a hosted
 * deployment has no store and refuses uploads.
 */
export async function uploadImportFile(
  form: FormData,
  idempotencyKey?: unknown,
): Promise<ActionResult<ImportJobDto>> {
  return toResult('uploadImportFile', async () => {
    const principal = await signedIn();
    const input = parseInput(UploadImportFileInput, {
      entityId: form.get('entityId'),
      kind: form.get('kind') ?? 'leads',
    });
    // Nothing is read or stored for someone who may not import.
    checkPermission(principal, 'imports.write', 'entity');
    if (!principal.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the caller', { entityId: input.entityId });
    }
    const store = fileStore();
    if (store === undefined) {
      throw new DomainError('integration_unavailable', 'no file store in this deployment', {
        reason: 'import_store_unavailable',
      });
    }
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new DomainError('validation_failed', 'no file', { reason: 'import_file_empty' });
    }
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      throw new DomainError('validation_failed', 'file too large', {
        reason: 'import_file_too_large',
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseImportFile(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `imports/${String(input.entityId)}/${sha256}.${parsed.format}`;
    const contentType = CONTENT_TYPES[parsed.format];
    try {
      await store.put(key, bytes, contentType);
    } catch (error) {
      throw new DomainError(
        'integration_unavailable',
        'the file store did not keep the file',
        { reason: 'import_store_failed', entityId: input.entityId },
        { cause: error },
      );
    }
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      createImportJob,
      {
        entityId: input.entityId,
        kind: input.kind,
        file: {
          name: file.name.trim().slice(0, 200) || `import.${parsed.format}`,
          contentType,
          size: bytes.length,
          sha256,
          bucket: store.bucket,
          key,
        },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
    const job = await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      commitImportJobCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    if (job.state !== 'committing') return job;
    try {
      await scheduleImportCommit(
        { jobId: job.id, entityId: job.entityId, userId: principal.id },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
    return executeQuery(principal, { entityIds: [input.entityId], requestId }, (ctx) =>
      getImportJobQuery(ctx, input),
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
    );
  });
}

export async function listImportRows(rawInput: unknown): Promise<ActionResult<ImportRowPage>> {
  return toResult('listImportRows', async () => {
    const principal = await signedIn();
    const input = parseInput(ListImportRowsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { entityIds: [input.entityId], requestId }, (ctx) =>
      listImportRowsQuery(ctx, input),
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
    return executeQuery(principal, { entityIds: [input.entityId], requestId }, (ctx) =>
      listImportTemplatesQuery(ctx, input),
    );
  });
}
