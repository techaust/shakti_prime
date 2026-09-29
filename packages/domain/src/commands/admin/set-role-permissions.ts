import {
  DomainError,
  EXECUTIVE_KEPT_GRANTS,
  isPlatformOnlyPermission,
  RolePermissionsSetDto,
  SetRolePermissionsInput,
  STAFF_ROLE_KEYS,
  type RoleGrantInput,
  type Scope,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';

const isStaffRole = (key: string) => (STAFF_ROLE_KEYS as readonly string[]).includes(key);

/**
 * Checks the grant set an Executive asks for before anything is read: only staff roles are
 * edited here (an agent keeps its fixed set, a system role belongs to the platform), no staff role
 * may hold a platform-only permission, and the Executive role always keeps managing people and
 * roles, so the group can never lock itself out (docs/SECURITY.md §3.1).
 */
export function assertEditableGrants(roleKey: string, grants: readonly RoleGrantInput[]): void {
  if (!isStaffRole(roleKey)) {
    throw new DomainError('forbidden', `role ${roleKey} is not edited here`, {
      reason: 'role_not_editable',
    });
  }
  const platformOnly = grants.filter((g) => isPlatformOnlyPermission(g.permission));
  if (platformOnly.length > 0) {
    throw new DomainError('validation_failed', 'a staff role cannot hold a platform permission', {
      reason: 'permission_platform_only',
      permissions: platformOnly.map((g) => g.permission),
    });
  }
  if (roleKey === 'executive') {
    const kept = EXECUTIVE_KEPT_GRANTS.every((k) =>
      grants.some((g) => g.permission === k.key && g.scope === k.scope),
    );
    if (!kept) {
      throw new DomainError('validation_failed', 'the Executive role keeps its admin grants', {
        reason: 'executive_keeps_admin',
      });
    }
  }
}

/** Refuses a request narrowed to some companies: a role's grants reach every company. */
async function assertGroupScope(ctx: CommandContext): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a role change needs every company in scope', {
      reason: 'role_group_scope',
    });
  }
}

/**
 * `admin.role.permissions.set` (docs/design/phase1.md §6.2): replaces a staff role's grants as a
 * set and marks the role customised, so a later seed keeps the edit and adds only permissions
 * created after it (docs/DATABASE.md §9). Everyone holding the role, in any company, is signed
 * out (`role_changed`) so their next request resolves the new grants; the caller's own current
 * sign-in stays, named by the server action in `keepSessionId`, which spares only a session of
 * the caller. The action then drops the cached access of every holder. Only a request acting for
 * every company may change a role, which the database policies enforce as well (the
 * platform-only trigger too).
 */
export const setRolePermissions = defineCommand({
  name: 'admin.role.permissions.set',
  permission: 'admin.roles.write',
  minScope: 'all',
  // Signing the holders out writes their sessions, which admin.users.write:all governs.
  alsoRequires: [{ permission: 'admin.users.write', minScope: 'all' }],
  input: SetRolePermissionsInput,
  output: RolePermissionsSetDto,
  auditFields: ['grants', 'customisedAt', 'holders', 'revokedSessions'],
  auditInput: (input) => ({ roleKey: input.roleKey, grants: input.grants }),
  constraintReasons: { role_permissions_platform_only: 'permission_platform_only' },
  async handler(ctx, input) {
    assertEditableGrants(input.roleKey, input.grants);
    await assertGroupScope(ctx);

    const r = schema.roles;
    const [role] = await ctx.tx
      .select({ id: r.id, customisedAt: r.customisedAt })
      .from(r)
      .where(and(eq(r.key, input.roleKey), isNull(r.archivedAt)))
      .limit(1)
      // two Executives editing one role at once take turns, so neither reads a stale set
      .for('update');
    if (!role) {
      throw new DomainError('not_found', 'role is not available', { reason: 'role_missing' });
    }

    const rp = schema.rolePermissions;
    const beforeRows = await ctx.tx
      .select({ permission: rp.permissionKey, scope: rp.scope })
      .from(rp)
      .where(eq(rp.roleId, role.id))
      .orderBy(rp.permissionKey);
    const before = new Map(beforeRows.map((g) => [g.permission, g.scope as Scope]));
    const after = new Map(input.grants.map((g) => [g.permission as string, g.scope]));

    const removed = [...before.keys()].filter((k) => !after.has(k));
    const added = [...after.entries()].filter(([k]) => !before.has(k));
    const rescoped = [...after.entries()].filter(
      ([k, scope]) => before.has(k) && before.get(k) !== scope,
    );

    const holders = await holdersOf(ctx, role.id);
    const unchanged = removed.length === 0 && added.length === 0 && rescoped.length === 0;
    if (unchanged) {
      return {
        roleId: role.id,
        roleKey: input.roleKey,
        grantCount: before.size,
        customisedAt: role.customisedAt?.toISOString() ?? null,
        revokedSessions: 0,
        holderUserIds: [],
      };
    }

    const actor = ctx.principal.id;
    if (removed.length > 0) {
      await ctx.tx
        .delete(rp)
        .where(and(eq(rp.roleId, role.id), inArray(rp.permissionKey, removed)));
    }
    for (const [key, scope] of rescoped) {
      await ctx.tx
        .update(rp)
        .set({ scope, updatedBy: actor })
        .where(and(eq(rp.roleId, role.id), eq(rp.permissionKey, key)));
    }
    if (added.length > 0) {
      await ctx.tx.insert(rp).values(
        added.map(([key, scope]) => ({
          roleId: role.id,
          permissionKey: key,
          scope,
          createdBy: actor,
          updatedBy: actor,
        })),
      );
    }
    await ctx.tx
      .update(r)
      .set({ customisedAt: ctx.now, updatedBy: actor })
      .where(eq(r.id, role.id));

    const revoked = await revokeHolderSessions(ctx, holders, input.keepSessionId);
    const grantsAfter = [...after.entries()]
      .map(([permission, scope]) => ({ permission, scope }))
      .sort((a, b) => a.permission.localeCompare(b.permission));
    ctx.audit({
      aggregateType: 'role',
      aggregateId: role.id,
      entityId: null,
      before: {
        grants: beforeRows,
        customisedAt: role.customisedAt?.toISOString() ?? null,
      },
      after: {
        grants: grantsAfter,
        customisedAt: ctx.now.toISOString(),
        holders: holders.length,
        revokedSessions: revoked,
      },
    });
    const entityId = ctx.entityIds[0];
    if (entityId !== undefined) {
      ctx.emit({
        type: 'admin.role.permissions_changed',
        entityId,
        aggregateType: 'role',
        aggregateId: role.id,
        payload: {
          roleId: role.id,
          grantCount: after.size,
          added: added.length,
          removed: removed.length,
          rescoped: rescoped.length,
          holders: holders.length,
          revokedSessions: revoked,
        },
      });
    }
    return {
      roleId: role.id,
      roleKey: input.roleKey,
      grantCount: after.size,
      customisedAt: ctx.now.toISOString(),
      revokedSessions: revoked,
      holderUserIds: holders,
    };
  },
});

/**
 * Everyone holding the role in a company of the request, which covers every active company
 * (`assertGroupScope`), suspended people included: their sessions are revoked too.
 */
async function holdersOf(ctx: CommandContext, roleId: string): Promise<string[]> {
  const uer = schema.userEntityRoles;
  const rows = await ctx.tx
    .selectDistinct({ userId: uer.userId })
    .from(uer)
    .where(eq(uer.roleId, roleId))
    .orderBy(uer.userId);
  return rows.map((row) => row.userId);
}

/** Revokes every live session of the holders except the caller's own named one; answers how many. */
async function revokeHolderSessions(
  ctx: CommandContext,
  holders: readonly string[],
  keepSessionId: string | undefined,
): Promise<number> {
  if (holders.length === 0) return 0;
  const s = schema.sessions;
  const spared =
    keepSessionId === undefined
      ? undefined
      : or(ne(s.id, keepSessionId), ne(s.userId, ctx.principal.id));
  const rows = await ctx.tx
    .update(s)
    .set({ revokedAt: ctx.now, revokedReason: 'role_changed' })
    .where(and(inArray(s.userId, [...holders]), isNull(s.revokedAt), spared))
    .returning({ id: s.id });
  return rows.length;
}
