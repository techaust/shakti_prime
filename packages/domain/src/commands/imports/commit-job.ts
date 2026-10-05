import {
  CommitImportBatchInput,
  CommitImportJobInput,
  DomainError,
  ImportJobDto,
  type ImplementedImportKind,
  type ImportCreatedType,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand, type Requirement } from '../../command/define-command';
import {
  IMPORT_BATCH_BUDGET_MS,
  importBatchSettings,
  ROW_BY_ROW_SLICE_MS,
  SET_BASED_MIN_MS,
} from '../../imports/batch-settings';
import { commitAccountBatch } from '../../imports/commit-accounts';
import { commitLeadBatch, RowByRowNeeded, type BatchRow } from '../../imports/commit-leads';
import { commitPinCodeBatch } from '../../imports/commit-pin-codes';
import { assertImportJobMove } from '../../imports/job-state';
import { importRowKey } from '../../imports/row-key';
import { createLead } from '../crm/create-lead';
import {
  assertContentNotImported,
  assertEntityInScope,
  assertGroupImport,
  assertJobCompaniesCovered,
  countRows,
  implementedKind,
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

export { IMPORT_BATCH_BUDGET_MS, ROW_BY_ROW_SLICE_MS, SET_BASED_MIN_MS };

/** Why a batch skipped the set-based path: a fixed phrase for the log. */
const TOO_LITTLE_TIME = 'too little time for the set-based path';

/** The set-based try reached its deadline between statements. */
class DeadlinePassed extends Error {
  constructor() {
    super('the set-based try reached its deadline');
    this.name = 'DeadlinePassed';
  }
}

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
 * Why the set-based path gave the batch up, for the log: the fixed phrase of `RowByRowNeeded`, the
 * deadline, or the code of a refusal or a database error. Never an error message, which may carry
 * a value from the file.
 */
function setBasedReason(error: unknown): string {
  if (error instanceof RowByRowNeeded) return error.why;
  if (error instanceof DeadlinePassed) return 'the set-based deadline passed';
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
] as const satisfies readonly Requirement[];

/**
 * `imports.job.commit` (IMP-01): a previewed job with valid rows starts committing, unless a job of
 * another upload with the same content is adding its rows or has added them in the company
 * (`import_file_duplicate`, asked under the company's lock on that content, so two such jobs never
 * both commit). The rows go
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
    assertJobCompaniesCovered(ctx.entityIds, loaded.job);
    if (implementedKind(loaded.job) === 'pin_codes') await assertGroupImport(ctx);
    // Another job of the same content may have been started beside this one, and committed since.
    const [content] = await ctx.tx
      .select({ id: schema.files.id, sha256: schema.files.sha256 })
      .from(schema.files)
      .where(eq(schema.files.id, loaded.job.fileId))
      .limit(1);
    if (!content) throw new DomainError('internal', 'an import job without its file');
    await assertContentNotImported(ctx.tx, input.entityId, content, true);
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
 * `imports.job.commit_batch` (design §8 and phase1 §6.3): the next valid rows of a committing
 * job, in file order, inside one savepoint: first set-based for the whole batch (leads as
 * `crm.lead.create` makes them, each with the idempotency key `import:{job}:{row}`; customers with
 * a relationship per company; offices of the PIN code master), then row by row when the batch
 * holds anything the set-based path does not handle or a row is refused, so the row at fault is
 * the one recorded. A row refused because a colleague looks after that customer in the company
 * (`customer_held_by_colleague`) is marked invalid with that reason, and the rest of the batch
 * goes on. Any other row that fails rolls the whole batch back, and the job stops there as
 * `failed` with the batch and the row recorded; the rows committed by earlier batches stay until
 * the job is rolled back.
 *
 * The batch keeps to the time of `importBatchSettings`: the set-based try has one deadline across
 * all its statements, each cut off at the time left until it (`statement_timeout`), and is not
 * made with less than `SET_BASED_MIN_MS` left; a row-by-row slice then runs for
 * `ROW_BY_ROW_SLICE_MS` at most, the rows done so far are the batch, and the rest wait for the
 * next. No number lock: `crm.lead.create` leaves it out for an import row (`inImportBatch`), so a
 * batch waits on no lead form and no other job's batch; batches of one job still take turns on
 * the job row. A lock wait that runs out (55P03) or a statement cut off (57014) outside the
 * set-based try fails nothing: the error goes to the worker to try the batch again, and the job
 * fails only after the queue's last retry (`imports.job.fail`). When no valid row is left the job
 * is `committed`. Each batch takes the next number from the job's count of batches, a batch whose
 * every row was refused included. One audit row per batch records the job, the row range and the
 * counts; the leads write no row of their own (design §8), and their events are stored only when
 * the batch commits.
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
    const settings = importBatchSettings;
    const started = settings.now();
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    if (jobState(loaded.job) !== 'committing') return toImportJobDto(loaded);
    const job = loaded.job;
    // The worker acts for the companies the preview found; a person who has lost one stops here.
    assertJobCompaniesCovered(ctx.entityIds, job);
    const kind = implementedKind(job);
    if (kind === 'pin_codes') await assertGroupImport(ctx);
    const commit = KIND_COMMITS[kind];
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

    // Every row the batch went through is committed; a row that made a record names it, of the
    // kind's type unless the row says otherwise (a customers row linked to an existing customer).
    const markCommitted = (sp: RequestTx, done: readonly number[], created: readonly Made[]) => {
      const made = new Map(created.map((c) => [c.rowNo, c]));
      const marks = done.map((rowNo) => ({
        rowNo,
        id: made.get(rowNo)?.id ?? null,
        type: made.get(rowNo)?.type ?? commit.createdType,
      }));
      return sp.execute(sql`
        update import_rows r
           set state = 'committed',
               created_type = case when x.id is null then null else x.type end,
               created_id = x.id, committed_batch = ${batchNo}, updated_by = ${actor}
          from jsonb_to_recordset(${JSON.stringify(marks)}::jsonb)
               as x("rowNo" int, id uuid, type text)
         where r.job_id = ${job.id} and r.row_no = x."rowNo"`);
    };

    const refuseRows = (sp: RequestTx, rowNos: readonly number[]) =>
      sp
        .update(r)
        .set({
          state: 'invalid',
          errorsJson: [{ field: 'phone', code: 'customer_held_by_colleague' }],
          updatedBy: actor,
        })
        .where(and(eq(r.jobId, job.id), inArray(r.rowNo, [...rowNos])));

    let failedRow: number | undefined;
    // The rows refused for a customer a colleague looks after.
    let refused: number[] = [];
    // The rows this batch went through: all of them, unless the time ran out row by row.
    let done = rows;
    try {
      // Why the batch goes row by row, when it does.
      let rowByRow: { level: 'info' | 'warn'; reason: string } | undefined;
      // The set-based try ends here, leaving the row-by-row slice its time within the budget.
      const deadline = started + settings.budgetMs - settings.sliceMs;
      if (deadline - settings.now() < SET_BASED_MIN_MS) {
        rowByRow = { level: 'info', reason: TOO_LITTLE_TIME };
      } else {
        try {
          // The whole batch in a few statements (docs/spikes/import-scale.md), none of them
          // allowed past the deadline; the savepoint's end puts the timeout back.
          await ctx.savepoint(async (sp) => {
            const [prior] = (await sp.execute(
              sql`select current_setting('statement_timeout') as timeout`,
            )) as unknown as { timeout: string }[];
            const keep = async (tx: RequestTx) => {
              const left = Math.floor(deadline - settings.now());
              if (left <= 0) throw new DeadlinePassed();
              await tx.execute(
                sql`select set_config('statement_timeout', ${`${String(left)}ms`}, true)`,
              );
            };
            const result = await commit.setBased(ctx, sp, job.id, rows, keep);
            await sp.execute(
              sql`select set_config('statement_timeout', ${prior?.timeout ?? '0'}, true)`,
            );
            const refusedHere = new Set(result.refused);
            await markCommitted(
              sp,
              rows.flatMap((row) => (refusedHere.has(row.rowNo) ? [] : [row.rowNo])),
              result.created,
            );
            if (result.refused.length > 0) await refuseRows(sp, result.refused);
            refused = result.refused;
          });
        } catch (setBasedError) {
          // Another transaction kept a statement waiting past the lock wait: the worker tries
          // the batch again. A statement cut off at the deadline goes row by row like any other.
          if (databaseState(setBasedError) === '55P03') throw setBasedError;
          // Something in the batch is not plain, or a row was refused: the savepoint took the
          // batch back, and the rows run again one by one, which stops at the row at fault.
          refused = [];
          rowByRow = {
            level:
              setBasedError instanceof RowByRowNeeded || setBasedError instanceof DeadlinePassed
                ? 'info'
                : 'warn',
            reason: setBasedReason(setBasedError),
          };
        }
      }
      if (rowByRow !== undefined) {
        settings.logger.log(rowByRow.level, 'imports.batch_row_by_row', {
          requestId: ctx.requestId,
          jobId: job.id,
          batch: batchNo,
          rows: rows.length,
          reason: rowByRow.reason,
        });
        await ctx.savepoint(async (sp) => {
          const sliceStarted = settings.now();
          const created: Made[] = [];
          const went: number[] = [];
          const heldRows: number[] = [];
          // At least one row, even after a set-based try that used the time up.
          for (const [index, row] of rows.entries()) {
            const now = settings.now();
            if (
              index > 0 &&
              (now - sliceStarted >= settings.sliceMs || now - started >= settings.budgetMs)
            ) {
              // The slice is over: the rows so far are this batch, the rest wait for the next.
              done = rows.slice(0, index);
              break;
            }
            failedRow = row.rowNo;
            // Each row in a savepoint of its own, so a refused row leaves nothing behind.
            let outcome: { id: string | null; type?: ImportCreatedType } | 'refused';
            try {
              outcome = await sp.transaction((rowSp) => commit.oneRow(ctx, rowSp, job.id, row));
            } catch (error) {
              if (!isHeldByColleague(error)) throw error;
              outcome = 'refused';
            }
            if (outcome === 'refused') {
              heldRows.push(row.rowNo);
            } else {
              went.push(row.rowNo);
              if (outcome.id !== null) {
                created.push({ rowNo: row.rowNo, id: outcome.id, type: outcome.type });
              }
            }
          }
          failedRow = undefined;
          await markCommitted(sp, went, created);
          if (heldRows.length > 0) await refuseRows(sp, heldRows);
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

/*
 * What each kind's rows make, set-based and one row at a time. Kept below the batch command that
 * uses it, so the batch's source names the functions it calls (event-emitters.test.ts reads it).
 */

/** A record a committed row made, and its type when it is not the kind's own. */
interface Made {
  rowNo: number;
  id: string;
  type?: ImportCreatedType | undefined;
}

/** What one kind's rows make, and the record type a committed row names. */
interface KindCommit {
  createdType: ImportCreatedType;
  /** The whole batch in a few statements, each kept to the deadline by `keep`. */
  setBased(
    ctx: CommandContext,
    sp: RequestTx,
    jobId: string,
    rows: readonly BatchRow[],
    keep: (tx: RequestTx) => Promise<void>,
  ): Promise<{ created: Made[]; refused: number[] }>;
  /**
   * One row in its own savepoint: what it made (none for an office it corrected), or refused; a
   * lead refused for a colleague's customer throws that refusal instead.
   */
  oneRow(
    ctx: CommandContext,
    rowSp: RequestTx,
    jobId: string,
    row: BatchRow,
  ): Promise<{ id: string | null; type?: ImportCreatedType } | 'refused'>;
}

const KIND_COMMITS: Readonly<Record<ImplementedImportKind, KindCommit>> = {
  leads: {
    createdType: 'opportunity',
    async setBased(ctx, sp, jobId, rows, keep) {
      return { created: await commitLeadBatch(ctx, sp, jobId, rows, keep), refused: [] };
    },
    async oneRow(ctx, rowSp, jobId, row) {
      // A refusal for a colleague's customer throws, so the row's savepoint takes back its key.
      const lead = await ctx.run(createLead, row.input, {
        tx: rowSp,
        idempotencyKey: importRowKey(jobId, row.rowNo),
        auditedByCaller: true,
        inImportBatch: true,
      });
      return { id: lead.id };
    },
  },
  accounts: {
    createdType: 'account',
    setBased: (ctx, sp, _jobId, rows, keep) => commitAccountBatch(ctx, sp, rows, keep),
    async oneRow(ctx, rowSp, _jobId, row) {
      // A link that finds the customer taken by a colleague since throws that refusal.
      const done = await commitAccountBatch(ctx, rowSp, [row]);
      const made = done.created[0];
      return done.refused.length > 0
        ? 'refused'
        : made === undefined
          ? { id: null }
          : { id: made.id, type: made.type };
    },
  },
  pin_codes: {
    createdType: 'pin_code',
    async setBased(ctx, sp, _jobId, rows, keep) {
      return { ...(await commitPinCodeBatch(ctx, sp, rows, keep)), refused: [] };
    },
    async oneRow(ctx, rowSp, _jobId, row) {
      const done = await commitPinCodeBatch(ctx, rowSp, [row]);
      return { id: done.created[0]?.id ?? null };
    },
  },
};
