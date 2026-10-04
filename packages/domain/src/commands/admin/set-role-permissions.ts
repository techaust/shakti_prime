import {
  DomainError,
  EXECUTIVE_KEPT_GRANTS,
  isPlatformOnlyPermission,
  PERMISSION_SCOPES,
  roleMayHold,
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
import { roleGrantsVersion } from './role-grants-version';

const isStaffRole = (key: string) => (STAFF_ROLE_KEYS as readonly string[]).includes(key);

/**
 * Checks the grant set an Executive asks for before anything is read (docs/SECURITY.md §3.1):
 * only staff roles are edited here (an agent keeps its fixed set, a system role belongs to the
 * platform); no staff role holds a platform-only permission; an Executive-only or cost permission
 * goes only to the roles allowed to hold it (BLUEPRINT §7.1 to §7.3); each scope is one the
 * permission honours; and the Executive role always keeps managing people and roles, so the
 * group can never lock itself out. The database refuses the same holders (`app.role_may_hold()`).
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
  const notForRole = grants.filter((g) => !roleMayHold(roleKey, g.permission));
  if (notForRole.length > 0) {
    throw new DomainError('validation_failed', `role ${roleKey} may not hold these permissions`, {
      reason: 'permission_not_for_role',
      permissions: notForRole.map((g) => g.permission),
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
  const offScope = grants.filter(
    (g) => !(PERMISSION_SCOPES[g.permission] as readonly string[]).includes(g.scope),
  );
  if (offScope.length > 0) {
    throw new DomainError('validation_failed', 'a scope the permission does not honour', {
      reason: 'scope_not_offered',
      permissions: offScope.map((g) => g.permission),
    });
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
 * created after it (docs/DATABASE.md §9). The editor sends the fingerprint of the set it read,
 * and a save over a set someone changed since is refused (`role_changed_meanwhile`). Everyone
 * holding the role, in any company, is signed out (`role_changed`) so their next request resolves
 * the new grants; the caller's own current sign-in stays, named by the server action in
 * `keepSessionId`, which spares only a session of the caller. The action then drops the cached
 * access of every holder. Only a request acting for every company may change a role, which the
 * database policies enforce as well, with the holder rules in `role_permissions_holder_guard`.
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
  constraintReasons: {
    role_permissions_platform_only: 'permission_platform_only',
    role_permissions_holder: 'permission_not_for_role',
    role_permissions_executive_keeps_admin: 'executive_keeps_admin',
  },
  async handler(ctx, input) {
    assertEditableGrants(input.roleKey, input.grants);
    await assertGroupScope(ctx);

    const r = schema.roles;
    const [role] = await ctx.tx
      .select({ id: r.id, customisedAt: r.customisedAt })
      .from(r)
      .where(and(eq(r.key, input.roleKey), isNull(r.archivedAt)))
      .limit(1)
      // two Executives editing one role at once take turns, so the second sees the first's set
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
    const version = roleGrantsVersion(beforeRows);
    if (version !== input.expectedVersion) {
      throw new DomainError('conflict', 'the role changed since the editor read it', {
        reason: 'role_changed_meanwhile',
      });
    }
    const before = new Map(beforeRows.map((g) => [g.permission, g.scope as Scope]));
    const after = new Map(input.grants.map((g) => [g.permission as string, g.scope]));

    const removed = [...before.keys()].filter((k) => !after.has(k));
    const added = [...after.entries()].filter(([k]) => !before.has(k));
    const rescoped = [...after.entries()].filter(
      ([k, scope]) => before.has(k) && before.get(k) !== scope,
    );

    if (removed.length === 0 && added.length === 0 && rescoped.length === 0) {
      return {
        roleId: role.id,
        roleKey: input.roleKey,
        grantCount: before.size,
        customisedAt: role.customisedAt?.toISOString() ?? null,
        version,
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
    // The database's own clock, as the seed compares it with `permissions.created_at`.
    const [marked] = await ctx.tx
      .update(r)
      .set({ customisedAt: sql`now()`, updatedBy: actor })
      .where(eq(r.id, role.id))
      .returning({ customisedAt: r.customisedAt });
    const customisedAt = (marked?.customisedAt ?? ctx.now).toISOString();

    const holders = await holdersOf(ctx, role.id);
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
        customisedAt,
        holders: holders.length,
        revokedSessions: revoked,
      },
    });
    // The outbox files every event under a company (`outbox_events.entity_id` is required). A role
    // belongs to the whole group, and the request acts for every company, so the event goes under
    // the lowest company id of the request, the same company for every role change.
    const entityId = Math.min(...ctx.entityIds);
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
    return {
      roleId: role.id,
      roleKey: input.roleKey,
      grantCount: after.size,
      customisedAt,
      version: roleGrantsVersion(grantsAfter),
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

/**
 * Revokes every live session of the holders except the caller's own named one, and answers how
 * many. The sessions policy lets an administrator revoke only a person who works in no active
 * company outside the request; should it hold any session back, nothing is saved
 * (`role_holders_kept`), because a holder still signed in would keep the old grants.
 */
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
  const live = and(inArray(s.userId, [...holders]), isNull(s.revokedAt), spared);
  const [counted] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(live);
  const rows = await ctx.tx
    .update(s)
    .set({ revokedAt: ctx.now, revokedReason: 'role_changed' })
    .where(live)
    .returning({ id: s.id });
  if (rows.length !== (counted?.n ?? 0)) {
    throw new DomainError('conflict', 'some holders could not be signed out', {
      reason: 'role_holders_kept',
    });
  }
  return rows.length;
}
