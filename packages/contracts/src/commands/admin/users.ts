import { z } from 'zod';
import { EmailSchema } from '../../auth/enums';
import { E164Schema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';
import { LocaleSchema } from '../../principal';
import { StaffRoleKeySchema } from '../../roles';

/** One role per entity. A user without a row for an entity cannot see it at all. */
export const EntityRoleInput = z
  .object({
    entityId: EntityIdSchema,
    roleKey: StaffRoleKeySchema,
    teamId: IdSchema.optional(),
  })
  .strict();
export type EntityRoleInput = z.infer<typeof EntityRoleInput>;

const EntityRolesInput = z
  .array(EntityRoleInput)
  .min(1)
  .max(32)
  .refine((rows) => new Set(rows.map((r) => r.entityId)).size === rows.length, {
    message: 'one role per entity',
  });

/**
 * `admin.user.invite`: creates a staff user in `invited` status with a role per entity. The
 * server action then sends the set-password link; the first sign-in activates the user.
 */
export const InviteUserInput = z
  .object({
    email: EmailSchema,
    displayName: z.string().trim().min(2).max(120),
    phone: E164Schema.optional(),
    locale: LocaleSchema.default('en'),
    entityRoles: EntityRolesInput,
  })
  .strict();
export type InviteUserInput = z.infer<typeof InviteUserInput>;

/** `admin.user.role.set`: replaces every entity role of a user and signs them out everywhere. */
export const SetUserRolesInput = z
  .object({
    userId: IdSchema,
    entityRoles: EntityRolesInput,
  })
  .strict();
export type SetUserRolesInput = z.infer<typeof SetUserRolesInput>;

/** `admin.user.suspend`: blocks sign-in and revokes every session. Reversible with reactivate. */
export const SuspendUserInput = z
  .object({
    userId: IdSchema,
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type SuspendUserInput = z.infer<typeof SuspendUserInput>;

/** `admin.user.reactivate`: a suspended user may sign in again. */
export const ReactivateUserInput = z
  .object({
    userId: IdSchema,
  })
  .strict();
export type ReactivateUserInput = z.infer<typeof ReactivateUserInput>;

/** `admin.session.revoke`: forces one session out. The system reasons are never set by hand. */
export const RevokeSessionInput = z
  .object({
    sessionId: IdSchema,
    reason: z.literal('admin').default('admin'),
  })
  .strict();
export type RevokeSessionInput = z.infer<typeof RevokeSessionInput>;
