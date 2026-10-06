import { DomainError, OpportunityDto, ReopenOpportunityInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { cancelCallTasks } from './call-tasks';
import {
  auditOpportunity,
  fire,
  recordLeadActivity,
  firstStage,
  lockOpportunity,
  opportunityRecord,
  requireEntity,
  toOpportunityDto,
  writeOpportunity,
} from './opportunity-shared';

/**
 * `crm.opportunity.reopen` (design §7.2): a nurtured lead, or one lost within the reopen window
 * (`WORKSHOP_DEFAULTS.opportunity.reopenWindowDays`), is open again at the first open stage of
 * its pipeline. The lead's open nurture calls are cancelled (`cancelCallTasks`): it is worked
 * from the queue again, from its first attempt.
 */
export const reopenOpportunity = defineCommand({
  name: 'crm.opportunity.reopen',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: ReopenOpportunityInput,
  output: OpportunityDto,
  auditFields: ['state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const record = await opportunityRecord(ctx, row);
    const { from, to } = fire(ctx, record, 'reopen');
    if (from !== 'nurture' && from !== 'lost') {
      throw new DomainError('internal', `reopen fired from ${String(from)}`);
    }
    const stage = await firstStage(ctx, row.pipelineId, 'open');
    if (!stage) {
      throw new DomainError('validation_failed', `pipeline ${row.pipelineId} has no open stage`, {
        reason: 'lead_pipeline_missing',
      });
    }
    await recordLeadActivity(ctx, row, 'reopened', { fromState: from, stageId: stage.id });
    const updated = await writeOpportunity(ctx, row, {
      state: to,
      stateChangedAt: ctx.now,
      stageId: stage.id,
    });
    await cancelCallTasks(ctx, row, ['nurture']);
    auditOpportunity(
      ctx,
      row,
      { state: row.state, stageId: row.stageId },
      { state: to, stageId: stage.id },
    );
    ctx.emit({
      type: 'crm.opportunity.reopened',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { fromState: from, stageId: stage.id },
    });
    return toOpportunityDto(updated);
  },
});
