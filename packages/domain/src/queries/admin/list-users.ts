import {
  ListSessionsInput,
  ListUsersInput,
  SessionListDto,
  StaffRoleKeySchema,
  ThemeSchema,
  UserCursorSchema,
  UserDto,
  UserPageDto,
  UserStatusSchema,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, exists, gt, inArray, or } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type AdminContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * Admin › Team members (`admin.users.write` at group scope, the permission every admin command
 * needs): staff who hold a role in a company of the request, by name, a page at a time. RLS
 * lets only user administrators read other people's rows; this check refuses the rest first.
 */
export async function listUsers(ctx: AdminContext, rawInput: unknown): Promise<UserPageDto> {
  const input = parseQueryInput(ListUsersInput, rawInput, 'admin.users.list');
  checkPermission(ctx.principal, 'admin.users.write', 'all');
  const after =
    input.cursor === undefined ? undefined : decodeCursor(UserCursorSchema, input.cursor);
  const u = schema.users;
  const uer = schema.userEntityRoles;

  const rows = await ctx.tx
    .select()
    .from(u)
    .where(
      and(
        exists(
          ctx.tx
            .select({ one: uer.id })
            .from(uer)
            .where(and(eq(uer.userId, u.id), inArray(uer.entityId, [...ctx.entityIds]))),
        ),
        after === undefined
          ? undefined
          : or(gt(u.name, after.name), and(eq(u.name, after.name), gt(u.id, after.id))),
      ),
    )
    .orderBy(asc(u.name), asc(u.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const roles =
    page.length === 0
      ? []
      : await ctx.tx
          .select({
            userId: uer.userId,
            entityId: uer.entityId,
            roleKey: schema.roles.key,
            teamId: uer.teamId,
          })
          .from(uer)
          .innerJoin(schema.roles, eq(schema.roles.id, uer.roleId))
          .where(
            inArray(
              uer.userId,
              page.map((r) => r.id),
            ),
          )
          .orderBy(asc(uer.entityId));
  const last = page.at(-1);
  return UserPageDto.parse({
    items: page.map((user) =>
      UserDto.parse({
        id: user.id,
        email: user.email,
        displayName: user.name,
        phone: user.phone,
        status: UserStatusSchema.parse(user.status),
        theme: ThemeSchema.parse(user.theme),
        twoFactorEnabled: user.twoFactorEnabled,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        entityRoles: roles
          .filter((r) => r.userId === user.id)
          .map((r) => ({
            entityId: r.entityId,
            roleKey: StaffRoleKeySchema.parse(r.roleKey),
            teamId: r.teamId,
          })),
        updatedAt: user.updatedAt.toISOString(),
      }),
    ),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ name: last.name, id: last.id })
        : null,
  });
}

/**
 * One person's sign-ins, newest first, for Admin › Team members, so an Executive can end one
 * (`admin.session.revoke`). The token column is never selected; `app_user` has no grant on it.
 */
export async function listUserSessions(
  ctx: AdminContext,
  rawInput: unknown,
): Promise<SessionListDto> {
  const input = parseQueryInput(ListSessionsInput, rawInput, 'admin.sessions.list');
  checkPermission(ctx.principal, 'admin.users.write', 'all');
  const s = schema.sessions;
  const rows = await ctx.tx
    .select({
      id: s.id,
      userId: s.userId,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      revokedReason: s.revokedReason,
    })
    .from(s)
    .where(eq(s.userId, input.userId))
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(50);
  return SessionListDto.parse(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
    })),
  );
}
