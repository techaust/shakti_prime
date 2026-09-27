import { DomainError, ResetTwoFactorInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { assertUserInScope, lockExecutiveChanges, revokeUserSessions } from './shared';

/**
 * `admin.user.two_factor.reset`: an Executive removes the authenticator app of a user who lost it
 * together with their backup codes (review 3). Every session of the user is revoked, and a user
 * whose role requires an authenticator enrols a new one at the next sign-in. The write goes through
 * `app.reset_two_factor()`, because the request role cannot touch the two-factor store itself.
 * A user with no authenticator is answered as is, so a repeated click is harmless.
 */
export const resetTwoFactor = defineCommand({
  name: 'admin.user.two_factor.reset',
  permission: 'admin.users.write',
  minScope: 'all',
  input: ResetTwoFactorInput,
  output: UserDto,
  async handler(ctx, input) {
    if (input.userId === ctx.principal.id) {
      throw new DomainError('validation_failed', 'a user cannot reset their own authenticator', {
        reason: 'self_two_factor_reset',
      });
    }
    await lockExecutiveChanges(ctx);
    const [user] = await ctx.tx
      .select({ twoFactorEnabled: schema.users.twoFactorEnabled })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!user) {
      throw new DomainError('not_found', 'user is not visible', { reason: 'user_missing' });
    }
    await assertUserInScope(ctx, input.userId);
    if (!user.twoFactorEnabled) {
      ctx.audit({ aggregateType: 'user', aggregateId: input.userId, entityId: null });
      return loadUserDto(ctx.tx, input.userId);
    }
    await ctx.tx.execute(sql`select app.reset_two_factor(${input.userId}::uuid)`);
    const revoked = await revokeUserSessions(ctx, input.userId, 'totp_reset');
    ctx.audit({
      aggregateType: 'user',
      aggregateId: input.userId,
      entityId: null,
      before: { twoFactorEnabled: true },
      after: { twoFactorEnabled: false, revokedSessions: revoked.length },
    });
    const dto = await loadUserDto(ctx.tx, input.userId);
    for (const r of dto.entityRoles) {
      ctx.emit({
        type: 'admin.user.two_factor_reset',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: { revokedSessions: revoked.length },
      });
    }
    return dto;
  },
});
