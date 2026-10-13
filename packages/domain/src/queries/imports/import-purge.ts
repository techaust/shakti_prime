import { IMPORT_FILE_PURGE_LIMIT, ImportFileToDeleteDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, exists, inArray, isNull, lt, or } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { assertEntityInScope } from '../../commands/imports/shared';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The import files of one company whose bytes the import purge deletes from the store (audit
 * SEC-1), oldest first, at most `IMPORT_FILE_PURGE_LIMIT`: each still kept, whose job has ended
 * (all rows added, stopped or undone) or that was uploaded more than
 * `WORKSHOP_DEFAULTS.retention.importFileOpenDays` ago, whatever became of its job. The worker
 * principal reads them under its own policies (`files.process`, `imports.process`), on
 * `files_import_kept_idx`; `imports.file.record_deleted` checks the same rule again.
 */
export async function importFilesToDelete(
  ctx: QueryContext,
  entityId: number,
  now: Date = new Date(),
): Promise<ImportFileToDeleteDto[]> {
  checkPermission(ctx.principal, 'imports.process', 'entity');
  assertEntityInScope(ctx.entityIds, entityId);
  const f = schema.files;
  const j = schema.importJobs;
  const before = new Date(
    now.getTime() - WORKSHOP_DEFAULTS.retention.importFileOpenDays * 24 * 60 * 60 * 1000,
  );
  const rows = await ctx.tx
    .select({ id: f.id, bucket: f.bucket, key: f.key })
    .from(f)
    .where(
      and(
        eq(f.entityId, entityId),
        eq(f.purpose, 'import'),
        isNull(f.deletedAt),
        or(
          lt(f.createdAt, before),
          exists(
            ctx.tx
              .select({ one: j.id })
              .from(j)
              .where(
                and(eq(j.fileId, f.id), inArray(j.state, ['committed', 'failed', 'rolled_back'])),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(f.createdAt), asc(f.id))
    .limit(IMPORT_FILE_PURGE_LIMIT);
  return rows.map((row) => ImportFileToDeleteDto.parse(row));
}
