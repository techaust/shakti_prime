import { NurtureOpportunityInput, OpportunityDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { scheduleNurtureCalls } from './call-tasks';
import {
  auditOpportunity,
  fire,
  recordLeadActivity,
  lockOpportunity,
  opportunityRecord,
  requireEntity,
  toOpportunityDto,
  writeOpportunity,
} from './opportunity-shared';

/**
 * `crm.opportunity.nurture` (design §7.2): an open lead is parked with a reason code, and its
 * nurture calls are set as tasks for the lead's owner (`scheduleNurtureCalls`): day 7, 30 and 90,
 * the owner's default of 05-10-2026 for workshop CALL-5 (`WORKSHOP_DEFAULTS.calling`). Tasks, not
 * a workflow engine (owner decision of 29-09-2026), so they are visible and reassignable.
 */
export const nurtureOpportunity = defineCommand({
  name: 'crm.opportunity.nurture',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: NurtureOpportunityInput,
  output: OpportunityDto,
  auditFields: ['state', 'nurtureReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const { to } = fire(ctx, await opportunityRecord(ctx, row), 'nurture', {
      reason: input.reasonCode,
    });
    await recordLeadActivity(ctx, row, 'nurtured', { reasonCode: input.reasonCode });
    const updated = await writeOpportunity(ctx, row, { state: to, stateChangedAt: ctx.now });
    await scheduleNurtureCalls(ctx, row);
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
