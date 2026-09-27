import { AssignOpportunityInput, DomainError, OpportunityDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import {
  auditOpportunity,
  fire,
  lockOpportunity,
  opportunityRecord,
  requireEntity,
  toOpportunityDto,
  writeOpportunity,
} from './opportunity-shared';

const HOUR_MS = 3_600_000;

/**
 * `crm.opportunity.assign` (design §7.2): an open lead goes to a person whose role in the lead's
 * company works on leads (`crm.lead.write`), with that person's team there, and stays with them
 * for the pipeline's `lock_hours` (the workshop default when the pipeline has none). While the
 * lock runs only a holder of `crm.lead.assign` at team scope or wider may reassign it. The update
 * policy then asks the caller's own write scope to cover the new owner or team.
 */
export const assignOpportunity = defineCommand({
  name: 'crm.opportunity.assign',
  permission: 'crm.lead.assign',
  minScope: 'own',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  input: AssignOpportunityInput,
  output: OpportunityDto,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    fire(ctx, await opportunityRecord(ctx, row), 'assign');

    const uer = schema.userEntityRoles;
    const rp = schema.rolePermissions;
    const p = schema.principals;
    const [assignee] = await ctx.tx
      .select({ teamId: uer.teamId })
      .from(uer)
      .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
      .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'crm.lead.write')))
      .where(and(eq(uer.userId, input.ownerId), eq(uer.entityId, row.entityId)))
      .limit(1);
    if (!assignee) {
      throw new DomainError('validation_failed', 'the new owner does not work on leads here', {
        reason: 'assignee_not_eligible',
      });
    }

    const [pipeline] = await ctx.tx
      .select({ lockHours: schema.pipelines.lockHours })
      .from(schema.pipelines)
      .where(eq(schema.pipelines.id, row.pipelineId))
      .limit(1);
    const lockHours = pipeline?.lockHours ?? WORKSHOP_DEFAULTS.opportunity.handoverLockHours;
    const lockedUntil = new Date(ctx.now.getTime() + lockHours * HOUR_MS);

    const updated = await writeOpportunity(ctx, row, {
      ownerId: input.ownerId,
      teamId: assignee.teamId,
      lockedUntil,
    });
    auditOpportunity(
      ctx,
      row,
      {
        ownerId: row.ownerId,
        teamId: row.teamId,
        lockedUntil: row.lockedUntil?.toISOString() ?? null,
      },
      { ownerId: input.ownerId, teamId: assignee.teamId, lockedUntil: lockedUntil.toISOString() },
    );
    ctx.emit({
      type: 'crm.opportunity.assigned',
      entityId: row.entityId,
      aggregateType: 'opportunity',
      aggregateId: row.id,
      payload: { ownerId: input.ownerId, teamId: assignee.teamId, lockHours },
    });
    return toOpportunityDto(updated);
  },
});
