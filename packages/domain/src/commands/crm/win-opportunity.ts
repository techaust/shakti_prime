import { OpportunityDto, WinOpportunityInput } from '@shakti/contracts';
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
 * `crm.opportunity.win` (design §7.2, docs/03-roadmap-appendix/phase1.md §8.3): an open lead is won when an
 * accepted quote or a confirmed sales order references it (the machine's guard refuses it with
 * `win_needs_order` otherwise); `sales.order.confirm` wins the lead of the order it confirms. The
 * lead's open callbacks and nurture calls end, as they do when it is lost (`cancelCallTasks`).
 */
export const winOpportunity = defineCommand({
  name: 'crm.opportunity.win',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: WinOpportunityInput,
  output: OpportunityDto,
  auditFields: ['state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const { to } = fire(ctx, await opportunityRecord(ctx, row), 'win');
    const stage = await firstStage(ctx, row.pipelineId, 'won');
    const stageId = stage?.id ?? row.stageId;
    await recordLeadActivity(ctx, row, 'won', { stageId });
    const updated = await writeOpportunity(ctx, row, {
      state: to,
      stateChangedAt: ctx.now,
      stageId,
    });
    await cancelCallTasks(ctx, row, ['callback', 'nurture']);
    auditOpportunity(ctx, row, { state: row.state, stageId: row.stageId }, { state: to, stageId });
    ctx.emit({
      type: 'crm.opportunity.won',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { stageId },
    });
    return toOpportunityDto(updated);
  },
});
