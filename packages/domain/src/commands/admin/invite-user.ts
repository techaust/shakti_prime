import { DomainError, InviteUserInput, newId, UserDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadUserDto } from '../../queries/admin/user-dto';
import { insertEntityRoles, resolveEntityRoles } from './shared';

/**
 * `admin.user.invite`: creates the principal, the `invited` user and one role per entity. The
 * server action then asks the auth module for a set-password link and mails it; the first
 * sign-in moves the user to `active`. There is no self sign-up.
 */
export const inviteUser = defineCommand({
  name: 'admin.user.invite',
  permission: 'admin.users.write',
  minScope: 'all',
  input: InviteUserInput,
  output: UserDto,
  async handler(ctx, input) {
    const [taken] = await ctx.tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
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
      locale: input.locale,
      status: 'invited',
      createdBy: ctx.principal.id,
    });
    await insertEntityRoles(ctx, id, rows);

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
