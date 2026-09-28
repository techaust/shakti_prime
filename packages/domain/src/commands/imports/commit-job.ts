import {
  CommitImportBatchInput,
  CommitImportJobInput,
  DomainError,
  ImportJobDto,
  type ImportKind,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { commitLeadBatch, RowByRowNeeded } from '../../imports/commit-leads';
import { assertImportJobMove } from '../../imports/job-state';
import { importRowKey } from '../../imports/row-key';
import { jsonLogger, type Logger } from '../../ports/logger';
import { createLead } from '../crm/create-lead';
import {
  assertEntityInScope,
  countRows,
  jobState,
  loadJob,
  toImportJobDto,
  updateJob,
} from './shared';

/** The command's refusal of a customer a colleague looks after in the company (AUDIT M25). */
function isHeldByColleague(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.code === 'conflict' &&
    error.details?.reason === 'customer_held_by_colleague'
  );
}

/**
 * How a batch keeps to the import worker's time. The row-by-row path runs `crm.lead.create` once
 * a row and can take far longer than the set-based one, so between rows it looks at the time
 * since the batch began; once `budgetMs` has passed it stops, keeps the rows done so far as this
 * batch and leaves the rest for the next one. At least one row is always done, so every batch
 * moves the job on. The worker stops taking batches after `IMPORT_RUN_BUDGET_MS`
 * (apps/web/src/workers/imports.ts); that and this together stay inside the route's 60 seconds.
 * `logger` records why a batch went row by row. Tests shorten the budget and read the log.
 */
export const importBatchSettings: { budgetMs: number; now: () => number; logger: Logger } = {
  budgetMs: 15_000,
  now: () => performance.now(),
  logger: jsonLogger(),
};

/**
 * Why the set-based path gave the batch up, for the log: the fixed phrase of `RowByRowNeeded`, or
 * the code of a refusal or a database error. Never an error message, which may carry a value
 * from the file.
 */
function setBasedReason(error: unknown): string {
  if (error instanceof RowByRowNeeded) return error.why;
  if (error instanceof DomainError) return error.code;
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 4; depth += 1) {
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `database_${code}`;
    e = e.cause;
  }
  return 'unknown';
}

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
  auditFields: ['state', 'validRows', 'committedRows'],
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
 * order, each made as `crm.lead.create` makes it, with the idempotency key `import:{job}:{row}`,
 * inside one savepoint: first set-based for the whole batch (`commitLeadBatch`), and row by row
 * through `crm.lead.create` when the batch holds anything else or a row is refused, so the row at
 * fault is the one recorded. A row the command refuses because a colleague looks after that
 * customer in the company (`customer_held_by_colleague`) is marked invalid with that reason, and
 * the rest of the batch goes on. Any other row that fails rolls the whole batch back, and the job
 * stops there as `failed` with the batch and the row recorded; the rows committed by earlier
 * batches stay until the job is rolled back. The row-by-row path keeps to the time budget of
 * `importBatchSettings`: when it runs out, the rows done so far are the batch and the rest wait
 * for the next. When no valid row is left the job is `committed`. Each batch takes the next
 * number from the job's count of batches, a batch whose every row was refused included. One audit
 * row per batch records the job, the row range and the counts; the leads write no row of their
 * own (design §8), and their events are stored only when the batch commits.
 */
export const commitImportBatch = defineCommand({
  name: 'imports.job.commit_batch',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: LEAD_WRITE,
  input: CommitImportBatchInput,
  output: ImportJobDto,
  auditFields: [
    'state',
    'batch',
    'fromRow',
    'toRow',
    'rows',
    'committedRows',
    'failedBatch',
    'failedRow',
    'errorCode',
    'refusedRows',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    if (jobState(loaded.job) !== 'committing') return toImportJobDto(loaded);
    const started = importBatchSettings.now();
    const job = loaded.job;
    const kind = job.kind as ImportKind;
    const actor = ctx.principal.id;
    const r = schema.importRows;
    const batchNo = job.batchCount + 1;

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
        payload: { kind, committedRows: job.committedRows, batches: Math.max(job.batchCount, 1) },
      });
      return toImportJobDto(committed);
    }

    const markCommitted = (sp: RequestTx, created: readonly { rowNo: number; id: string }[]) =>
      sp.execute(sql`
        update import_rows r
           set state = 'committed', created_type = 'opportunity', created_id = x.id,
               committed_batch = ${batchNo}, updated_by = ${actor}
          from jsonb_to_recordset(${JSON.stringify(created)}::jsonb) as x("rowNo" int, id uuid)
         where r.job_id = ${job.id} and r.row_no = x."rowNo"`);

    const refusedRow = (sp: RequestTx, rowNos: readonly number[]) =>
      sp
        .update(r)
        .set({
          state: 'invalid',
          errorsJson: [{ field: 'phone', code: 'customer_held_by_colleague' }],
          updatedBy: actor,
        })
        .where(and(eq(r.jobId, job.id), inArray(r.rowNo, [...rowNos])));

    let failedRow: number | undefined;
    // The rows the command refused for a customer a colleague looks after (row by row only).
    let refused: number[] = [];
    // The rows this batch went through: all of them, unless the time ran out row by row.
    let done = rows;
    try {
      try {
        // The whole batch in a few statements (docs/spikes/import-scale.md).
        await ctx.savepoint(async (sp) => {
          await markCommitted(sp, await commitLeadBatch(ctx, sp, job.id, rows));
        });
      } catch (setBasedError) {
        // Something in the batch is not a plain new lead, or a row was refused: the savepoint
        // took the batch back, and the rows run again one by one through `crm.lead.create`,
        // which stops at the row at fault exactly as it always has.
        importBatchSettings.logger.log(
          setBasedError instanceof RowByRowNeeded ? 'info' : 'warn',
          'imports.batch_row_by_row',
          {
            jobId: job.id,
            batch: batchNo,
            rows: rows.length,
            reason: setBasedReason(setBasedError),
          },
        );
        await ctx.savepoint(async (sp) => {
          const created: { rowNo: number; id: string }[] = [];
          const heldRows: number[] = [];
          for (const [index, row] of rows.entries()) {
            if (index > 0 && importBatchSettings.now() - started >= importBatchSettings.budgetMs) {
              // Out of time: the rows so far are this batch, the rest wait for the next one.
              done = rows.slice(0, index);
              break;
            }
            failedRow = row.rowNo;
            try {
              // Each row in a savepoint of its own, so a refused row leaves no claimed key.
              const lead = await sp.transaction((rowSp) =>
                ctx.run(createLead, row.input, {
                  tx: rowSp,
                  idempotencyKey: importRowKey(job.id, row.rowNo),
                  auditedByCaller: true,
                }),
              );
              created.push({ rowNo: row.rowNo, id: lead.id });
            } catch (error) {
              if (!isHeldByColleague(error)) throw error;
              heldRows.push(row.rowNo);
            }
          }
          failedRow = undefined;
          await markCommitted(sp, created);
          if (heldRows.length > 0) await refusedRow(sp, heldRows);
          refused = heldRows;
        });
      }
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
        batchCount: batchNo,
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

    const committedRows = job.committedRows + done.length - refused.length;
    const remaining = await countRows(ctx.tx, job.id, 'valid');
    const finished = remaining === 0;
    const after = await updateJob(ctx.tx, loaded, {
      committedRows,
      batchCount: batchNo,
      // A refused row is no longer valid: it is counted with the rows the preview found invalid.
      ...(refused.length > 0
        ? {
            validRows: job.validRows - refused.length,
            invalidRows: job.invalidRows + refused.length,
          }
        : {}),
      ...(finished ? { state: 'committed' as const } : {}),
      updatedBy: actor,
    });
    const first = done[0]?.rowNo ?? 0;
    const lastRow = done[done.length - 1]?.rowNo ?? first;
    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: job.id,
      entityId: job.entityId,
      before: { state: 'committing', committedRows: job.committedRows },
      after: {
        state: finished ? 'committed' : 'committing',
        batch: batchNo,
        fromRow: first,
        toRow: lastRow,
        rows: done.length,
        committedRows,
        ...(refused.length > 0 ? { refusedRows: refused.length } : {}),
      },
    });
    if (finished) {
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
