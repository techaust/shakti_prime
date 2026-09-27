import { OpportunityDto, WinOpportunityInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import {
  auditOpportunity,
  fire,
  firstStage,
  lockOpportunity,
  opportunityRecord,
  requireEntity,
  toOpportunityDto,
  writeOpportunity,
} from './opportunity-shared';

/**
 * `crm.opportunity.win` (design §7.2): an open lead is won when an accepted quote or a confirmed
 * sales order references it. Quotes and orders arrive in Phase 1, so until then the machine's
 * guard refuses every win with `win_needs_order`; the write below is the path it will take.
 */
export const winOpportunity = defineCommand({
  name: 'crm.opportunity.win',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: WinOpportunityInput,
  output: OpportunityDto,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const { to } = fire(ctx, await opportunityRecord(ctx, row), 'win');
    const stage = await firstStage(ctx, row.pipelineId, 'won');
    const stageId = stage?.id ?? row.stageId;
    const updated = await writeOpportunity(ctx, row, {
      state: to,
      stateChangedAt: ctx.now,
      stageId,
    });
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
