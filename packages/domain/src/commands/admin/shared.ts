import {
  DomainError,
  newId,
  type EntityRoleInput,
  type SessionRevokeReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

/**
 * Resolves role keys to ids and checks that every entity is in the caller's scope and every team
 * belongs to its entity (or is shared). Shared by invite and role-set.
 */
export async function resolveEntityRoles(
  ctx: CommandContext,
  entityRoles: readonly EntityRoleInput[],
): Promise<{ entityId: number; roleId: string; teamId: string | null }[]> {
  const outside = entityRoles.filter((r) => !ctx.entityIds.includes(r.entityId));
  if (outside.length > 0) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      reason: 'entity_outside_scope',
      entityIds: outside.map((r) => r.entityId),
    });
  }
  const keys = [...new Set(entityRoles.map((r) => r.roleKey))];
  const roleRows = await ctx.tx
    .select({ id: schema.roles.id, key: schema.roles.key })
    .from(schema.roles)
    .where(and(inArray(schema.roles.key, keys), isNull(schema.roles.archivedAt)));
  const roleIds = new Map(roleRows.map((r) => [r.key, r.id]));

  const resolved: { entityId: number; roleId: string; teamId: string | null }[] = [];
  for (const r of entityRoles) {
    const roleId = roleIds.get(r.roleKey);
    if (roleId === undefined) {
      throw new DomainError('validation_failed', `role ${r.roleKey} is not available`, {
        reason: 'role_missing',
      });
    }
    if (r.teamId !== undefined) {
      const [team] = await ctx.tx
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(
          and(
            eq(schema.teams.id, r.teamId),
            isNull(schema.teams.archivedAt),
            or(isNull(schema.teams.entityId), eq(schema.teams.entityId, r.entityId)),
          ),
        )
        .limit(1);
      if (!team) {
        throw new DomainError('validation_failed', 'team does not belong to the entity', {
          reason: 'team_missing',
        });
      }
    }
    resolved.push({ entityId: r.entityId, roleId, teamId: r.teamId ?? null });
  }
  return resolved;
}

/**
 * Refuses a target who holds a role in an entity outside the request scope. Users and their
 * sessions belong to no single entity, so acting on one reaches every company they work in; an
 * admin role held in one company must not reach the others (fix P, AUDIT H2). The read policy on
 * `user_entity_roles` shows only the request's companies, so the definer
 * `app.user_roles_outside_request()` answers which other companies the person works in (0049).
 */
export async function assertUserInScope(ctx: CommandContext, userId: string): Promise<void> {
  const [row] = (await ctx.tx.execute(
    sql`select app.user_roles_outside_request(${userId}::uuid) as outside`,
  )) as unknown as { outside: number[] | null }[];
  const outside = row?.outside ?? [];
  if (outside.length > 0) {
    throw new DomainError('conflict', 'user holds roles outside the request scope', {
      reason: 'user_roles_outside_scope',
      entityIds: outside,
    });
  }
}

/** Active Executives across the group, through a definer: RLS shows the request's companies only. */
async function countActiveExecutives(ctx: CommandContext): Promise<number> {
  const [row] = (await ctx.tx.execute(
    sql`select app.active_executive_count() as count`,
  )) as unknown as { count: number }[];
  return row?.count ?? 0;
}

/**
 * Serialises every change that can remove an Executive, so two Executives acting on each other
 * at once cannot both succeed (AUDIT L7). Held until the transaction ends. Answers how many
 * active Executives there are before the change.
 */
export async function lockExecutiveChanges(ctx: CommandContext): Promise<number> {
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin.executives'))`);
  return countActiveExecutives(ctx);
}

/**
 * Refuses a change that took the group from at least one active Executive to none. A change that
 * touches no Executive passes, whatever the count, so a new system is never stuck.
 */
export async function assertAnExecutiveRemains(
  ctx: CommandContext,
  executivesBefore: number,
): Promise<void> {
  if (executivesBefore > 0 && (await countActiveExecutives(ctx)) === 0) {
    throw new DomainError('conflict', 'the change would leave no active Executive', {
      reason: 'last_executive',
    });
  }
}

/** Marks every live session of a user revoked; returns the ids so the caller can drop caches. */
export async function revokeUserSessions(
  ctx: CommandContext,
  userId: string,
  reason: SessionRevokeReason,
): Promise<string[]> {
  const s = schema.sessions;
  const rows = await ctx.tx
    .update(s)
    .set({ revokedAt: ctx.now, revokedReason: reason })
    .where(and(eq(s.userId, userId), isNull(s.revokedAt)))
    .returning({ id: s.id });
  return rows.map((r) => r.id);
}

export async function insertEntityRoles(
  ctx: CommandContext,
  userId: string,
  rows: readonly { entityId: number; roleId: string; teamId: string | null }[],
): Promise<void> {
  await ctx.tx.insert(schema.userEntityRoles).values(
    rows.map((r) => ({
      id: newId(),
      userId,
      entityId: r.entityId,
      roleId: r.roleId,
      teamId: r.teamId,
      createdBy: ctx.principal.id,
    })),
  );
}
