import { RECHECK_FILES_LIMIT, RecheckFilesDto, RecheckFilesInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, inArray, lt } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/** The statuses of a file whose checks have not finished. */
export const AWAITING_CHECKS = ['scanning', 'scanned', 'not_scanned'] as const;

/**
 * `files.file.recheck` (Executive, `admin.integrations.write` for every company): emits
 * `files.file.uploaded` again for each file still waiting for its checks that has not moved for
 * `olderThanMinutes`, oldest first, at most `RECHECK_FILES_LIMIT` a call. The checks start from
 * each file's recorded status, so a file already part way through carries on where it stopped.
 */
export const recheckFiles = defineCommand({
  name: 'files.file.recheck',
  permission: 'admin.integrations.write',
  minScope: 'all',
  input: RecheckFilesInput,
  output: RecheckFilesDto,
  auditFields: ['fileStatus'],
  async handler(ctx, input) {
    const f = schema.files;
    const before = new Date(ctx.now.getTime() - input.olderThanMinutes * 60_000);
    const rows = await ctx.tx
      .select({ id: f.id, entityId: f.entityId, purpose: f.purpose, status: f.status })
      .from(f)
      .where(and(inArray(f.status, [...AWAITING_CHECKS]), lt(f.updatedAt, before)))
      .orderBy(asc(f.updatedAt))
      .limit(RECHECK_FILES_LIMIT);
    for (const row of rows) {
      ctx.emit({
        type: 'files.file.uploaded',
        entityId: row.entityId,
        aggregateType: 'file',
        aggregateId: row.id,
        payload: { purpose: row.purpose },
      });
      ctx.audit({
        aggregateType: 'file',
        aggregateId: row.id,
        entityId: row.entityId,
        after: { fileStatus: row.status },
      });
    }
    return { requeued: rows.length };
  },
});
