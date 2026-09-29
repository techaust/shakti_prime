import {
  DomainError,
  isPlatformOnlyPermission,
  PERMISSION_KEYS,
  RoleGrantsDto,
  RoleGrantsQuery,
  RoleListDto,
  STAFF_ROLE_KEYS,
  type PermissionKey,
  type RoleSummaryDto,
  type Scope,
  type StaffRoleKey,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

type AdminContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const CATALOGUE_ORDER = new Map<string, number>(PERMISSION_KEYS.map((k, i) => [k, i]));
const ROLE_ORDER = new Map<string, number>(STAFF_ROLE_KEYS.map((k, i) => [k, i]));

/**
 * The staff roles with their grant counts, whether an Executive changed them and how many people
 * hold each in the companies of the request. Agent roles keep fixed sets and are not listed.
 */
async function roleSummaries(
  ctx: AdminContext,
  keys: readonly StaffRoleKey[],
): Promise<RoleSummaryDto[]> {
  const r = schema.roles;
  const rp = schema.rolePermissions;
  const uer = schema.userEntityRoles;
  const roles = await ctx.tx
    .select({ id: r.id, key: r.key, customisedAt: r.customisedAt })
    .from(r)
    .where(and(inArray(r.key, [...keys]), isNull(r.archivedAt)));
  const ids = roles.map((role) => role.id);
  if (ids.length === 0) return [];
  const [grants, holders] = await Promise.all([
    ctx.tx
      .select({ roleId: rp.roleId, n: sql<number>`count(*)::int` })
      .from(rp)
      .where(inArray(rp.roleId, ids))
      .groupBy(rp.roleId),
    ctx.tx
      .select({ roleId: uer.roleId, n: sql<number>`count(distinct ${uer.userId})::int` })
      .from(uer)
      .where(and(inArray(uer.roleId, ids), inArray(uer.entityId, [...ctx.entityIds])))
      .groupBy(uer.roleId),
  ]);
  const grantCounts = new Map(grants.map((g) => [g.roleId, g.n]));
  const holderCounts = new Map(holders.map((h) => [h.roleId, h.n]));
  const rows = roles.map((role) => ({
    ...role,
    grantCount: grantCounts.get(role.id) ?? 0,
    holderCount: holderCounts.get(role.id) ?? 0,
  }));
  return rows
    .map((row) => ({
      id: row.id,
      key: row.key as StaffRoleKey,
      grantCount: row.grantCount,
      customisedAt: row.customisedAt?.toISOString() ?? null,
      holderCount: row.holderCount,
    }))
    .sort((a, b) => (ROLE_ORDER.get(a.key) ?? 0) - (ROLE_ORDER.get(b.key) ?? 0));
}

/** Admin › Roles (`admin.roles.write` at group scope): every staff role, in the catalogue order. */
export async function listRoles(ctx: AdminContext): Promise<RoleListDto> {
  checkPermission(ctx.principal, 'admin.roles.write', 'all');
  return RoleListDto.parse({ roles: await roleSummaries(ctx, STAFF_ROLE_KEYS) });
}

/**
 * One staff role's page: the permission catalogue in its own order, each with its plain
 * description, its module and the role's scope, or null when the role lacks it. Platform-only
 * permissions are never offered to a staff role and are left out.
 */
export async function getRoleGrants(ctx: AdminContext, rawInput: unknown): Promise<RoleGrantsDto> {
  const input = parseQueryInput(RoleGrantsQuery, rawInput, 'admin.roles.grants');
  checkPermission(ctx.principal, 'admin.roles.write', 'all');
  const [role] = await roleSummaries(ctx, [input.roleKey]);
  if (!role) {
    throw new DomainError('not_found', 'role is not available', { reason: 'role_missing' });
  }
  const p = schema.permissions;
  const rp = schema.rolePermissions;
  const rows = await ctx.tx
    .select({ key: p.key, module: p.module, description: p.description, scope: rp.scope })
    .from(p)
    .leftJoin(rp, and(eq(rp.permissionKey, p.key), eq(rp.roleId, role.id)));
  const permissions = rows
    .filter((row) => CATALOGUE_ORDER.has(row.key) && !isPlatformOnlyPermission(row.key))
    .sort((a, b) => (CATALOGUE_ORDER.get(a.key) ?? 0) - (CATALOGUE_ORDER.get(b.key) ?? 0))
    .map((row) => ({
      key: row.key as PermissionKey,
      module: row.module,
      description: row.description,
      scope: (row.scope as Scope | null) ?? null,
    }));
  return RoleGrantsDto.parse({ role, permissions });
}
