import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';
import { PermissionGrantSchema } from './permissions';
import { RoleKeySchema } from './roles';

export const PrincipalKindSchema = z.enum(['user', 'agent', 'voice_session']);
export type PrincipalKind = z.infer<typeof PrincipalKindSchema>;

/**
 * The resolved caller of a command: a user, an agent service principal or a voice session acting
 * as a user. Built by the auth layer, carried into `withRequestContext()` and the command runner.
 */
export const PrincipalSchema = z.object({
  id: IdSchema,
  kind: PrincipalKindSchema,
  roleKey: RoleKeySchema,
  entityIds: z.array(EntityIdSchema),
  permissions: z.array(PermissionGrantSchema),
  teamId: IdSchema.optional(),
});

export type Principal = z.infer<typeof PrincipalSchema>;
export type PrincipalInput = z.input<typeof PrincipalSchema>;
