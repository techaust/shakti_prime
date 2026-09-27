import { z } from 'zod';
import { EntityIdSchema } from '../ids';
import { StaffRoleKeySchema } from '../roles';
import {
  BaseClaims,
  BosJwtSchema,
  expiresWithin,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
} from './common';

/**
 * `POST /realtime/token` (docs/API.md §3.1, ADR 0003, docs/ARCHITECTURE.md §8): an ES256 JWT for
 * Supabase Realtime private channels, signed with the BOS key pair and verified by Supabase
 * through the BOS's OIDC discovery document and JWKS. It grants Realtime only.
 */
export const RealtimeTokenRequest = z.object({}).strict();
export type RealtimeTokenRequest = z.infer<typeof RealtimeTokenRequest>;

/** Channel names the Realtime policies on `realtime.messages` allow for a holder of the token. */
export const RealtimeChannelSchema = z
  .string()
  .regex(/^(user:[0-9a-f-]{36}|entity:\d{1,5}:(queue|board))$/);

export const RealtimeTokenResponse = z
  .object({
    token: BosJwtSchema,
    expiresAt: z.iso.datetime(),
    /** The channels this caller may join, so the client subscribes without guessing. */
    channels: z.array(RealtimeChannelSchema).min(1),
  })
  .strict();
export type RealtimeTokenResponse = z.infer<typeof RealtimeTokenResponse>;

/**
 * Claims of the Realtime token, exactly as ADR 0003 fixes them. Supabase reads `role` as the
 * Postgres role for its Data API, so it is always `authenticated`, which holds nothing on
 * application objects; the BOS role travels as `bos_role`.
 */
export const RealtimeClaims = BaseClaims.extend({
  aud: z.literal(TOKEN_AUDIENCES.realtime),
  role: z.literal('authenticated'),
  bos_role: StaffRoleKeySchema,
  entity_ids: z.array(EntityIdSchema).min(1),
})
  .strict()
  .refine(...expiresWithin(TOKEN_LIFETIMES.realtimeMax));
export type RealtimeClaims = z.infer<typeof RealtimeClaims>;
