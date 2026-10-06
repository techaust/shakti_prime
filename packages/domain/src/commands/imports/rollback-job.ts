import {
  DomainError,
  IMPORT_LIMITS,
  ImportJobDto,
  RollbackImportJobInput,
  type ImplementedImportKind,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import { rollbackChunks } from '../../imports/row-key';
import { recheckSitePins } from '../../imports/commit-pin-codes';
import {
  assertEntityInScope,
  assertGroupImport,
  assertJobCompaniesCovered,
  implementedKind,
  jobState,
  loadJob,
  toImportJobDto,
  updateJob,
} from './shared';

/** A record of the job the caller can no longer change stops the whole rollback. */
function blocked(): DomainError {
  return new DomainError('forbidden', 'a record of this import is out of reach', {
    reason: 'import_rollback_blocked',
  });
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The customers of one chunk that are now in use in any company, which the rollback keeps
 * (`app.import_accounts_in_use`, which sees past the caller's companies). The helper first locks
 * the chunk's customers and their contacts until the transaction ends, so none is taken on, given
 * a lead or a consent between its answer and the archiving.
 */
async function accountsInUse(
  tx: RequestTx,
  jobId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return NONE;
  const rows = (await tx.execute(
    sql`select app.import_accounts_in_use(${jobId},
          array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)) as id`,
  )) as unknown as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

/**
 * Undoes one chunk of records, answering how many it archived or removed: leads are archived;
 * customers are archived unless one is in use (`inUse`); the offices the job added to the PIN code
 * master are removed, and the sites with their PINs are checked again.
 */
async function undo(
  ctx: CommandContext,
  tx: RequestTx,
  kind: ImplementedImportKind,
  ids: readonly string[],
  inUse: ReadonlySet<string>,
): Promise<number> {
  if (ids.length === 0) return 0;
  const actor = ctx.principal.id;
  if (kind === 'leads') {
    const o = schema.opportunities;
    const visible = await tx
      .select({ id: o.id })
      .from(o)
      .where(inArray(o.id, [...ids]))
      .for('update');
    if (visible.length !== ids.length) throw blocked();
    const changed = await tx
      .update(o)
      .set({ archivedAt: ctx.now, updatedBy: actor })
      .where(and(inArray(o.id, [...ids]), isNull(o.archivedAt)))
      .returning({ id: o.id });
    return changed.length;
  }
  if (kind === 'accounts') {
    const a = schema.accounts;
    const free = ids.filter((id) => !inUse.has(id));
    if (free.length === 0) return 0;
    const visible = await tx.select({ id: a.id }).from(a).where(inArray(a.id, free)).for('update');
    if (visible.length !== free.length) throw blocked();
    const changed = await tx
      .update(a)
      .set({ archivedAt: ctx.now, updatedBy: actor })
      .where(and(inArray(a.id, free), isNull(a.archivedAt)))
      .returning({ id: a.id });
    return changed.length;
  }
  const p = schema.pinCodes;
  const removed = await tx
    .delete(p)
    .where(inArray(p.id, [...ids]))
    .returning({ id: p.id, pin: p.pin });
  await recheckSitePins(
    tx,
    removed.map((office) => office.pin),
  );
  return removed.length;
}

/**
 * `imports.job.rollback` (design §8): undoes what the job made, newest row first in batches of
 * 500, and marks those rows rolled back. Leads are archived, and the customers they made stay in
 * the shared customer master (ADR 0008), where another company or a later lead may already use
 * them. A customers file's new customers are archived, except one now in use in any company (a
 * live lead, a consent, a company that took the customer on since, or an activity or a lead's tag
 * someone other than the importer added: `app.import_accounts_in_use`, asked chunk by chunk under
 * a lock on the chunk's customers, and seeing past the caller's companies); a customer a row was
 * linked to keeps the companies the row added. The request must act for every company the rows name. The offices a PIN code file
 * added are removed and the sites with their PINs checked again; an office it corrected keeps the
 * correction. A record the caller can no longer change stops the whole rollback, so nothing is
 * half undone.
 */
export const rollbackImportJob = defineCommand({
  name: 'imports.job.rollback',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  input: RollbackImportJobInput,
  output: ImportJobDto,
  auditFields: ['state', 'committedRows', 'rolledBackRows', 'archived', 'kept', 'batches'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    assertImportJobMove(before, 'rolled_back');
    const job = loaded.job;
    const kind = implementedKind(job);
    if (kind === 'pin_codes') await assertGroupImport(ctx);
    assertJobCompaniesCovered(ctx.entityIds, job);
    const actor = ctx.principal.id;
    const r = schema.importRows;

    const committed = await ctx.tx
      .select({ rowNo: r.rowNo, createdId: r.createdId, createdType: r.createdType })
      .from(r)
      .where(and(eq(r.jobId, job.id), eq(r.state, 'committed')));
    // A row linked to an existing customer made nothing to undo.
    const recordOf = new Map(
      committed.map((row) => [
        row.rowNo,
        row.createdType === 'account_link' ? null : row.createdId,
      ]),
    );
    const batches: { fromRow: number; toRow: number; rows: number }[] = [];
    let archived = 0;
    let kept = 0;
    for (const chunk of rollbackChunks(
      committed.map((row) => row.rowNo),
      IMPORT_LIMITS.batchSize,
    )) {
      const ids = [
        ...new Set(
          chunk.flatMap((rowNo) => {
            const id = recordOf.get(rowNo);
            return id === null || id === undefined ? [] : [id];
          }),
        ),
      ];
      const inUse = kind === 'accounts' ? await accountsInUse(ctx.tx, job.id, ids) : NONE;
      kept += inUse.size;
      archived += await undo(ctx, ctx.tx, kind, ids, inUse);
      await ctx.tx
        .update(r)
        .set({ state: 'rolled_back', updatedBy: actor })
        .where(and(eq(r.jobId, job.id), inArray(r.rowNo, chunk)));
      batches.push({
        fromRow: chunk[0] ?? 0,
        toRow: chunk[chunk.length - 1] ?? 0,
        rows: chunk.length,
      });
    }

    const rolledBack = await updateJob(ctx.tx, loaded, { state: 'rolled_back', updatedBy: actor });
    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: job.id,
      entityId: job.entityId,
      before: { state: before, committedRows: job.committedRows },
      after: {
        state: 'rolled_back',
        rolledBackRows: committed.length,
        archived,
        kept,
        batches,
      },
    });
    ctx.emit({
      type: 'imports.job.rolled_back',
      entityId: job.entityId,
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: { kind, rolledBackRows: committed.length },
    });
    return toImportJobDto(rolledBack);
  },
});
