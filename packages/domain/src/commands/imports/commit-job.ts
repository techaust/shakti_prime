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
import {
  IMPORT_BATCH_BUDGET_MS,
  importBatchSettings,
  SET_BASED_BATCH_BOUND_MS,
} from '../../imports/batch-settings';
import { commitLeadBatch, RowByRowNeeded } from '../../imports/commit-leads';
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

/** The command's refusal of a customer a colleague looks after in the company (AUDIT M25). */
function isHeldByColleague(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.code === 'conflict' &&
    error.details?.reason === 'customer_held_by_colleague'
  );
}

export { IMPORT_BATCH_BUDGET_MS, SET_BASED_BATCH_BOUND_MS };

/** Why a batch skipped the set-based path: a fixed phrase for the log. */
const TOO_LITTLE_TIME = 'too little time for the set-based path';

/** The shortest statement timeout a set-based try is given, however little budget is left. */
const SET_BASED_MIN_TIMEOUT_MS = 1_000;

/**
 * SQLSTATEs that mean another transaction kept the batch waiting (`lock_not_available`) or a
 * statement ran out of time (`query_canceled`): no fault of the job, so the batch is not failed
 * but the error goes to the worker, whose route answers a retryable 503.
 */
const RETRYABLE_STATES = new Set(['55P03', '57014']);

/** The SQLSTATE an error carries, bare or as the runner's domain error. */
function databaseState(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 5; depth += 1) {
    const state =
      e instanceof DomainError ? e.details?.sqlstate : (e as Error & { code?: unknown }).code;
    if (typeof state === 'string' && /^[0-9A-Z]{5}$/.test(state)) return state;
    e = e.cause;
  }
  return undefined;
}

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
 * batches stay until the job is rolled back. The batch keeps to the time budget of
 * `importBatchSettings`: with less left than a set-based try may need, it goes straight to the
 * row-by-row path, and when the budget runs out there, the rows done so far are the batch and
 * the rest wait for the next; each statement of a set-based try is cut off at the budget left
 * (`statement_timeout`), after which the batch goes row by row. No number lock: `crm.lead.create`
 * leaves it out for an import row (`inImportBatch`), so a batch waits on no lead form and no other
 * job's batch; batches of one job still take turns on the job row. A lock
 * wait that runs out (55P03) or a statement cut off (57014) anywhere else fails nothing: the
 * error goes to the worker to try the batch again. When no valid row is left the job is
 * `committed`. Each batch takes the next number from the job's count of batches, a batch whose
 * every row was refused included. One audit row per batch records the
 * job, the row range and the counts; the leads write no row of their own (design §8), and their
 * events are stored only when the batch commits.
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
    // The batch's time runs from here: a wait for the job's row, held by another batch, counts.
    const started = importBatchSettings.now();
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    if (jobState(loaded.job) !== 'committing') return toImportJobDto(loaded);
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
      // Why the batch goes row by row, when it does.
      let rowByRow: { level: 'info' | 'warn'; reason: string } | undefined;
      const timeLeft = importBatchSettings.budgetMs - (importBatchSettings.now() - started);
      if (timeLeft < SET_BASED_BATCH_BOUND_MS) {
        rowByRow = { level: 'info', reason: TOO_LITTLE_TIME };
      } else {
        try {
          // The whole batch in a few statements (docs/spikes/import-scale.md), none of them
          // allowed past the budget left; the savepoint's end puts the timeout back.
          await ctx.savepoint(async (sp) => {
            const left = importBatchSettings.budgetMs - (importBatchSettings.now() - started);
            const timeout = Math.max(SET_BASED_MIN_TIMEOUT_MS, Math.floor(left));
            const [prior] = (await sp.execute(
              sql`select current_setting('statement_timeout') as timeout`,
            )) as unknown as { timeout: string }[];
            await sp.execute(
              sql`select set_config('statement_timeout', ${`${String(timeout)}ms`}, true)`,
            );
            await markCommitted(sp, await commitLeadBatch(ctx, sp, job.id, rows));
            await sp.execute(
              sql`select set_config('statement_timeout', ${prior?.timeout ?? '0'}, true)`,
            );
          });
        } catch (setBasedError) {
          // Another transaction kept a statement waiting past the lock wait: the worker tries
          // the batch again. A statement cut off at the budget goes row by row like any other.
          if (databaseState(setBasedError) === '55P03') throw setBasedError;
          // Something in the batch is not a plain new lead, or a row was refused: the savepoint
          // took the batch back, and the rows run again one by one through `crm.lead.create`,
          // which stops at the row at fault exactly as it always has.
          rowByRow = {
            level: setBasedError instanceof RowByRowNeeded ? 'info' : 'warn',
            reason: setBasedReason(setBasedError),
          };
        }
      }
      if (rowByRow !== undefined) {
        importBatchSettings.logger.log(rowByRow.level, 'imports.batch_row_by_row', {
          requestId: ctx.requestId,
          jobId: job.id,
          batch: batchNo,
          rows: rows.length,
          reason: rowByRow.reason,
        });
        await ctx.savepoint(async (sp) => {
          const created: { rowNo: number; id: string }[] = [];
          const heldRows: number[] = [];
          // A set-based try that used the budget up still leaves this path its first row.
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
                  inImportBatch: true,
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
      // The savepoint is gone and the batch with it. A lock wait that ran out or a statement cut
      // off is no fault of the job: nothing is recorded, and the worker tries the batch again.
      const state = databaseState(error);
      if (state !== undefined && RETRYABLE_STATES.has(state)) throw error;
      // What is left is to record where it stopped.
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
