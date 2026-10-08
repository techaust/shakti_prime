import { AssignOpportunityInput, DomainError, OpportunityDto } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { moveCallTasks } from './call-tasks';
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

const HOUR_MS = 3_600_000;

/**
 * `crm.opportunity.assign` (design §7.2): an open lead goes to a person whose role in the lead's
 * company works on leads (`crm.lead.write`), with that person's team there, and stays with them
 * for the pipeline's `lock_hours` (the workshop default when the pipeline has none). The person
 * must be active: an invited, suspended or offboarded person is refused (`app.user_is_active()`,
 * 0059, since the caller reads no other person's users row). While the lock runs only a holder of
 * `crm.lead.assign` at team scope or wider may reassign it. The update policy then asks the
 * caller's own write scope to cover the new owner or team.
 *
 * Whoever may read a lead may read its customer: when the previous owner of the lead looked after
 * the customer in that company, the relationship moves with the lead to the new owner and their
 * team (`app.hand_over_customer()`, 0055), with an audit row of its own. A relationship someone
 * else holds is left as it is, and so is every relationship when an agent hands the lead over
 * (0059): agents never write the customer master (SECURITY §3.3), and the new owner reads the
 * customer through the lead (0057).
 *
 * The lead's open callbacks and nurture calls move to the new owner (`moveCallTasks`), so the time
 * the customer asked for travels with the lead and the old owner keeps no call on it.
 */
export const assignOpportunity = defineCommand({
  name: 'crm.opportunity.assign',
  permission: 'crm.lead.assign',
  minScope: 'own',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  input: AssignOpportunityInput,
  output: OpportunityDto,
  auditFields: ['lockedUntil'],
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
      .where(
        and(
          eq(uer.userId, input.ownerId),
          eq(uer.entityId, row.entityId),
          sql`app.user_is_active(${uer.userId})`,
        ),
      )
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

    // Recorded first: once handed over, the lead may leave the caller's sight.
    await recordLeadActivity(ctx, row, 'assigned', {
      fromOwnerId: row.ownerId,
      ownerId: input.ownerId,
      teamId: assignee.teamId,
    });
    // Before the lead is handed over, while it is still in the caller's sight.
    await moveCallTasks(ctx, row, input.ownerId);
    const updated = await writeOpportunity(ctx, row, {
      ownerId: input.ownerId,
      teamId: assignee.teamId,
      lockedUntil,
    });
    const handover = await handOverCustomer(ctx.tx, row.id, row.ownerId);
    if (handover.status === 'moved' && handover.relationshipId !== null) {
      ctx.audit({
        aggregateType: 'account_entity',
        aggregateId: handover.relationshipId,
        entityId: row.entityId,
        before: { ownerId: row.ownerId, teamId: handover.previousTeamId },
        after: { ownerId: input.ownerId, teamId: assignee.teamId },
      });
    }
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
      payload: {
        ownerId: input.ownerId,
        teamId: assignee.teamId,
        lockHours,
        assignedById: ctx.principal.id,
      },
    });
    return toOpportunityDto(updated);
  },
});

/** What `app.hand_over_customer()` did with the customer's relationship in the lead's company. */
interface Handover {
  status: 'moved' | 'unchanged' | 'held_by_other' | 'missing';
  relationshipId: string | null;
  previousTeamId: string | null;
}

async function handOverCustomer(
  tx: RequestTx,
  opportunityId: string,
  previousOwnerId: string | null,
): Promise<Handover> {
  const rows = (await tx.execute(sql`
    select status, relationship_id as "relationshipId", previous_team_id as "previousTeamId"
      from app.hand_over_customer(${opportunityId}::uuid, ${previousOwnerId}::uuid)`)) as unknown as Handover[];
  return rows[0] ?? { status: 'missing', relationshipId: null, previousTeamId: null };
}
