import { FailImportJobInput, ImportJobDto, type ImportKind } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import { assertEntityInScope, jobState, loadJob, toImportJobDto, updateJob } from './shared';

/**
 * `imports.job.fail` (docs/design/phase1.md §6.3): the import worker's call for a committing job
 * still failed on the queue's last retry (`Upstash-Retried`), with a lock wait that kept running
 * out or a fault of its own. The job stops as `failed` at the batch it was on, so the screen shows
 * where it stopped and offers to undo it, instead of waiting for ever; the rows committed so far
 * stay until the job is rolled back. A job no longer committing is left as it is.
 */
export const failImportJob = defineCommand({
  name: 'imports.job.fail',
  permission: 'imports.write',
  minScope: 'entity',
  input: FailImportJobInput,
  output: ImportJobDto,
  auditFields: ['state', 'failedBatch', 'committedRows'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    if (before !== 'committing') return toImportJobDto(loaded);
    assertImportJobMove(before, 'failed');
    const job = loaded.job;
    const failedBatch = job.batchCount + 1;
    const failed = await updateJob(ctx.tx, loaded, {
      state: 'failed',
      failedBatch,
      batchCount: failedBatch,
      updatedBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: job.id,
      entityId: job.entityId,
      before: { state: before },
      after: { state: 'failed', failedBatch, committedRows: job.committedRows },
    });
    ctx.emit({
      type: 'imports.job.failed',
      entityId: job.entityId,
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: { kind: job.kind as ImportKind, committedRows: job.committedRows, failedBatch },
    });
    return toImportJobDto(failed);
  },
});
