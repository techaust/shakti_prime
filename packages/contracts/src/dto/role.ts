import { z } from 'zod';
import { IdSchema } from '../ids';
import { PermissionKeySchema, ScopeSchema } from '../permissions';
import { StaffRoleKeySchema } from '../roles';

/** A staff role as Admin › Roles lists it. */
export const RoleSummaryDto = z
  .object({
    id: IdSchema,
    key: StaffRoleKeySchema,
    grantCount: z.number().int().min(0),
    customisedAt: z.iso.datetime().nullable(),
    /** People holding the role in at least one company of the request. */
    holderCount: z.number().int().min(0),
  })
  .strict();
export type RoleSummaryDto = z.infer<typeof RoleSummaryDto>;

export const RoleListDto = z.object({ roles: z.array(RoleSummaryDto) }).strict();
export type RoleListDto = z.infer<typeof RoleListDto>;

/** The fingerprint of a role's grant set (SHA-256 hex), for the editor's optimistic check. */
export const RoleGrantsVersionSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Why the editor shows a permission without a choice: only the Executive role may hold it, only
 * its listed roles may hold a cost permission, or the Executive role always keeps it.
 */
export const ROLE_GRANT_LOCKS = ['executiveOnly', 'costHolders', 'executiveKeeps'] as const;
export const RoleGrantLockSchema = z.enum(ROLE_GRANT_LOCKS);
export type RoleGrantLock = z.infer<typeof RoleGrantLockSchema>;

/**
 * One catalogue permission with the role's scope for it (null when the role lacks it), the scopes
 * the editor offers for it, and why it is locked, if it is.
 */
export const RolePermissionDto = z
  .object({
    key: PermissionKeySchema,
    module: z.string(),
    scope: ScopeSchema.nullable(),
    scopes: z.array(ScopeSchema),
    locked: RoleGrantLockSchema.nullable(),
  })
  .strict();
export type RolePermissionDto = z.infer<typeof RolePermissionDto>;

export const RoleGrantsDto = z
  .object({
    role: RoleSummaryDto,
    permissions: z.array(RolePermissionDto),
    version: RoleGrantsVersionSchema,
    /** Whether the request acts for every active company, which a save needs. */
    groupScope: z.boolean(),
  })
  .strict();
export type RoleGrantsDto = z.infer<typeof RoleGrantsDto>;

export const RoleGrantsQuery = z.object({ roleKey: StaffRoleKeySchema }).strict();
export type RoleGrantsQuery = z.infer<typeof RoleGrantsQuery>;
