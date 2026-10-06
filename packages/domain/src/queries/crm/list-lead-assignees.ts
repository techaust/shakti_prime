import { DomainError, hasGrant, LeadAssigneeDto, ListLeadAssigneesInput } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

type AssigneeContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** An upper bound on the people one company lists; the dialog is a choice, not a directory. */
const MAX_ASSIGNEES = 500;

/** The caller's team in the company: the one listed for it, or the narrowed request's team. */
export function teamIn(
  ctx: Pick<RequestContext, 'principal' | 'entityIds'>,
  entityId: number,
): string | undefined {
  return (
    ctx.principal.entityTeams?.find((t) => t.entityId === entityId)?.teamId ??
    (ctx.entityIds.length === 1 ? ctx.principal.teamId : undefined)
  );
}

/**
 * Who the caller may hand a lead to in one company (`crm.opportunity.assign`, design §7.2): the
 * active people whose role there works on leads (`crm.lead.write`), as the command checks,
 * narrowed to what the caller's `crm.lead.assign` scope reaches: the whole company, their own
 * team, or only themselves. The command and the update policy still decide; this only offers
 * sensible choices. Whether a person is active comes from `app.user_is_active()` (0059), since
 * the caller reads no other person's users row.
 */
export async function listLeadAssignees(
  ctx: AssigneeContext,
  rawInput: unknown,
): Promise<LeadAssigneeDto[]> {
  const input = parseQueryInput(ListLeadAssigneesInput, rawInput, 'crm.lead.assignees');
  checkPermission(ctx.principal, 'crm.lead.assign', 'own');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }

  const uer = schema.userEntityRoles;
  const rp = schema.rolePermissions;
  const p = schema.principals;
  const permissions = ctx.principal.permissions;
  const team = teamIn(ctx, input.entityId);
  const reach = hasGrant(permissions, 'crm.lead.assign', 'entity')
    ? undefined
    : hasGrant(permissions, 'crm.lead.assign', 'team') && team !== undefined
      ? eq(uer.teamId, team)
      : eq(uer.userId, ctx.principal.id);

  const rows = await ctx.tx
    .selectDistinct({ id: p.id, name: p.displayName, teamId: uer.teamId })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'crm.lead.write')))
    .where(and(eq(uer.entityId, input.entityId), reach, sql`app.user_is_active(${p.id})`))
    .orderBy(asc(p.displayName), asc(p.id))
    .limit(MAX_ASSIGNEES);
  return rows.map((r) => LeadAssigneeDto.parse(r));
}
