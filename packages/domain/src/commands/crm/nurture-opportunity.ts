import { NurtureOpportunityInput, OpportunityDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import {
  auditOpportunity,
  fire,
  lockOpportunity,
  opportunityRecord,
  requireEntity,
  toOpportunityDto,
  writeOpportunity,
} from './opportunity-shared';

/**
 * `crm.opportunity.nurture` (design §7.2): an open lead is parked with a reason code. The event
 * asks for the nurture cadence; its schedule is a workshop input (design §12 q2) and runs as a
 * Workflow once the cadence is agreed.
 */
export const nurtureOpportunity = defineCommand({
  name: 'crm.opportunity.nurture',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: NurtureOpportunityInput,
  output: OpportunityDto,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const { to } = fire(ctx, await opportunityRecord(ctx, row), 'nurture', {
      reason: input.reasonCode,
    });
    const updated = await writeOpportunity(ctx, row, { state: to, stateChangedAt: ctx.now });
    auditOpportunity(
      ctx,
      row,
      { state: row.state },
      { state: to, nurtureReason: input.reasonCode },
    );
    ctx.emit({
      type: 'crm.opportunity.nurtured',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { reasonCode: input.reasonCode },
    });
    return toOpportunityDto(updated);
  },
});
