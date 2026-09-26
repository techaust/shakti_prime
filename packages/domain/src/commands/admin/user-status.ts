import { DomainError, ReactivateUserInput, SuspendUserInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { revokeUserSessions } from './shared';

/** `admin.user.suspend`: sign-in stops and every session is revoked. Reversible. */
export const suspendUser = defineCommand({
  name: 'admin.user.suspend',
  permission: 'admin.users.write',
  minScope: 'all',
  input: SuspendUserInput,
  output: UserDto,
  async handler(ctx, input) {
    if (input.userId === ctx.principal.id) {
      throw new DomainError('validation_failed', 'a user cannot suspend themselves', {
        reason: 'self_suspend',
      });
    }
    const [row] = await ctx.tx
      .update(schema.users)
      .set({ status: 'suspended', updatedBy: ctx.principal.id })
      .where(
        and(eq(schema.users.id, input.userId), inArray(schema.users.status, ['invited', 'active'])),
      )
      .returning({ id: schema.users.id });
    if (!row) {
      throw new DomainError('not_found', 'no active or invited user to suspend', {
        reason: 'user_missing',
      });
    }
    const revoked = await revokeUserSessions(ctx, input.userId, 'suspended');
    const dto = await loadUserDto(ctx.tx, input.userId);
    for (const r of dto.entityRoles) {
      ctx.emit({
        type: 'admin.user.suspended',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: { reason: input.reason ?? null, revokedSessions: revoked.length },
      });
    }
    return dto;
  },
});

/** `admin.user.reactivate`: a suspended user may sign in again. */
export const reactivateUser = defineCommand({
  name: 'admin.user.reactivate',
  permission: 'admin.users.write',
  minScope: 'all',
  input: ReactivateUserInput,
  output: UserDto,
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .update(schema.users)
      .set({ status: 'active', updatedBy: ctx.principal.id })
      .where(and(eq(schema.users.id, input.userId), eq(schema.users.status, 'suspended')))
      .returning({ id: schema.users.id });
    if (!row) {
      throw new DomainError('not_found', 'no suspended user to reactivate', {
        reason: 'user_missing',
      });
    }
    const dto = await loadUserDto(ctx.tx, input.userId);
    for (const r of dto.entityRoles) {
      ctx.emit({
        type: 'admin.user.reactivated',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: {},
      });
    }
    return dto;
  },
});
