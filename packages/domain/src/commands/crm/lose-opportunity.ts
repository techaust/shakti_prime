import { DomainError, LoseOpportunityInput, OpportunityDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
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
 * `crm.opportunity.lose` (design §7.2): an open or nurtured lead is closed without a sale, with a
 * reason code, at the pipeline's lost stage when it has one. The reason is kept in the audit row
 * and the event, where reports count it.
 */
export const loseOpportunity = defineCommand({
  name: 'crm.opportunity.lose',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: LoseOpportunityInput,
  output: OpportunityDto,
  auditFields: ['state', 'lostReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const { from, to } = fire(ctx, await opportunityRecord(ctx, row), 'lose', {
      reason: input.reasonCode,
    });
    if (from !== 'open' && from !== 'nurture') {
      throw new DomainError('internal', `lose fired from ${String(from)}`);
    }
    const stage = await firstStage(ctx, row.pipelineId, 'lost');
    const stageId = stage?.id ?? row.stageId;
    await recordLeadActivity(ctx, row, 'lost', { reasonCode: input.reasonCode, stageId });
    const updated = await writeOpportunity(ctx, row, {
      state: to,
      stateChangedAt: ctx.now,
      stageId,
    });
    auditOpportunity(
      ctx,
      row,
      { state: row.state, stageId: row.stageId },
      { state: to, stageId, lostReason: input.reasonCode },
    );
    ctx.emit({
      type: 'crm.opportunity.lost',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { fromState: from, reasonCode: input.reasonCode },
    });
    return toOpportunityDto(updated);
  },
});
