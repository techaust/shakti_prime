import { DomainError, InviteUserInput, newId, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { assertUserInScope, insertEntityRoles, resolveEntityRoles } from './shared';

/**
 * `admin.user.invite`: creates the principal, the `invited` user and one role per entity. The
 * server action then asks the auth module for a set-password link and mails it; the first
 * sign-in moves the user to `active`. There is no self sign-up. Inviting someone who is still
 * `invited` answers that user unchanged, so the action sends them a fresh link (AUDIT M26); their
 * roles change through `admin.user.roles.set`.
 */
export const inviteUser = defineCommand({
  name: 'admin.user.invite',
  permission: 'admin.users.write',
  minScope: 'all',
  input: InviteUserInput,
  output: UserDto,
  // Two invites racing for one email: the second loses on the unique key, with the same answer.
  constraintReasons: { users_email_unique: 'invite_email_taken' },
  async handler(ctx, input) {
    const [taken] = await ctx.tx
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
    if (taken?.status === 'invited') {
      await assertUserInScope(ctx, taken.id);
      // A fresh link for someone already invited: recorded, with nothing changed.
      ctx.audit({ aggregateType: 'user', aggregateId: taken.id, entityId: null });
      return loadUserDto(ctx.tx, taken.id);
    }
    if (taken) {
      throw new DomainError('conflict', 'email already belongs to a user', {
        reason: 'invite_email_taken',
      });
    }
    const rows = await resolveEntityRoles(ctx, input.entityRoles);

    const id = newId();
    await ctx.tx.insert(schema.principals).values({
      id,
      kind: 'user',
      displayName: input.displayName,
      createdBy: ctx.principal.id,
    });
    await ctx.tx.insert(schema.users).values({
      id,
      name: input.displayName,
      email: input.email,
      phone: input.phone ?? null,
      status: 'invited',
      createdBy: ctx.principal.id,
    });
    await insertEntityRoles(ctx, id, rows);
    ctx.audit({
      aggregateType: 'user',
      aggregateId: id,
      entityId: null,
      after: {
        displayName: input.displayName,
        email: input.email,
        phone: input.phone ?? null,
        status: 'invited',
        entityRoles: rows,
      },
    });

    for (const r of rows) {
      ctx.emit({
        type: 'admin.user.invited',
        entityId: r.entityId,
        aggregateType: 'user',
        aggregateId: id,
        payload: { roleId: r.roleId },
      });
    }
    return loadUserDto(ctx.tx, id);
  },
});
