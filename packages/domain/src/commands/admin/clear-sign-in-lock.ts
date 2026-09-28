import { ClearSignInLockInput, DomainError, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { assertUserInScope } from './shared';

/**
 * `admin.user.lock.clear`: an Executive lifts every sign-in lock on a staff member's account
 * (AUDIT M6), after confirming who is asking. The lock lives in the shared key-value store, not
 * in the database, so the command checks the permission and the target and records the audit row
 * in its transaction; the server action lifts the lock with the answered email after the commit,
 * as the other admin actions send their emails. Never for the caller's own account.
 */
export const clearSignInLock = defineCommand({
  name: 'admin.user.lock.clear',
  permission: 'admin.users.write',
  minScope: 'all',
  input: ClearSignInLockInput,
  output: UserDto,
  async handler(ctx, input) {
    if (input.userId === ctx.principal.id) {
      throw new DomainError('validation_failed', 'a user cannot lift their own sign-in lock', {
        reason: 'self_lock_clear',
      });
    }
    const [user] = await ctx.tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!user) {
      throw new DomainError('not_found', 'user is not visible', { reason: 'user_missing' });
    }
    await assertUserInScope(ctx, input.userId);
    ctx.audit({ aggregateType: 'user', aggregateId: input.userId, entityId: null });
    return loadUserDto(ctx.tx, input.userId);
  },
});
