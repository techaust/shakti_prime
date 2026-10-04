import { SWEEP_UPLOADS_LIMIT, SweepUploadsDto, SweepUploadsInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import type { FileUploadState } from '../../state-machines/machines/file-upload';
import { fireUpload } from './shared';

/**
 * `files.upload.sweep` (the worker principal, on a schedule; docs/design/phase1.md §6.3): every
 * upload still `pending` `olderThanMinutes` after it began never completed (its upload address
 * lasted 15 minutes), so it is refused as abandoned (`file_upload_abandoned`), oldest first, at
 * most `SWEEP_UPLOADS_LIMIT` a run. The record stays for the trail; the answer names each one's
 * key so the worker deletes whatever bytes landed there, which a later run would simply find gone.
 */
export const sweepUploads = defineCommand({
  name: 'files.upload.sweep',
  permission: 'files.process',
  minScope: 'all',
  input: SweepUploadsInput,
  output: SweepUploadsDto,
  auditFields: ['fileStatus', 'rejectReason'],
  async handler(ctx, input) {
    const f = schema.files;
    const before = new Date(ctx.now.getTime() - input.olderThanMinutes * 60_000);
    const rows = await ctx.tx
      .select()
      .from(f)
      .where(and(eq(f.status, 'pending'), lt(f.createdAt, before)))
      .orderBy(asc(f.createdAt))
      .limit(SWEEP_UPLOADS_LIMIT)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return { abandoned: 0, keys: [] };
    for (const row of rows) {
      fireUpload(ctx, { state: row.status as FileUploadState, storedMatches: null }, 'abandon');
    }
    // One statement for the run; a pending upload has no findings of the checks to keep.
    await ctx.tx
      .update(f)
      .set({
        status: 'rejected',
        scanResult: { rejectReason: 'file_upload_abandoned' },
        updatedBy: ctx.principal.id,
      })
      .where(inArray(f.id, rows.map((row) => row.id)));
    for (const row of rows) {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: row.id,
        entityId: row.entityId,
        before: { fileStatus: row.status },
        after: { fileStatus: 'rejected', rejectReason: 'file_upload_abandoned' },
      });
    }
    return { abandoned: rows.length, keys: rows.map((row) => row.key) };
  },
});
