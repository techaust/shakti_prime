import { DomainError, SetUserRolesInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { insertEntityRoles, resolveEntityRoles, revokeUserSessions } from './shared';

/**
 * `admin.user.role.set`: replaces the user's access list and signs them out everywhere, so the
 * next request resolves the new grants (docs/SECURITY.md §2, rotation on privilege change).
 */
export const setUserRoles = defineCommand({
  name: 'admin.user.role.set',
  permission: 'admin.users.write',
  minScope: 'all',
  input: SetUserRolesInput,
  output: UserDto,
  async handler(ctx, input) {
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
