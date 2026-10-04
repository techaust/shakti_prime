import {
  DomainError,
  EXECUTIVE_KEPT_GRANTS,
  EXECUTIVE_ONLY_PERMISSIONS,
  isPlatformOnlyPermission,
  PERMISSION_SCOPES,
  PERMISSION_KEYS,
  RoleGrantsDto,
  RoleGrantsQuery,
  RoleListDto,
  roleMayHold,
  STAFF_ROLE_KEYS,
  type PermissionKey,
  type RoleGrantLock,
  type RoleSummaryDto,
  type Scope,
  type StaffRoleKey,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { roleGrantsVersion } from '../../commands/admin/role-grants-version';
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

/** What the editor offers a role for a permission, and why it offers no choice, if it does not. */
export function roleGrantChoice(
  roleKey: StaffRoleKey,
  key: PermissionKey,
): { scopes: Scope[]; locked: RoleGrantLock | null } {
  if (!roleMayHold(roleKey, key)) {
    const executiveOnly = (EXECUTIVE_ONLY_PERMISSIONS as readonly string[]).includes(key);
    return { scopes: [], locked: executiveOnly ? 'executiveOnly' : 'costHolders' };
  }
  if (roleKey === 'executive' && EXECUTIVE_KEPT_GRANTS.some((g) => g.key === key)) {
    return { scopes: ['all'], locked: 'executiveKeeps' };
  }
  return { scopes: [...PERMISSION_SCOPES[key]], locked: null };
}

/**
 * One staff role's page: the permission catalogue in its own order, each with the role's scope,
 * or null when the role lacks it, the scopes the editor offers and why a permission is locked;
 * the fingerprint of the role's grant set for the save's optimistic check; and whether the
 * request acts for every company, which a save needs. Platform-only permissions are never
 * offered to a staff role and are left out.
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
    .select({ key: p.key, module: p.module, scope: rp.scope })
    .from(p)
    .leftJoin(rp, and(eq(rp.permissionKey, p.key), eq(rp.roleId, role.id)));
  const granted = await ctx.tx
    .select({ permission: rp.permissionKey, scope: rp.scope })
    .from(rp)
    .where(eq(rp.roleId, role.id));
  const [covers] = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  const permissions = rows
    .filter((row) => CATALOGUE_ORDER.has(row.key) && !isPlatformOnlyPermission(row.key))
    .sort((a, b) => (CATALOGUE_ORDER.get(a.key) ?? 0) - (CATALOGUE_ORDER.get(b.key) ?? 0))
    .map((row) => ({
      key: row.key as PermissionKey,
      module: row.module,
      scope: (row.scope as Scope | null) ?? null,
      ...roleGrantChoice(role.key, row.key as PermissionKey),
    }));
  return RoleGrantsDto.parse({
    role,
    permissions,
    version: roleGrantsVersion(granted),
    groupScope: covers?.ok === true,
  });
}
