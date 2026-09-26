import {
  DomainError,
  newId,
  type EntityRoleInput,
  type SessionRevokeReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
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
