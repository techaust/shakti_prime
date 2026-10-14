import { IMPORT_FILE_PURGE_LIMIT, ImportFileToDeleteDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, exists, gt, inArray, isNull, lt, ne, notInArray, or } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { assertEntityInScope } from '../../commands/imports/shared';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function guard(ctx: QueryContext, entityId: number): void {
  checkPermission(ctx.principal, 'imports.process', 'entity');
  assertEntityInScope(ctx.entityIds, entityId);
}

export interface FilesToDeleteOptions {
  /** The store the worker deletes from: a file kept in another store is not listed. */
  bucket: string;
  now?: Date;
  /**
   * Where the page starts: after this file (review L4). The list is in the order of the files' ids,
   * which are UUIDv7 and so follow their upload, exactly, with no time's rounding between pages.
   */
  after?: string | undefined;
}

/**
 * The import files of one company in one store whose bytes the import purge deletes (audit
 * SEC-1), oldest first by id, a page of at most `IMPORT_FILE_PURGE_LIMIT` after `after`: each still
 * kept, whose job has ended (all rows added, stopped or undone) or that was uploaded more than
 * `WORKSHOP_DEFAULTS.retention.importFileOpenDays` ago, whatever became of its job. A file the
 * store refused stays in the list, so the worker pages past it rather than starting again from
 * the head. The worker principal reads them under its own policies (`files.process`,
 * `imports.process`), on `files_import_kept_idx`; `imports.file.record_deleted` checks the same
 * rule again.
 */
export async function importFilesToDelete(
  ctx: QueryContext,
  entityId: number,
  options: FilesToDeleteOptions,
): Promise<ImportFileToDeleteDto[]> {
  guard(ctx, entityId);
  const f = schema.files;
  const j = schema.importJobs;
  const now = options.now ?? new Date();
  const before = new Date(
    now.getTime() - WORKSHOP_DEFAULTS.retention.importFileOpenDays * 24 * 60 * 60 * 1000,
  );
  const after = options.after;
  const rows = await ctx.tx
    .select({ id: f.id, bucket: f.bucket, key: f.key, createdAt: f.createdAt })
    .from(f)
    .where(
      and(
        eq(f.entityId, entityId),
        eq(f.purpose, 'import'),
        eq(f.bucket, options.bucket),
        isNull(f.deletedAt),
        after === undefined ? undefined : gt(f.id, after),
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
    .orderBy(asc(f.id))
    .limit(IMPORT_FILE_PURGE_LIMIT);
  return rows.map((row) =>
    ImportFileToDeleteDto.parse({ ...row, createdAt: row.createdAt.toISOString() }),
  );
}

/**
 * The next job of one company the one-off identity pass checks (`imports.job.mask_identity`): the
 * oldest not yet checked and not adding rows, leaving out those of `skip` (a job whose call failed
 * this run, or that another run holds), on `import_jobs_identity_unchecked_idx`; null when none.
 */
export async function nextImportJobToCheck(
  ctx: QueryContext,
  entityId: number,
  skip: readonly string[] = [],
): Promise<string | null> {
  guard(ctx, entityId);
  const j = schema.importJobs;
  const [row] = await ctx.tx
    .select({ id: j.id })
    .from(j)
    .where(
      and(
        eq(j.entityId, entityId),
        isNull(j.identityCheckedAt),
        ne(j.state, 'committing'),
        skip.length === 0 ? undefined : notInArray(j.id, [...skip]),
      ),
    )
    .orderBy(asc(j.createdAt), asc(j.id))
    .limit(1);
  return row?.id ?? null;
}
