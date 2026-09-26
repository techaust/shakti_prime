import { DomainError, SetUserRolesInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { insertEntityRoles, resolveEntityRoles, revokeUserSessions } from './shared';

/**
 * `admin.user.role.set`: replaces the user's access list and signs them out everywhere, so the
 * next request resolves the new grants (docs/SECURITY.md §2, rotation on privilege change).
 * The list is replaced as a whole, so the caller's request scope must cover every entity the
 * user holds today; a caller narrowed to one company is told to switch to all companies first.
 * Nobody edits their own roles: the caller is then always another active Executive, which also
 * guarantees an Executive remains after any change.
 */
export const setUserRoles = defineCommand({
  name: 'admin.user.role.set',
  permission: 'admin.users.write',
  minScope: 'all',
  input: SetUserRolesInput,
  output: UserDto,
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
    const held = await ctx.tx
      .select({ entityId: schema.userEntityRoles.entityId })
      .from(schema.userEntityRoles)
      .where(eq(schema.userEntityRoles.userId, input.userId));
    const outside = held.map((r) => r.entityId).filter((id) => !ctx.entityIds.includes(id));
    if (outside.length > 0) {
      throw new DomainError('conflict', 'user holds roles outside the request scope', {
        reason: 'user_roles_outside_scope',
        entityIds: outside,
      });
    }
    const rows = await resolveEntityRoles(ctx, input.entityRoles);

    await ctx.tx
      .delete(schema.userEntityRoles)
      .where(eq(schema.userEntityRoles.userId, input.userId));
    await insertEntityRoles(ctx, input.userId, rows);
    await ctx.tx
      .update(schema.users)
      .set({ updatedBy: ctx.principal.id })
      .where(eq(schema.users.id, input.userId));
    const revoked = await revokeUserSessions(ctx, input.userId, 'role_changed');

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
