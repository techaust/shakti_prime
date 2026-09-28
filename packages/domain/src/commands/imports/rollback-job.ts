import {
  DomainError,
  IMPORT_LIMITS,
  ImportJobDto,
  RollbackImportJobInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import { rollbackChunks } from '../../imports/row-key';
import { assertEntityInScope, jobState, loadJob, toImportJobDto, updateJob } from './shared';

/**
 * `imports.job.rollback` (design §8): archives every lead the job created, newest row first in
 * batches of 500, and marks those rows rolled back. Customers the rows created stay in the
 * shared customer master (ADR 0008), where another company or a later lead may already use them.
 * A lead the caller can no longer change stops the whole rollback, so nothing is half undone.
 */
export const rollbackImportJob = defineCommand({
  name: 'imports.job.rollback',
  permission: 'imports.write',
  minScope: 'entity',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  input: RollbackImportJobInput,
  output: ImportJobDto,
  auditFields: ['state', 'committedRows', 'rolledBackRows', 'archived', 'batches'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    assertImportJobMove(before, 'rolled_back');
    const job = loaded.job;
    const actor = ctx.principal.id;
    const r = schema.importRows;
    const o = schema.opportunities;

    const committed = await ctx.tx
      .select({ rowNo: r.rowNo, createdId: r.createdId })
      .from(r)
      .where(and(eq(r.jobId, job.id), eq(r.state, 'committed')));
    const leadOf = new Map(committed.map((row) => [row.rowNo, row.createdId]));

    const batches: { fromRow: number; toRow: number; rows: number }[] = [];
    let archived = 0;
    for (const chunk of rollbackChunks(
      committed.map((row) => row.rowNo),
      IMPORT_LIMITS.batchSize,
    )) {
      const ids = chunk.flatMap((rowNo) => {
        const id = leadOf.get(rowNo);
        return id === null || id === undefined ? [] : [id];
      });
      const visible = await ctx.tx
        .select({ id: o.id })
        .from(o)
        .where(inArray(o.id, ids))
        .for('update');
      if (visible.length !== ids.length) {
        throw new DomainError('forbidden', 'a lead of this import is out of reach', {
          reason: 'import_rollback_blocked',
        });
      }
      const changed = await ctx.tx
        .update(o)
        .set({ archivedAt: ctx.now, updatedBy: actor })
        .where(and(inArray(o.id, ids), isNull(o.archivedAt)))
        .returning({ id: o.id });
      archived += changed.length;
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
      after: { state: 'rolled_back', rolledBackRows: committed.length, archived, batches },
    });
    ctx.emit({
      type: 'imports.job.rolled_back',
      entityId: job.entityId,
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: { kind: job.kind, rolledBackRows: committed.length },
    });
    return toImportJobDto(rolledBack);
  },
});
