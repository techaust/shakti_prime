import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';
import { StaffRoleKeySchema } from '../../roles';

/**
 * `realtime.token.issue` (docs/03-roadmap-appendix/backend-weeks-3-5.md §2.6): the caller sends nothing; who
 * they are and the companies active for the request decide the claims, as the route's empty body
 * (`RealtimeTokenRequest`) does.
 */
export const IssueRealtimeTokenInput = z.object({}).strict();
export type IssueRealtimeTokenInput = z.infer<typeof IssueRealtimeTokenInput>;

/**
 * The claims the command settles for a Realtime token, named as in `RealtimeClaims` (ADR 0003).
 * The issuer, the times, the audience and the signature are added by the route that signs it, so
 * the token itself never passes through the command or its audit row.
 */
export const RealtimeTokenGrant = z
  .object({
    jti: IdSchema,
    sub: IdSchema,
    bos_role: StaffRoleKeySchema,
    entity_ids: z.array(EntityIdSchema).min(1),
  })
  .strict();
export type RealtimeTokenGrant = z.infer<typeof RealtimeTokenGrant>;
