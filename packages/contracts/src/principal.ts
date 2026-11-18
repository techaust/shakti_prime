import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';
import { PermissionGrantSchema } from './permissions';
import { RoleKeySchema } from './roles';

export const PrincipalKindSchema = z.enum(['user', 'agent', 'voice_session', 'system']);
export type PrincipalKind = z.infer<typeof PrincipalKindSchema>;

/**
 * The resolved caller of a command: a user, an agent service principal, a voice session acting
 * as a user, or the system principal the event workers act as. Built by the auth layer (the
 * workers build theirs in `apps/web/src/workers`), carried into `withRequestContext()` and the
 * command runner.
 */
export const PrincipalSchema = z.object({
  id: IdSchema,
  kind: PrincipalKindSchema,
  roleKey: RoleKeySchema,
  entityIds: z.array(EntityIdSchema),
  permissions: z.array(PermissionGrantSchema),
  teamId: IdSchema.optional(),
  /**
   * The user's team in each entity where they have one (AUDIT M24). In All-companies mode
   * `teamId` is unset; a request narrowed to one entity takes that entity's team from here.
   */
  entityTeams: z.array(z.object({ entityId: EntityIdSchema, teamId: IdSchema })).optional(),
  /**
   * For a `voice_session` principal only: the session (its own `principals` row) the speaking
   * person acts through. `id` stays the person's, so every policy and grant reads them as
   * themselves, and the audit row names the session as its actor and the person beside it
   * (docs/07-security.md §3.4).
   */
  voiceSessionId: IdSchema.optional(),
});

export type Principal = z.infer<typeof PrincipalSchema>;
export type PrincipalInput = z.input<typeof PrincipalSchema>;
