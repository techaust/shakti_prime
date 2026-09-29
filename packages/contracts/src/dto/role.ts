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

/** One catalogue permission with the role's scope for it, or null when the role lacks it. */
export const RolePermissionDto = z
  .object({
    key: PermissionKeySchema,
    module: z.string(),
    description: z.string(),
    scope: ScopeSchema.nullable(),
  })
  .strict();
export type RolePermissionDto = z.infer<typeof RolePermissionDto>;

export const RoleGrantsDto = z
  .object({
    role: RoleSummaryDto,
    permissions: z.array(RolePermissionDto),
  })
  .strict();
export type RoleGrantsDto = z.infer<typeof RoleGrantsDto>;

export const RoleGrantsQuery = z.object({ roleKey: StaffRoleKeySchema }).strict();
export type RoleGrantsQuery = z.infer<typeof RoleGrantsQuery>;
