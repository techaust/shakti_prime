import {
  DomainError,
  FileDto,
  KnowledgeSensitivitySchema,
  MarkFileReadyInput,
  MarkFileScannedInput,
  RejectFileInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import type { FileUploadState } from '../../state-machines/machines/file-upload';
import { assertEntityInScope } from '../imports/shared';
import { fireKnowledgeFileAsJob, holdVaultUpload } from '../knowledge/shared';
import { fireUpload, lockFile, scanResultOf, toFileDto, writeFile, type FileRow } from './shared';

/*
 * The checks before a file is usable (docs/ARCHITECTURE.md §9), run by the worker principal
 * (`files.process`, never a person's role) from `handleFileUploaded` in apps/web. Each records
 * codes and counts only.
 */

/** The file, which must belong to the company the worker names. */
async function lockInCompany(
  ctx: CommandContext,
  input: { entityId: number; fileId: string },
): Promise<FileRow> {
  assertEntityInScope(ctx.entityIds, input.entityId);
  const row = await lockFile(ctx, input.fileId);
  if (row.entityId !== input.entityId) {
    throw new DomainError('not_found', `file ${input.fileId} is not in the company`, {
      reason: 'file_missing',
    });
  }
  return row;
}

const record = (row: FileRow) => ({
  state: row.status as FileUploadState,
  storedMatches: null,
});

/**
 * The vault files waiting on a vault upload whose checks just ended (docs/design/phase1.md §8.4),
 * read through `app.knowledge_files_waiting_on()` (`knowledge.index`, which the worker principal
 * holds) after holding the upload, so a vault file added at the same moment is either seen here
 * or sees the upload's new status itself (`knowledge.file.add`).
 */
async function vaultFilesWaitingOn(
  ctx: CommandContext,
  row: FileRow,
): Promise<{ knowledge_file_id: string; entity_id: number | null; sensitivity: string }[]> {
  if (row.purpose !== 'knowledge') return [];
  await holdVaultUpload(ctx.tx, row.id);
  return (await ctx.tx.execute(
    sql`select knowledge_file_id, entity_id, sensitivity
          from app.knowledge_files_waiting_on(${row.id}::uuid)`,
  )) as unknown as { knowledge_file_id: string; entity_id: number | null; sensitivity: string }[];
}

/** `files.file.mark_scanned`: the malware scan found nothing, or no scanner exists here. */
export const markFileScanned = defineCommand({
  name: 'files.file.mark_scanned',
  permission: 'files.process',
  minScope: 'entity',
  input: MarkFileScannedInput,
  output: FileDto,
  auditFields: ['fileStatus', 'verdict'],
  async handler(ctx, input) {
    // Only a runtime that is not hosted may accept a file no scanner looked at.
    if (input.verdict === 'not_scanned' && ctx.hosted) {
      throw new DomainError('forbidden', 'a hosted runtime accepts only scanned files', {
        reason: 'file_not_scanned',
      });
    }
    const row = await lockInCompany(ctx, input);
    const event = input.verdict === 'no_threats_found' ? 'scan' : 'skip_scan';
    const { to } = fireUpload(ctx, record(row), event);
    const updated = await writeFile(ctx, row, {
      status: to,
      scanResult: {
        ...scanResultOf(row),
        scanner: input.verdict === 'no_threats_found' ? 'guardduty' : 'none',
        verdict: input.verdict,
      },
    });
    ctx.audit({
      aggregateType: 'file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { fileStatus: row.status },
      after: { fileStatus: to, verdict: input.verdict },
    });
    return toFileDto(updated);
  },
});

/** `files.file.mark_ready`: the checked copy (re-encoded, checked or masked) is the one kept. */
export const markFileReady = defineCommand({
  name: 'files.file.mark_ready',
  permission: 'files.process',
  minScope: 'entity',
  input: MarkFileReadyInput,
  output: FileDto,
  auditFields: ['fileStatus', 'sanitising', 'contentType', 'size', 'regionsMasked'],
  async handler(ctx, input) {
    const row = await lockInCompany(ctx, input);
    const { to } = fireUpload(ctx, record(row), 'ready');
    const updated = await writeFile(ctx, row, {
      status: to,
      key: input.stored.key,
      contentType: input.stored.contentType,
      size: input.stored.size,
      sha256: input.stored.sha256,
      scanResult: {
        ...scanResultOf(row),
        sanitising: input.sanitising,
        regionsMasked: input.regionsMasked,
        ...(input.stored.key === row.key ? {} : { originalKey: row.key }),
      },
    });
    // A vault upload's vault files are sent to be read now that the upload is usable.
    for (const vault of await vaultFilesWaitingOn(ctx, row)) {
      ctx.emit({
        type: 'knowledge.file.index_requested',
        entityId: row.entityId,
        aggregateType: 'knowledge_file',
        aggregateId: vault.knowledge_file_id,
        payload: {
          knowledgeEntityId: vault.entity_id,
          sensitivity: KnowledgeSensitivitySchema.parse(vault.sensitivity),
        },
      });
    }
    ctx.audit({
      aggregateType: 'file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { fileStatus: row.status, contentType: row.contentType, size: row.size },
      after: {
        fileStatus: to,
        sanitising: input.sanitising,
        contentType: input.stored.contentType,
        size: input.stored.size,
        regionsMasked: input.regionsMasked,
      },
    });
    return toFileDto(updated);
  },
});

/** `files.file.reject`: a check refused the file; the uploader sees why. */
export const rejectFile = defineCommand({
  name: 'files.file.reject',
  permission: 'files.process',
  minScope: 'entity',
  input: RejectFileInput,
  output: FileDto,
  auditFields: ['fileStatus', 'rejectReason', 'scanStatus', 'knowledgeState', 'errorReason'],
  async handler(ctx, input) {
    const row = await lockInCompany(ctx, input);
    const { to } = fireUpload(ctx, record(row), 'reject', { reason: input.reason });
    const scanStatus = input.scanStatus === undefined ? {} : { scanStatus: input.scanStatus };
    const updated = await writeFile(ctx, row, {
      status: to,
      scanResult: {
        ...scanResultOf(row),
        rejectReason: input.reason,
        ...scanStatus,
        originalKey: row.key,
      },
    });
    // A refused vault upload's vault files can never be read: they fail with that reason.
    for (const vault of await vaultFilesWaitingOn(ctx, row)) {
      const failed = fireKnowledgeFileAsJob(ctx, 'waiting', 'fail');
      await ctx.tx.execute(
        sql`select app.record_knowledge_index(${vault.knowledge_file_id}::uuid, ${failed},
                                              'knowledge_file_rejected', null)`,
      );
      ctx.audit({
        aggregateType: 'knowledge_file',
        aggregateId: vault.knowledge_file_id,
        entityId: vault.entity_id,
        before: { knowledgeState: 'waiting' },
        after: { knowledgeState: failed, errorReason: 'knowledge_file_rejected' },
      });
    }
    ctx.audit({
      aggregateType: 'file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { fileStatus: row.status },
      after: { fileStatus: to, rejectReason: input.reason, ...scanStatus },
    });
    return toFileDto(updated);
  },
});
