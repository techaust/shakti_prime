'use server';

import {
  CommitImportJobInput,
  DomainError,
  GetImportJobInput,
  IMPORT_LIMITS,
  ListImportRowsInput,
  ListImportTemplatesInput,
  MapImportJobInput,
  newId,
  PreviewImportJobInput,
  RollbackImportJobInput,
  UploadImportFileInput,
  type ImportJobDto,
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
  listImportRows as listImportRowsQuery,
  listImportTemplates as listImportTemplatesQuery,
  mapImportJob as mapImportJobCommand,
  parseImportFile,
  previewImportJob as previewImportJobCommand,
  rollbackImportJob as rollbackImportJobCommand,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { currentPrincipal } from '../auth/current-principal';
import { fileStore } from '../files/store';
import { logger } from '../log';
import { scheduleImportCommit } from '../workers/imports';
import { commandOptions, parseInput, requestMeta } from './support';

/**
 * Thin wrappers for the import screens (docs/API.md §4, design §8): session → parse → request
 * context → command or query → DTO. They return the DTOs the other actions return; the result
 * envelope for forms arrives with the week 4 screens.
 */

async function caller(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  return principal;
}

const CONTENT_TYPES = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/**
 * The upload form (`entityId`, `kind`, `file`): the caller's right to import is checked first,
 * then the file is read and checked against the limits, its bytes are stored, and
 * `imports.job.create` records the file and its rows.
 */
export async function uploadImportFile(
  form: FormData,
  idempotencyKey?: unknown,
): Promise<ImportJobDto> {
  const principal = await caller();
  const input = parseInput(UploadImportFileInput, {
    entityId: form.get('entityId'),
    kind: form.get('kind') ?? 'leads',
  });
  // Nothing is read or stored for someone who may not import.
  checkPermission(principal, 'imports.write', 'entity');
  if (!principal.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the caller', { entityId: input.entityId });
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
  const store = fileStore();
  if (store === undefined) {
    throw new DomainError('integration_unavailable', 'no file store in this deployment');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseImportFile(bytes);
  const id = newId();
  const key = `imports/${String(input.entityId)}/${id}.${parsed.format}`;
  await store.put(key, bytes, CONTENT_TYPES[parsed.format]);

  const meta = await requestMeta();
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: meta.requestId },
    createImportJob,
    {
      entityId: input.entityId,
      kind: input.kind,
      file: {
        id,
        name: file.name.trim().slice(0, 200) || `import.${parsed.format}`,
        contentType: CONTENT_TYPES[parsed.format],
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bucket: store.bucket,
        key,
      },
      format: parsed.format,
      columns: parsed.columns,
      rows: parsed.rows,
    },
    commandOptions(meta, idempotencyKey),
  );
}

export async function mapImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ImportJobDto> {
  const principal = await caller();
  const input = parseInput(MapImportJobInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: meta.requestId },
    mapImportJobCommand,
    input,
    commandOptions(meta, idempotencyKey),
  );
}

export async function previewImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ImportJobDto> {
  const principal = await caller();
  const input = parseInput(PreviewImportJobInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: meta.requestId },
    previewImportJobCommand,
    input,
    commandOptions(meta, idempotencyKey),
  );
}

/**
 * Starts the commit and hands it to the import worker. If the worker cannot be reached the job
 * stays committing, and asking again starts the worker again without changing anything else.
 */
export async function commitImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ImportJobDto> {
  const principal = await caller();
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
    await scheduleImportCommit({ jobId: job.id, entityId: job.entityId, userId: principal.id });
  } catch (error) {
    logger.log('warn', 'imports.schedule_failed', { jobId: job.id, error });
    return job;
  }
  // Locally the worker ran in this process, so the job has moved on.
  return executeQuery(principal, { entityIds: [job.entityId] }, (ctx) =>
    getImportJobQuery(ctx, { entityId: job.entityId, jobId: job.id }),
  );
}

export async function rollbackImportJob(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ImportJobDto> {
  const principal = await caller();
  const input = parseInput(RollbackImportJobInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: meta.requestId },
    rollbackImportJobCommand,
    input,
    commandOptions(meta, idempotencyKey),
  );
}

export async function getImportJob(rawInput: unknown): Promise<ImportJobDto> {
  const principal = await caller();
  const input = parseInput(GetImportJobInput, rawInput);
  return executeQuery(principal, { entityIds: [input.entityId] }, (ctx) =>
    getImportJobQuery(ctx, input),
  );
}

export async function listImportRows(rawInput: unknown): Promise<ImportRowPage> {
  const principal = await caller();
  const input = parseInput(ListImportRowsInput, rawInput);
  return executeQuery(principal, { entityIds: [input.entityId] }, (ctx) =>
    listImportRowsQuery(ctx, input),
  );
}

export async function listImportTemplates(rawInput: unknown): Promise<ImportTemplateDto[]> {
  const principal = await caller();
  const input = parseInput(ListImportTemplatesInput, rawInput);
  return executeQuery(principal, { entityIds: [input.entityId] }, (ctx) =>
    listImportTemplatesQuery(ctx, input),
  );
}
