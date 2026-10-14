import {
  IMPORT_PURGE_JOBS,
  ImportFilesDeletedDto,
  ImportRowsPurgeDto,
  PurgeImportRowsInput,
  RecordImportFilesDeletedInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { assertEntityInScope } from './shared';

const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * `imports.job.purge` (audit SEC-1, BLUEPRINT §7.9): clears what the rows of up to
 * `IMPORT_PURGE_JOBS` of one company's import jobs said (`raw_json`, `normalised_json`) once
 * `WORKSHOP_DEFAULTS.retention.importReconciliationDays` have passed since the job ended (all rows
 * added, stopped or undone) or was last touched before adding, oldest first, and marks each job
 * purged. Each row's state, what it made, why it was refused and its duplicate findings stay, so
 * the job's reconciliation still adds up. It runs as the worker principal (`imports.process`,
 * held by no person's role and no agent) through one definer, `app.purge_import_rows()`, which
 * records the call in `retention_runs`. One audit row per job records when; no event is sent,
 * since nothing waits on it.
 */
export const purgeImportRows = defineCommand({
  name: 'imports.job.purge',
  permission: 'imports.process',
  minScope: 'entity',
  input: PurgeImportRowsInput,
  output: ImportRowsPurgeDto,
  auditFields: ['purgedAt'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [answer] = (await ctx.tx.execute(
      sql`select app.purge_import_rows(${input.entityId}::smallint,
                                       ${WORKSHOP_DEFAULTS.retention.importReconciliationDays}::integer,
                                       ${IMPORT_PURGE_JOBS}::integer) as result`,
    )) as unknown as { result: { jobs: string[]; rows: number } }[];
    const result = answer?.result ?? { jobs: [], rows: 0 };
    const at = ctx.now.toISOString();
    for (const jobId of result.jobs) {
      ctx.audit({
        aggregateType: 'import_job',
        aggregateId: jobId,
        entityId: input.entityId,
        before: { purgedAt: null },
        after: { purgedAt: at },
      });
    }
    return ImportRowsPurgeDto.parse({
      entityId: input.entityId,
      jobs: result.jobs.length,
      rows: result.rows,
      more: result.jobs.length === IMPORT_PURGE_JOBS,
    });
  },
});

/**
 * `imports.file.record_deleted` (audit SEC-1): the import files of one company whose bytes the
 * import purge deleted from the file store, with every version the store kept, are marked deleted
 * (`files.deleted_at`); the row stays for the trail, and is never opened or read again. Only a
 * file whose job has ended, or that was uploaded more than
 * `WORKSHOP_DEFAULTS.retention.importFileOpenDays` ago, is marked; any other id is passed over.
 * It runs as the worker principal (`imports.process`) through one definer,
 * `app.record_import_files_deleted()`, which records the call in `retention_runs`. One audit row
 * per file records when.
 */
export const recordImportFilesDeleted = defineCommand({
  name: 'imports.file.record_deleted',
  permission: 'imports.process',
  minScope: 'entity',
  input: RecordImportFilesDeletedInput,
  output: ImportFilesDeletedDto,
  auditFields: ['deletedAt'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [answer] = (await ctx.tx.execute(
      sql`select app.record_import_files_deleted(${input.entityId}::smallint,
                                                 ${WORKSHOP_DEFAULTS.retention.importFileOpenDays}::integer,
                                                 ${uuidArray(input.fileIds)}::uuid[]) as done`,
    )) as unknown as { done: string[] | null }[];
    const done = answer?.done ?? [];
    const at = ctx.now.toISOString();
    for (const fileId of done) {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: fileId,
        entityId: input.entityId,
        before: { deletedAt: null },
        after: { deletedAt: at },
      });
    }
    return ImportFilesDeletedDto.parse({ entityId: input.entityId, deleted: done.length });
  },
});
