import { DomainError, FileDto, FileRejectReasonSchema, type FilePurpose } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import type { Requirement } from '../../command/define-command';
import { transition, type TransitionResult } from '../../state-machines/define-machine';
import {
  fileUploadMachine,
  type FileUploadEvent,
  type FileUploadParams,
  type FileUploadRecord,
  type FileUploadState,
} from '../../state-machines/machines/file-upload';

export type FileRow = typeof schema.files.$inferSelect;

/** Where the checks record their findings (`files.scan_result`): codes and counts only. */
export interface ScanResult {
  scanner?: 'guardduty' | 'none';
  verdict?: string;
  sanitising?: string;
  regionsMasked?: number;
  rejectReason?: string;
  scanStatus?: string;
  /**
   * The key of the upload's own bytes once the checks replaced or refused them: the worker deletes
   * what is still there on every delivery, so a deletion that failed is tried again.
   */
  originalKey?: string;
  /** How many pages of a vault PDF the worker has sent the next delivery on from (`files.file.continue_check`). */
  maskedPagesSent?: number;
}

export function scanResultOf(row: Pick<FileRow, 'scanResult'>): ScanResult {
  const value = row.scanResult;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

export function toFileDto(row: FileRow): FileDto {
  const reason = FileRejectReasonSchema.safeParse(scanResultOf(row).rejectReason);
  return FileDto.parse({
    id: row.id,
    entityId: row.entityId,
    purpose: row.purpose,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    rejectReason: row.status === 'rejected' && reason.success ? reason.data : null,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * The file as the caller may change it, held until the transaction ends so the worker and a second
 * delivery take turns. Row security decides: an uploader finds their own pending upload of a
 * purpose they may write, the worker any file of its companies.
 */
export async function lockFile(
  ctx: CommandContext,
  fileId: string,
  purpose?: FilePurpose,
): Promise<FileRow> {
  const f = schema.files;
  const [row] = await ctx.tx.select().from(f).where(eq(f.id, fileId)).limit(1).for('update');
  if (!row || (purpose !== undefined && row.purpose !== purpose)) {
    throw new DomainError('not_found', `file ${fileId} is not visible`, { reason: 'file_missing' });
  }
  return row;
}

/**
 * Fires an event of the upload machine as the caller. A status the machine does not have (a
 * WhatsApp file's `masked`) has no transition, so any event on it is refused as an illegal move.
 */
export function fireUpload(
  ctx: CommandContext,
  record: FileUploadRecord,
  event: FileUploadEvent,
  params: FileUploadParams = {},
  requirement?: Requirement | null,
): TransitionResult<FileUploadState, FileUploadEvent> {
  return transition(fileUploadMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
    ...(requirement ? { requirement } : {}),
  });
}

/** Records a checked state and answers the row as it now stands. */
export async function writeFile(
  ctx: CommandContext,
  row: FileRow,
  changes: Partial<
    Pick<FileRow, 'status' | 'scanResult' | 'key' | 'contentType' | 'size' | 'sha256'>
  >,
): Promise<FileRow> {
  const f = schema.files;
  const [updated] = await ctx.tx
    .update(f)
    .set({ ...changes, updatedBy: ctx.principal.id })
    .where(eq(f.id, row.id))
    .returning();
  if (!updated) throw new DomainError('internal', `file ${row.id} update returned no row`);
  return updated;
}
