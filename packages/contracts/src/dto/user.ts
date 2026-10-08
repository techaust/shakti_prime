import { z } from 'zod';
import { SessionRevokeReasonSchema, ThemeSchema, UserStatusSchema } from '../auth/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { StaffRoleKeySchema } from '../roles';

/** One role per entity for a user (docs/05-database.md §6.1 `user_entity_roles`). */
export const EntityRoleDto = z
  .object({
    entityId: EntityIdSchema,
    roleKey: StaffRoleKeySchema,
    teamId: IdSchema.nullable(),
  })
  .strict();
export type EntityRoleDto = z.infer<typeof EntityRoleDto>;

/** A staff user as admin screens see them. No password, secret or token field exists here. */
export const UserDto = z
  .object({
    id: IdSchema,
    email: z.string(),
    displayName: z.string(),
    phone: z.string().nullable(),
    status: UserStatusSchema,
    theme: ThemeSchema,
    twoFactorEnabled: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    entityRoles: z.array(EntityRoleDto),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type UserDto = z.infer<typeof UserDto>;

/**
 * What `admin.user.two_factor.reset` reports: the user as they are now, and whether this call
 * removed an authenticator app, decided in the command's own transaction, so the action emails
 * the user only when there was one to remove.
 */
export const TwoFactorResetDto = z
  .object({
    user: UserDto,
    authenticatorRemoved: z.boolean(),
  })
  .strict();
export type TwoFactorResetDto = z.infer<typeof TwoFactorResetDto>;

/** A session as the admin sessions screen sees it. The token column is never selected. */
export const SessionDto = z
  .object({
    id: IdSchema,
    userId: IdSchema,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    revokedReason: SessionRevokeReasonSchema.nullable(),
  })
  .strict();
export type SessionDto = z.infer<typeof SessionDto>;

/** What `admin.session.revoke` and the session-revoking admin commands report back. */
export const RevokedSessionsDto = z
  .object({
    userId: IdSchema,
    revokedSessionIds: z.array(IdSchema),
  })
  .strict();
export type RevokedSessionsDto = z.infer<typeof RevokedSessionsDto>;
