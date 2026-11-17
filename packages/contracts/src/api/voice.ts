import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { VoiceSessionModeSchema } from '../commands/voice/sessions';
import { StaffRoleKeySchema } from '../roles';
import {
  BaseClaims,
  BosJwtSchema,
  expiresWithin,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
} from './common';

/**
 * `POST /voice/session` (docs/06-api.md §2, §3.1; docs/01-blueprint.md §9.2; ADR 0010). Starts a "Talk to
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
        /** Minutes left today under the per-user cap (docs/01-blueprint.md §9.2). */
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

/**
 * `POST /voice/token` (docs/06-api.md §3.1): the voice worker sends its current BOS token as
 * `Authorization: Bearer` before it expires and gets a new one for the same session, while the
 * session is live and its person may still use voice. The call carries no fields.
 */
export const VoiceTokenRequest = z.object({}).strict();
export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequest>;

export const VoiceTokenResponse = z
  .object({
    token: BosJwtSchema,
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;

/** The name the voice worker registers with LiveKit; each session's room asks for it by name. */
export const VOICE_AGENT_NAME = 'shakti-voice';

/**
 * What the BOS hands the voice worker when it makes a session's room (the room's agent dispatch
 * metadata, docs/03-roadmap-appendix/phase2.md §7.5): where to call `/api/v1`, the session's first
 * 5-minute BOS token, its mode and recording answer, and its limits. It holds no other credential;
 * the worker refreshes the token through `POST /voice/token` before it expires.
 */
export const VoiceDispatchMetadata = z
  .object({
    sessionId: IdSchema,
    apiBase: z.url({ protocol: /^https?$/ }),
    bosToken: z.object({ token: BosJwtSchema, expiresAt: z.iso.datetime() }).strict(),
    mode: VoiceSessionModeSchema,
    consentRecording: z.boolean(),
    limits: z
      .object({
        minutesRemainingToday: z.number().int().min(0),
        paiseRemainingToday: z.number().int().min(0),
        maxSessionMinutes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type VoiceDispatchMetadata = z.infer<typeof VoiceDispatchMetadata>;
