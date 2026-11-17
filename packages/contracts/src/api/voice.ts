import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { VoiceSessionModeSchema, VoiceTurnStatsSchema } from '../commands/voice/sessions';
import { AskSourceLabelDto } from '../ask';
import {
  PlaybookAudienceSchema,
  PlaybookDirectiveTypeSchema,
  PlaybookTextSchema,
  PlaybookTitleSchema,
} from '../playbook';
import { StaffRoleKeySchema } from '../roles';
import { FileSha256Schema, MAX_AUDIO_UPLOAD_BYTES } from './files';
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

/** A price per million tokens in US dollars, as `AGENT_DEFAULTS.modelPrices` names it. */
const UsdPerMillion = z.number().min(0).max(1_000);

/**
 * The reply step as the worker runs it: the model, its effort, thinking and answer length, and
 * what it and the speech cost, so the worker counts the session's spend against the person's day.
 */
export const VoiceModelDispatch = z
  .object({
    model: z.string().min(1).max(60),
    effort: z.enum(['low', 'medium', 'high']),
    thinking: z.literal('between_tools').nullable(),
    maxTokens: z.number().int().positive().max(64_000),
    prices: z
      .object({
        input: UsdPerMillion,
        output: UsdPerMillion,
        cacheRead: UsdPerMillion,
        cacheWrite: UsdPerMillion,
      })
      .strict(),
    paisePerUsd: z.number().int().positive(),
    /** Speech to text and back, per minute of the session. */
    speechPaisePerMinute: z.number().int().min(0),
  })
  .strict();
export type VoiceModelDispatch = z.infer<typeof VoiceModelDispatch>;

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
    /** The session's hard end: the worker closes the room by then, whatever else happens. */
    notAfter: z.iso.datetime(),
    limits: z
      .object({
        minutesRemainingToday: z.number().int().min(0),
        paiseRemainingToday: z.number().int().min(0),
        maxSessionMinutes: z.number().int().positive(),
      })
      .strict(),
    /** The reply step's settings and prices, from `AGENT_DEFAULTS` (their one source). */
    model: VoiceModelDispatch,
  })
  .strict();
export type VoiceDispatchMetadata = z.infer<typeof VoiceDispatchMetadata>;

/**
 * What the voice worker reports of its session as its own participant's metadata in the room,
 * which LiveKit's signed `participant_left` event carries to the BOS (`POST /webhooks/livekit`):
 * the spend so far, the turn timings and, for a Teach session the person let be recorded, the
 * vault files of its audio and transcript. The platform records it with `voice.session.record`,
 * where every value only moves forward.
 */
export const VoiceWorkerReport = z
  .object({
    costPaise: z.number().int().min(0).max(100_000_000),
    turnStats: VoiceTurnStatsSchema,
    audioFileId: IdSchema.optional(),
    transcriptFileId: IdSchema.optional(),
  })
  .strict();
export type VoiceWorkerReport = z.infer<typeof VoiceWorkerReport>;

/**
 * `POST /voice/recording` (the voice token): the upload address of a Teach session's recording, a
 * 16-bit WAV of the person's speech, for a session whose person answered yes to the recording
 * question. The bytes go straight to the file store, never through the BOS.
 */
export const VoiceRecordingRequest = z
  .object({
    size: z.number().int().min(1).max(MAX_AUDIO_UPLOAD_BYTES),
    sha256: FileSha256Schema,
  })
  .strict();
export type VoiceRecordingRequest = z.infer<typeof VoiceRecordingRequest>;

/** `POST /voice/recording/complete`: the recording landed; it is filed and linked. */
export const VoiceRecordingCompleteRequest = z.object({ fileId: IdSchema }).strict();
export type VoiceRecordingCompleteRequest = z.infer<typeof VoiceRecordingCompleteRequest>;

export const VoiceRecordingCompleteResponse = z
  .object({
    fileId: IdSchema,
    knowledgeFileId: IdSchema,
    /** False when the session kept another recording, or none may be kept. */
    linked: z.boolean(),
  })
  .strict();
export type VoiceRecordingCompleteResponse = z.infer<typeof VoiceRecordingCompleteResponse>;

/** The room's data channel topic the worker and the `/voice` page speak on. */
export const VOICE_DATA_TOPIC = 'shakti';

/** What the voice worker is doing, as the listening light shows it. */
export const VOICE_STATES = ['listening', 'thinking', 'speaking', 'push_to_talk'] as const;
export const VoiceStateSchema = z.enum(VOICE_STATES);
export type VoiceState = z.infer<typeof VoiceStateSchema>;

/** Why a session ended, as the page says it. */
export const VOICE_END_REASONS = ['time_up', 'day_limit', 'ended', 'failed'] as const;

/** A drafted Playbook directive the person saves with one tap (`knowledge.playbook.draft`). */
export const VoiceDraft = z
  .object({
    id: IdSchema,
    type: PlaybookDirectiveTypeSchema,
    audience: PlaybookAudienceSchema,
    title: PlaybookTitleSchema,
    text: PlaybookTextSchema,
  })
  .strict();
export type VoiceDraft = z.infer<typeof VoiceDraft>;

/**
 * What the worker sends the page (`VOICE_DATA_TOPIC`): captions as the words come, the light,
 * Ask's cited records, Teach's drafts, the minutes left and the end. Captions are Roman script.
 */
export const VoiceRoomMessage = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('caption'),
      speaker: z.enum(['person', 'shakti']),
      text: z.string().min(1).max(2_000),
      final: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('state'), state: VoiceStateSchema }).strict(),
  z.object({ type: z.literal('cards'), cards: z.array(AskSourceLabelDto).max(50) }).strict(),
  z.object({ type: z.literal('draft'), draft: VoiceDraft }).strict(),
  z
    .object({ type: z.literal('minutes'), minutesLeft: z.number().int().min(0).max(1_440) })
    .strict(),
  z.object({ type: z.literal('ended'), reason: z.enum(VOICE_END_REASONS) }).strict(),
]);
export type VoiceRoomMessage = z.infer<typeof VoiceRoomMessage>;

/**
 * What the page sends the worker: a typed question when the network is too weak for speech, and
 * push-to-talk, held while the person speaks.
 */
export const VoicePageMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ type: z.literal('push_to_talk'), held: z.boolean() }).strict(),
]);
export type VoicePageMessage = z.infer<typeof VoicePageMessage>;
