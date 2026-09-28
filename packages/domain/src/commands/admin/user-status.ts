import { DomainError, ReactivateUserInput, SuspendUserInput, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import {
  assertAnExecutiveRemains,
  assertUserInScope,
  lockExecutiveChanges,
  revokeUserSessions,
} from './shared';

/** The target's status, after checking it exists and lies inside the request scope. */
async function targetStatus(ctx: CommandContext, userId: string): Promise<string> {
  const [user] = await ctx.tx
    .select({ status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) {
    throw new DomainError('not_found', 'user is not visible', { reason: 'user_missing' });
  }
  await assertUserInScope(ctx, userId);
  if (user.status === 'offboarded') {
    throw new DomainError('conflict', 'an offboarded user cannot change status', {
      reason: 'user_offboarded',
    });
  }
  return user.status;
}

/**
 * `admin.user.suspend`: sign-in stops and every session is revoked. Reversible. Suspending a user
 * who is already suspended answers their current record, so a repeated click is harmless.
 */
export const suspendUser = defineCommand({
  name: 'admin.user.suspend',
  permission: 'admin.users.write',
  minScope: 'all',
  input: SuspendUserInput,
  output: UserDto,
  auditFields: ['status', 'revokedSessions'],
  async handler(ctx, input) {
    if (input.userId === ctx.principal.id) {
      throw new DomainError('validation_failed', 'a user cannot suspend themselves', {
        reason: 'self_suspend',
      });
    }
    const executivesBefore = await lockExecutiveChanges(ctx);
    const status = await targetStatus(ctx, input.userId);
    if (status === 'suspended') {
      ctx.audit({ aggregateType: 'user', aggregateId: input.userId, entityId: null });
      return loadUserDto(ctx.tx, input.userId);
    }
    await ctx.tx
      .update(schema.users)
      .set({ status: 'suspended', updatedBy: ctx.principal.id })
      .where(eq(schema.users.id, input.userId));
    await assertAnExecutiveRemains(ctx, executivesBefore);
    const revoked = await revokeUserSessions(ctx, input.userId, 'suspended');
    ctx.audit({
      aggregateType: 'user',
      aggregateId: input.userId,
      entityId: null,
      before: { status },
      after: { status: 'suspended', revokedSessions: revoked.length },
    });
    const dto = await loadUserDto(ctx.tx, input.userId);
    for (const r of dto.entityRoles) {
      ctx.emit({
        type: 'admin.user.suspended',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: input.userId,
        payload: { revokedSessions: revoked.length },
      });
    }
    return dto;
  },
});

/** `admin.user.reactivate`: a suspended user may sign in again. Anyone else is answered as is. */
export const reactivateUser = defineCommand({
  name: 'admin.user.reactivate',
  permission: 'admin.users.write',
  minScope: 'all',
  input: ReactivateUserInput,
  output: UserDto,
  auditFields: ['status'],
  async handler(ctx, input) {
    if ((await targetStatus(ctx, input.userId)) !== 'suspended') {
      ctx.audit({ aggregateType: 'user', aggregateId: input.userId, entityId: null });
      return loadUserDto(ctx.tx, input.userId);
    }
    await ctx.tx
      .update(schema.users)
      .set({ status: 'active', updatedBy: ctx.principal.id })
      .where(eq(schema.users.id, input.userId));
    ctx.audit({
      aggregateType: 'user',
      aggregateId: input.userId,
      entityId: null,
      before: { status: 'suspended' },
      after: { status: 'active' },
    });
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
