import {
  DomainError,
  RETIRE_RENDERED_LIMIT,
  RetireRenderedFilesDto,
  RetireRenderedFilesInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import type { FileUploadState } from '../../state-machines/machines/file-upload';
import { assertEntityInScope } from '../imports/shared';
import { fireUpload } from './shared';

/**
 * `files.document.retire` (the render worker, `files.process`; P4 review L10): once a company's new
 * proof page is recorded (`keepFileId`), its earlier ready proof pages are refused as replaced
 * (`file_replaced`), oldest first, at most `RETIRE_RENDERED_LIMIT` a call. Each page prints the
 * company's bank account in full, so an earlier one would keep a replaced account readable. The
 * records stay for the trail; the answer names each one's key so the worker deletes its bytes, and
 * a call that runs again finds nothing left to retire. The kept file must be the company's ready
 * file of that purpose, so a late delivery of an older proof never retires a newer one.
 */
export const retireRenderedFiles = defineCommand({
  name: 'files.document.retire',
  permission: 'files.process',
  minScope: 'entity',
  input: RetireRenderedFilesInput,
  output: RetireRenderedFilesDto,
  auditFields: ['fileStatus', 'rejectReason'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const f = schema.files;
    const [kept] = await ctx.tx
      .select({ id: f.id, entityId: f.entityId, purpose: f.purpose, status: f.status })
      .from(f)
      .where(eq(f.id, input.keepFileId))
      .limit(1);
    if (
      kept === undefined ||
      kept.entityId !== input.entityId ||
      kept.purpose !== input.purpose ||
      kept.status !== 'ready'
    ) {
      throw new DomainError(
        'not_found',
        `file ${input.keepFileId} is not a ready ${input.purpose}`,
      );
    }
    // A newer file of the purpose than the kept one means this call comes from a late delivery:
    // the newer file's own call retires the rest.
    const rows = await ctx.tx
      .select()
      .from(f)
      .where(
        and(
          eq(f.entityId, input.entityId),
          eq(f.purpose, input.purpose),
          eq(f.status, 'ready'),
          ne(f.id, input.keepFileId),
        ),
      )
      .orderBy(asc(f.createdAt), asc(f.id))
      .limit(RETIRE_RENDERED_LIMIT)
      .for('update', { skipLocked: true });
    const older = rows.filter((row) => row.id < input.keepFileId);
    if (older.length === 0) return { retired: 0, keys: [] };
    for (const row of older) {
      fireUpload(ctx, { state: row.status as FileUploadState, storedMatches: null }, 'retire');
    }
    await ctx.tx
      .update(f)
      .set({
        status: 'rejected',
        scanResult: { rejectReason: 'file_replaced' },
        updatedBy: ctx.principal.id,
      })
      .where(
        inArray(
          f.id,
          older.map((row) => row.id),
        ),
      );
    for (const row of older) {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: row.id,
        entityId: row.entityId,
        before: { fileStatus: row.status },
        after: { fileStatus: 'rejected', rejectReason: 'file_replaced' },
      });
    }
    return { retired: older.length, keys: older.map((row) => row.key) };
  },
});
