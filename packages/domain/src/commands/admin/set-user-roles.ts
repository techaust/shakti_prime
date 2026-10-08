import { DomainError, SetUserRolesInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import {
  assertAnExecutiveRemains,
  assertUserInScope,
  insertEntityRoles,
  lockExecutiveChanges,
  resolveEntityRoles,
  revokeUserSessions,
} from './shared';

/**
 * `admin.user.role.set`: replaces the user's roles in the companies of the request and signs them
 * out everywhere, so the next request resolves the new grants (docs/07-security.md §2, rotation on
 * privilege change). The caller's request scope must cover every entity the user holds today; a
 * caller narrowed to one company is told to switch to all companies first. The check runs after
 * the lock, so a role given in another company meanwhile is seen, and the replacement touches
 * only rows in the request's companies, so a role elsewhere is never removed. Nobody edits their
 * own roles. Changes that could remove an Executive are serialised and refused when none would
 * remain, since two Executives could otherwise demote each other at once.
 */
export const setUserRoles = defineCommand({
  name: 'admin.user.role.set',
  permission: 'admin.users.write',
  minScope: 'all',
  input: SetUserRolesInput,
  output: UserDto,
  auditFields: ['entityRoles', 'revokedSessions'],
  async handler(ctx, input) {
    if (input.userId === ctx.principal.id) {
      throw new DomainError('validation_failed', 'a user cannot change their own roles', {
        reason: 'self_role_change',
      });
    }
    const [user] = await ctx.tx
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!user) {
      throw new DomainError('not_found', 'user is not visible', { reason: 'user_missing' });
    }
    if (user.status === 'offboarded') {
      throw new DomainError('conflict', 'an offboarded user takes no roles', {
        reason: 'user_offboarded',
      });
    }
    // Every change to an existing person's roles takes this lock, so the scope check below cannot be
    // overtaken by a role given in another company before this command writes.
    const executivesBefore = await lockExecutiveChanges(ctx);
    await assertUserInScope(ctx, input.userId);
    const rows = await resolveEntityRoles(ctx, input.entityRoles);

    const uer = schema.userEntityRoles;
    const inRequest = and(eq(uer.userId, input.userId), inArray(uer.entityId, [...ctx.entityIds]));
    const before = await ctx.tx
      .select({ entityId: uer.entityId, roleId: uer.roleId, teamId: uer.teamId })
      .from(uer)
      .where(inRequest)
      .orderBy(uer.entityId);
    await ctx.tx.delete(uer).where(inRequest);
    await insertEntityRoles(ctx, input.userId, rows);
    await assertAnExecutiveRemains(ctx, executivesBefore);
    await ctx.tx
      .update(schema.users)
      .set({ updatedBy: ctx.principal.id })
      .where(eq(schema.users.id, input.userId));
    const revoked = await revokeUserSessions(ctx, input.userId, 'role_changed');
    ctx.audit({
      aggregateType: 'user',
      aggregateId: input.userId,
      entityId: null,
      before: { entityRoles: before },
      after: { entityRoles: rows, revokedSessions: revoked.length },
    });

    for (const r of rows) {
      ctx.emit({
        type: 'admin.user.roles_changed',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: { roleId: r.roleId, revokedSessions: revoked.length },
      });
    }
    return loadUserDto(ctx.tx, input.userId);
  },
});
