import {
  PermissionGrantSchema,
  PermissionKeySchema,
  requiresTotp,
  RoleKeySchema,
  SCOPES,
  ScopeSchema,
  StaffRoleKeySchema,
  type PermissionGrant,
  type Principal,
  type Scope,
  type StaffRoleKey,
} from '@shakti/contracts';
import type { UserGrantRow } from '@shakti/db';
import { z } from 'zod';

/** One entity row of a user with its grants, assembled from `app.user_grants()`. */
export interface EntityGrants {
  entityId: number;
  /** The entity's brand name, for the switcher. */
  entityName: string;
  roleKey: StaffRoleKey;
  teamId: string | null;
  grants: PermissionGrant[];
}

export interface UserAccess {
  status: string;
  theme: string;
  /** Standard or high (DESIGN.md §2.1), kept per person like the theme. */
  contrast: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  entities: EntityGrants[];
}

const UserAccessSchema = z.object({
  status: z.string(),
  theme: z.string(),
  contrast: z.string(),
  name: z.string(),
  email: z.string(),
  twoFactorEnabled: z.boolean(),
  entities: z.array(
    z.object({
      entityId: z.number().int(),
      entityName: z.string(),
      roleKey: StaffRoleKeySchema,
      teamId: z.string().nullable(),
      grants: z.array(PermissionGrantSchema),
    }),
  ),
});

/** A `UserAccess` read back from a cache, or undefined when it does not have the expected shape. */
export function parseUserAccess(value: unknown): UserAccess | undefined {
  const parsed = UserAccessSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Groups the flat function output by entity. Rows with no entity (a user without roles) are dropped. */
export function groupUserGrants(rows: readonly UserGrantRow[]): UserAccess | undefined {
  const first = rows[0];
  if (!first) return undefined;
  const byEntity = new Map<number, EntityGrants>();
  for (const row of rows) {
    if (row.entityId === null || row.roleKey === null) continue;
    const roleKey = StaffRoleKeySchema.safeParse(row.roleKey);
    if (!roleKey.success) continue;
    let entry = byEntity.get(row.entityId);
    if (!entry) {
      entry = {
        entityId: row.entityId,
        entityName: row.entityName ?? String(row.entityId),
        roleKey: roleKey.data,
        teamId: row.teamId,
        grants: [],
      };
      byEntity.set(row.entityId, entry);
    }
    const key = PermissionKeySchema.safeParse(row.permissionKey);
    const scope = ScopeSchema.safeParse(row.scope);
    if (key.success && scope.success) entry.grants.push({ key: key.data, scope: scope.data });
  }
  return {
    status: first.status,
    theme: first.theme,
    contrast: first.contrast,
    name: first.name,
    email: first.email,
    twoFactorEnabled: first.twoFactorEnabled,
    entities: [...byEntity.values()].sort((a, b) => a.entityId - b.entityId),
  };
}

function narrower(a: Scope, b: Scope): Scope {
  return SCOPES.indexOf(a) <= SCOPES.indexOf(b) ? a : b;
}

/**
 * Grants for the "All entities" view: a key survives only when every entity row holds it, at the
 * narrowest scope any row grants (decision of 2026-09-27, design §2.3). One row is its own grants.
 */
export function intersectGrants(entities: readonly EntityGrants[]): PermissionGrant[] {
  const [head, ...rest] = entities;
  if (!head) return [];
  const merged = new Map<PermissionGrant['key'], Scope>();
  for (const grant of head.grants) {
    const existing = merged.get(grant.key);
    merged.set(grant.key, existing ? narrower(existing, grant.scope) : grant.scope);
  }
  for (const entity of rest) {
    const scopes = new Map<PermissionGrant['key'], Scope>();
    for (const grant of entity.grants) {
      const existing = scopes.get(grant.key);
      scopes.set(grant.key, existing ? narrower(existing, grant.scope) : grant.scope);
    }
    for (const [key, scope] of [...merged]) {
      const other = scopes.get(key);
      if (other === undefined) merged.delete(key);
      else merged.set(key, narrower(scope, other));
    }
  }
  return [...merged]
    .map(([key, scope]) => ({ key, scope }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

export type ResolveOutcome =
  | { kind: 'principal'; principal: Principal; access: UserAccess }
  | { kind: 'totp_required'; access: UserAccess }
  | { kind: 'inactive'; status: string; access: UserAccess }
  | { kind: 'no_access'; access: UserAccess }
  /** The requested entity is not one the user holds a role in (a stale switcher cookie). */
  | { kind: 'entity_not_held'; access: UserAccess }
  | { kind: 'unknown' };

/**
 * Builds the principal of a signed-in user (design §2.3). Single-entity mode takes that row's
 * role, grants and team; all-entities mode takes every entity, the intersection of grants, the
 * role with the fewest grants for display, and the team only when one entity is held. Roles
 * that must use an authenticator app resolve to `totp_required` until enrolment is done.
 */
export function resolvePrincipalFromGrants(
  userId: string,
  rows: readonly UserGrantRow[],
  activeEntityId?: number,
): ResolveOutcome {
  const access = groupUserGrants(rows);
  if (!access) return { kind: 'unknown' };
  if (access.status !== 'active') return { kind: 'inactive', status: access.status, access };
  if (access.entities.length === 0) return { kind: 'no_access', access };
  if (requiresTotp(access.entities.map((e) => e.roleKey)) && !access.twoFactorEnabled) {
    return { kind: 'totp_required', access };
  }

  const active =
    activeEntityId === undefined
      ? undefined
      : access.entities.find((e) => e.entityId === activeEntityId);
  if (activeEntityId !== undefined && !active) return { kind: 'entity_not_held', access };
  const selected = active ? [active] : access.entities;
  const team = selected.length === 1 ? selected[0]?.teamId : undefined;
  const display = [...selected].sort((a, b) => a.grants.length - b.grants.length)[0] ?? selected[0];
  if (!display) return { kind: 'no_access', access };
  const principal: Principal = {
    id: userId,
    kind: 'user',
    roleKey: RoleKeySchema.parse(display.roleKey),
    entityIds: selected.map((e) => e.entityId),
    permissions: intersectGrants(selected),
    ...(team ? { teamId: team } : {}),
    entityTeams: selected.flatMap((e) =>
      e.teamId ? [{ entityId: e.entityId, teamId: e.teamId }] : [],
    ),
  };
  return { kind: 'principal', principal, access };
}
