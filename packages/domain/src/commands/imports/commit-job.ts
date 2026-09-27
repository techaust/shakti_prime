import {
  CommitImportBatchInput,
  CommitImportJobInput,
  DomainError,
  ImportJobDto,
  type ImportKind,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import { importRowKey } from '../../imports/row-key';
import { createLead } from '../crm/create-lead';
import {
  assertEntityInScope,
  countRows,
  jobState,
  loadJob,
  toImportJobDto,
  updateJob,
} from './shared';

/** Committing creates leads and customers, so it needs those rights as well (AUDIT L9). */
const LEAD_WRITE = [
  { permission: 'crm.lead.write', minScope: 'own' },
  { permission: 'crm.account.write', minScope: 'own' },
] as const;

/**
 * `imports.job.commit` (IMP-01): a previewed job with valid rows starts committing. The rows go
 * in batch by batch through `imports.job.commit_batch`, run by the import worker; asking again
 * while the job commits changes nothing, so the screen can ask the worker to carry on.
 */
export const commitImportJob = defineCommand({
  name: 'imports.job.commit',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: LEAD_WRITE,
  input: CommitImportJobInput,
  output: ImportJobDto,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    if (before === 'committing') return toImportJobDto(loaded);
    assertImportJobMove(before, 'committing');
    if (loaded.job.validRows === 0) {
      throw new DomainError('validation_failed', 'no valid rows to import', {
        reason: 'import_nothing_to_commit',
      });
    }
    const committing = await updateJob(ctx.tx, loaded, {
      state: 'committing',
      updatedBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: loaded.job.id,
      entityId: input.entityId,
      before: { state: before },
      after: { state: 'committing', validRows: loaded.job.validRows },
    });
    return toImportJobDto(committing);
  },
});

/**
 * `imports.job.commit_batch` (design §8): the next valid rows of a committing job, in file
 * order, each through `crm.lead.create` with the idempotency key `import:{job}:{row}`, inside
 * one savepoint. A row that fails rolls the whole batch back, and the job stops there as
 * `failed` with the batch and the row recorded; the rows committed by earlier batches stay until
 * the job is rolled back. When no valid row is left the job is `committed`. One audit row per
 * batch records the row range; each lead also has its own row from `crm.lead.create`.
 */
export const commitImportBatch = defineCommand({
  name: 'imports.job.commit_batch',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: LEAD_WRITE,
  input: CommitImportBatchInput,
  output: ImportJobDto,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    if (jobState(loaded.job) !== 'committing') return toImportJobDto(loaded);
    const job = loaded.job;
    const kind = job.kind as ImportKind;
    const actor = ctx.principal.id;
    const r = schema.importRows;

    const [last] = await ctx.tx
      .select({ n: sql<number>`coalesce(max(${r.committedBatch}), 0)::int` })
      .from(r)
      .where(eq(r.jobId, job.id));
    const batchNo = (last?.n ?? 0) + 1;

    const rows = await ctx.tx
      .select({ rowNo: r.rowNo, input: r.normalisedJson })
      .from(r)
      .where(and(eq(r.jobId, job.id), eq(r.state, 'valid')))
      .orderBy(asc(r.rowNo))
      .limit(input.batchSize);

    if (rows.length === 0) {
      const committed = await updateJob(ctx.tx, loaded, { state: 'committed', updatedBy: actor });
      ctx.audit({
        aggregateType: 'import_job',
        aggregateId: job.id,
        entityId: job.entityId,
        before: { state: 'committing' },
        after: { state: 'committed', committedRows: job.committedRows },
      });
      ctx.emit({
        type: 'imports.job.committed',
        entityId: job.entityId,
        aggregateType: 'import_job',
        aggregateId: job.id,
        payload: { kind, committedRows: job.committedRows, batches: Math.max(batchNo - 1, 1) },
      });
      return toImportJobDto(committed);
    }

    let failedRow: number | undefined;
    try {
      await ctx.tx.transaction(async (sp) => {
        const created: { rowNo: number; id: string }[] = [];
        for (const row of rows) {
          failedRow = row.rowNo;
          const lead = await ctx.run(createLead, row.input, {
            tx: sp,
            idempotencyKey: importRowKey(job.id, row.rowNo),
          });
          created.push({ rowNo: row.rowNo, id: lead.id });
        }
        failedRow = undefined;
        await sp.execute(sql`
          update import_rows r
             set state = 'committed', created_type = 'opportunity', created_id = x.id,
                 committed_batch = ${batchNo}, updated_by = ${actor}
            from jsonb_to_recordset(${JSON.stringify(created)}::jsonb) as x("rowNo" int, id uuid)
           where r.job_id = ${job.id} and r.row_no = x."rowNo"`);
      });
    } catch (error) {
      // The savepoint is gone and the batch with it; what is left is to record where it stopped.
      if (failedRow !== undefined) {
        await ctx.tx
          .update(r)
          .set({ errorsJson: [{ field: 'row', code: 'commit_failed' }], updatedBy: actor })
          .where(and(eq(r.jobId, job.id), eq(r.rowNo, failedRow)));
      }
      const failed = await updateJob(ctx.tx, loaded, {
        state: 'failed',
        failedBatch: batchNo,
        updatedBy: actor,
      });
      ctx.audit({
        aggregateType: 'import_job',
        aggregateId: job.id,
        entityId: job.entityId,
        before: { state: 'committing' },
        after: {
          state: 'failed',
          failedBatch: batchNo,
          failedRow: failedRow ?? null,
          errorCode: error instanceof DomainError ? error.code : 'internal',
          committedRows: job.committedRows,
        },
      });
      ctx.emit({
        type: 'imports.job.failed',
        entityId: job.entityId,
        aggregateType: 'import_job',
        aggregateId: job.id,
        payload: { kind, committedRows: job.committedRows, failedBatch: batchNo },
      });
      return toImportJobDto(failed);
    }

    const committedRows = job.committedRows + rows.length;
    const remaining = await countRows(ctx.tx, job.id, 'valid');
    const done = remaining === 0;
    const after = await updateJob(ctx.tx, loaded, {
      committedRows,
      ...(done ? { state: 'committed' as const } : {}),
      updatedBy: actor,
    });
    const first = rows[0]?.rowNo ?? 0;
    const lastRow = rows[rows.length - 1]?.rowNo ?? first;
    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: job.id,
      entityId: job.entityId,
      before: { state: 'committing', committedRows: job.committedRows },
      after: {
        state: done ? 'committed' : 'committing',
        batch: batchNo,
        fromRow: first,
        toRow: lastRow,
        rows: rows.length,
        committedRows,
      },
    });
    if (done) {
      ctx.emit({
        type: 'imports.job.committed',
        entityId: job.entityId,
        aggregateType: 'import_job',
        aggregateId: job.id,
        payload: { kind, committedRows, batches: batchNo },
      });
    }
    return toImportJobDto(after);
  },
});
