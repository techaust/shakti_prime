import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { StaffRoleKeySchema } from '../roles';
import {
  BaseClaims,
  BosJwtSchema,
  expiresWithin,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
} from './common';

/**
 * `POST /voice/session` (docs/API.md §2, §3.1; docs/BLUEPRINT.md §9.2; ADR 0010). Starts a "Talk to
 * Shakti" session for an Executive or GM: the LiveKit room and the person's join token, and the
 * 5-minute BOS token the voice worker uses to call `/api/v1` as that person.
 */
export const VOICE_MODES = ['teach', 'ask', 'command'] as const;
export const VoiceModeSchema = z.enum(VOICE_MODES);
export type VoiceMode = z.infer<typeof VoiceModeSchema>;

export const VoiceSessionRequest = z
  .object({
    mode: VoiceModeSchema,
    /** The person's answer to the recording question shown before every session. */
    consentRecording: z.boolean(),
    /** Narrows the session to one company; absent keeps every company the person holds. */
    entityId: EntityIdSchema.optional(),
  })
  .strict();
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequest>;

export const VoiceSessionResponse = z
  .object({
    sessionId: IdSchema,
    livekit: z
      .object({
        url: z.url({ protocol: /^wss$/ }),
        roomName: z.string().min(1).max(100),
        participantToken: z.jwt({ alg: 'HS256' }),
        expiresAt: z.iso.datetime(),
      })
      .strict(),
    /** Handed to the voice worker through the room's dispatch metadata, never shown to the person. */
    bosToken: z
      .object({
        token: BosJwtSchema,
        expiresAt: z.iso.datetime(),
      })
      .strict(),
    limits: z
      .object({
        /** Minutes left today under the per-user cap (docs/BLUEPRINT.md §9.2). */
        minutesRemainingToday: z.number().int().min(0),
        maxSessionMinutes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponse>;

/**
 * Claims of the voice worker's BOS token: `sub` is the speaking person, `sid` the voice session
 * (`principals.kind = voice_session`), so every command runs as the person and is audited with
 * the session. The worker refreshes it through the session while the call lasts.
 */
export const VoiceTokenClaims = BaseClaims.extend({
  aud: z.literal(TOKEN_AUDIENCES.voice),
  sid: IdSchema,
  bos_role: StaffRoleKeySchema,
  entity_ids: z.array(EntityIdSchema).min(1),
})
  .strict()
  .refine(...expiresWithin(TOKEN_LIFETIMES.voice));
export type VoiceTokenClaims = z.infer<typeof VoiceTokenClaims>;
