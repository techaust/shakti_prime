import { DomainError, hasGrant, newId, SetTargetInput, TargetDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { teamIn } from '../../queries/crm/list-lead-assignees';
import { isPeriodStart } from '../../sales/targets';

/**
 * `sales.target.set` (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06): a team lead sets the
 * target of a caller of their team, or of their team; the GM those of their company; the Executive
 * any. A target is a number for one metric and one period (a day, a Monday-to-Sunday week or a
 * month in IST) and holds from the period that starts on `startsOn` until a newer one is set, so a
 * target set once keeps counting every later period. Setting it again adds a row (the earlier one
 * stays as the history) and a value of 0 takes the target away. Nothing is filled in for the
 * client: the table starts empty. People only.
 */
export const setTarget = defineCommand({
  name: 'sales.target.set',
  permission: 'sales.targets.write',
  minScope: 'team',
  peopleOnly: true,
  input: SetTargetInput,
  output: TargetDto,
  auditFields: ['targetScope', 'targetMetric', 'targetPeriod', 'startsOn', 'targetValue'],
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    if (!isPeriodStart(input.period, input.startsOn)) {
      throw new DomainError('validation_failed', 'the date is not the first day of the period', {
        reason: 'target_period_start',
      });
    }
    const wide = hasGrant(ctx.principal.permissions, 'sales.targets.write', 'entity');
    const ownTeam = teamIn(ctx, input.entityId);

    let teamId: string;
    let subjectName: string | null;
    if (input.scope === 'team') {
      const [team] = await ctx.tx
        .select({ id: schema.teams.id, name: schema.teams.name, entityId: schema.teams.entityId })
        .from(schema.teams)
        .where(and(eq(schema.teams.id, input.subjectId), isNull(schema.teams.archivedAt)))
        .limit(1);
      if (!team || (team.entityId !== null && team.entityId !== input.entityId)) {
        throw new DomainError('not_found', `team ${input.subjectId} is not visible`, {
          reason: 'target_subject_missing',
        });
      }
      teamId = team.id;
      subjectName = team.name;
    } else {
      const uer = schema.userEntityRoles;
      const p = schema.principals;
      // Only an active person who logs calls is a caller a target can be set for.
      const rp = schema.rolePermissions;
      const [member] = await ctx.tx
        .select({ teamId: uer.teamId, name: p.displayName })
        .from(uer)
        .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
        .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'calls.log')))
        .where(
          and(
            eq(uer.userId, input.subjectId),
            eq(uer.entityId, input.entityId),
            sql`app.user_is_active(${p.id})`,
          ),
        )
        .limit(1);
      if (!member) {
        throw new DomainError('not_found', `person ${input.subjectId} is not visible`, {
          reason: 'target_subject_missing',
        });
      }
      if (member.teamId === null) {
        throw new DomainError('validation_failed', 'the person is in no team', {
          reason: 'target_caller_no_team',
        });
      }
      teamId = member.teamId;
      subjectName = member.name;
    }
    // A team lead holds the permission for their own team alone.
    if (!wide && teamId !== ownTeam) {
      throw new DomainError('forbidden', 'a team lead sets the targets of their own team', {
        reason: 'target_other_team',
      });
    }

    const id = newId();
    const [row] = await ctx.tx
      .insert(schema.targets)
      .values({
        id,
        entityId: input.entityId,
        scope: input.scope,
        subjectId: input.subjectId,
        teamId,
        metric: input.metric,
        period: input.period,
        startsOn: input.startsOn,
        value: input.value.toFixed(2),
        setBy: ctx.principal.id,
        setAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'target insert returned no row');
    ctx.audit({
      aggregateType: 'target',
      aggregateId: row.id,
      entityId: row.entityId,
      after: {
        targetScope: row.scope,
        targetMetric: row.metric,
        targetPeriod: row.period,
        startsOn: row.startsOn,
        targetValue: Number(row.value),
      },
    });
    return {
      id: row.id,
      entityId: row.entityId,
      scope: input.scope,
      subjectId: row.subjectId,
      subjectName,
      teamId: row.teamId,
      metric: input.metric,
      period: input.period,
      startsOn: row.startsOn,
      value: Number(row.value),
      setAt: row.setAt.toISOString(),
      setByName: null,
    };
  },
});
