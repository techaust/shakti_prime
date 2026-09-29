import { z } from 'zod';
import { IdSchema } from '../../ids';
import { PERMISSION_KEYS, PermissionKeySchema, ScopeSchema } from '../../permissions';

/** One permission of a role at one scope, as the role editor sends it. */
export const RoleGrantInput = z
  .object({
    permission: PermissionKeySchema,
    scope: ScopeSchema,
  })
  .strict();
export type RoleGrantInput = z.infer<typeof RoleGrantInput>;

/**
 * `admin.role.permissions.set`: replaces a staff role's grants as a set (docs/SECURITY.md §3.1).
 * The role key is any text here, so an agent or system role reaches the command and is refused
 * there with its own reason. `keepSessionId` is filled by the server action from the caller's own
 * sign-in, never by the browser: that one session stays signed in when the caller holds the role.
 */
export const SetRolePermissionsInput = z
  .object({
    roleKey: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z_:]+$/),
    grants: z
      .array(RoleGrantInput)
      .max(PERMISSION_KEYS.length)
      .refine((rows) => new Set(rows.map((r) => r.permission)).size === rows.length, {
        message: 'one scope per permission',
      }),
    keepSessionId: IdSchema.optional(),
  })
  .strict();
export type SetRolePermissionsInput = z.infer<typeof SetRolePermissionsInput>;

/**
 * What the role editor learns after a save. `holderUserIds` lets the server action drop the
 * cached access of everyone holding the role; the action keeps it from the browser.
 */
export const RolePermissionsSetDto = z
  .object({
    roleId: IdSchema,
    roleKey: z.string(),
    grantCount: z.number().int().min(0),
    customisedAt: z.iso.datetime().nullable(),
    revokedSessions: z.number().int().min(0),
    holderUserIds: z.array(IdSchema),
  })
  .strict();
export type RolePermissionsSetDto = z.infer<typeof RolePermissionsSetDto>;
