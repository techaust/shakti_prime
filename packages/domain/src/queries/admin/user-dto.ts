import {
  DomainError,
  StaffRoleKeySchema,
  ThemeSchema,
  UserDto,
  UserStatusSchema,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { asc, eq } from 'drizzle-orm';

/** Reads a user with their entity roles as the admin DTO. Answers `not_found` outside visibility. */
export async function loadUserDto(tx: RequestTx, userId: string): Promise<UserDto> {
  const u = schema.users;
  const [user] = await tx.select().from(u).where(eq(u.id, userId)).limit(1);
  if (!user) {
    throw new DomainError('not_found', `user ${userId} is not visible`, { reason: 'user_missing' });
  }
  const uer = schema.userEntityRoles;
  const rows = await tx
    .select({ entityId: uer.entityId, roleKey: schema.roles.key, teamId: uer.teamId })
    .from(uer)
    .innerJoin(schema.roles, eq(schema.roles.id, uer.roleId))
    .where(eq(uer.userId, userId))
    .orderBy(asc(uer.entityId));
  return UserDto.parse({
    id: user.id,
    email: user.email,
    displayName: user.name,
    phone: user.phone,
    status: UserStatusSchema.parse(user.status),
    theme: ThemeSchema.parse(user.theme),
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    entityRoles: rows.map((r) => ({
      entityId: r.entityId,
      roleKey: StaffRoleKeySchema.parse(r.roleKey),
      teamId: r.teamId,
    })),
    updatedAt: user.updatedAt.toISOString(),
  });
}
