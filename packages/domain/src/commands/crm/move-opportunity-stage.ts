import { DomainError, MoveOpportunityStageInput, OpportunityDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
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

/** The stage whose arrival hands the lead to a Lead Converter (TEL-02). */
const HANDOVER_STAGE = 'qualified';

/**
 * `crm.opportunity.stage.move` (design §7.2): an open lead moves to another open stage of its own
 * pipeline once the current stage's exit rules are met. Won and lost stages are reached through
 * `crm.opportunity.win` and `crm.opportunity.lose`. Arriving at `qualified` asks for the handover
 * in the event; the handover worker (weighted round-robin over Lead Converters) arrives with the
 * tele-calling module in Phase 1.
 */
export const moveOpportunityStage = defineCommand({
  name: 'crm.opportunity.stage.move',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: MoveOpportunityStageInput,
  output: OpportunityDto,
  auditFields: ['handover'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const record = await opportunityRecord(ctx, row);

    const ps = schema.pipelineStages;
    const [target] = await ctx.tx
      .select({ id: ps.id, pipelineId: ps.pipelineId, key: ps.key, kind: ps.kind })
      .from(ps)
      .where(and(eq(ps.id, input.stageId), isNull(ps.archivedAt)))
      .limit(1);
    const result = fire(ctx, record, 'stage.move', {
      targetStage: target ? { id: target.id, pipelineId: target.pipelineId } : null,
    });
    // The guard refuses a missing stage; this narrows the type.
    if (!target) throw new DomainError('internal', 'stage guard passed without a stage');
    if (target.kind !== 'open') {
      throw new DomainError('validation_failed', 'a closing stage is reached by win or lose', {
        reason: 'stage_not_open',
      });
    }

    const handover =
      target.key === HANDOVER_STAGE &&
      result.effects.some((effect) => effect.key === 'handover_if_qualified');
    await recordLeadActivity(ctx, row, 'stage_moved', {
      fromStageId: row.stageId,
      toStageId: target.id,
      toStageKey: target.key,
    });
    const updated = await writeOpportunity(ctx, row, { stageId: target.id });
    auditOpportunity(ctx, row, { stageId: row.stageId }, { stageId: target.id, handover });
    ctx.emit({
      type: 'crm.opportunity.stage_moved',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { fromStageId: row.stageId, toStageId: target.id, toStageKey: target.key, handover },
    });
    return toOpportunityDto(updated);
  },
});
