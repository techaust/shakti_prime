import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';
import { StaffRoleKeySchema } from '../../roles';

/**
 * Live voice Teach and Ask (docs/03-roadmap-appendix/phase2.md §7.5, BLUEPRINT §9.2, ADR 0010):
 * the commands behind `POST /voice/session`, `POST /voice/token` and LiveKit's events. The tokens
 * themselves never pass through a command or its audit row: each command settles the claims, and
 * the route signs them, as `realtime.token.issue` does.
 */

/**
 * The modes a session may hold (`voice_sessions_mode_check`). Command mode (`VOICE_MODES`'s
 * `command`) comes in Phase 6 with the agents it proposes for, so no session starts in it yet.
 */
export const VOICE_SESSION_MODES = ['teach', 'ask'] as const;
export const VoiceSessionModeSchema = z.enum(VOICE_SESSION_MODES);
export type VoiceSessionMode = z.infer<typeof VoiceSessionModeSchema>;

/**
 * The steps of a spoken turn, each timed per turn (docs/03-roadmap-appendix/phase2.md §9.3):
 * the end of speech detected, the final transcript after it, the model's first sentence, that
 * sentence's first audio, and `first_audio`, what the person waits for in all.
 */
export const VOICE_TURN_STEPS = [
  'end_of_speech',
  'final_transcript',
  'first_sentence',
  'first_speech',
  'first_audio',
] as const;
export const VoiceTurnStepSchema = z.enum(VOICE_TURN_STEPS);
export type VoiceTurnStep = z.infer<typeof VoiceTurnStepSchema>;

const Milliseconds = z.number().int().min(0).max(600_000);

/** A session's turn timings (`voice_sessions.turn_stats_json`): turns and each step's p50 and p95. */
export const VoiceTurnStatsSchema = z
  .object({
    turns: z.number().int().min(0).max(10_000),
    steps: z.partialRecord(
      VoiceTurnStepSchema,
      z.object({ p50Ms: Milliseconds, p95Ms: Milliseconds }).strict(),
    ),
  })
  .strict();
export type VoiceTurnStats = z.infer<typeof VoiceTurnStatsSchema>;

/** The most minutes one session is ever recorded with: a day. */
export const VOICE_SESSION_MAX_RECORDED_MINUTES = 24 * 60;

/**
 * `voice.session.start` (`voice.use`): the person's answer to the recording question is required,
 * so no session starts without it. `entityId` narrows the session to one company; absent, it
 * covers every company the request covers.
 */
export const StartVoiceSessionInput = z
  .object({
    mode: VoiceSessionModeSchema,
    consentRecording: z.boolean(),
    entityId: EntityIdSchema.optional(),
  })
  .strict();
export type StartVoiceSessionInput = z.infer<typeof StartVoiceSessionInput>;

/**
 * What `voice.session.start` settled: the session (whose id names its LiveKit room and its
 * `voice_session` principal), the person, their role and companies for the BOS token's claims,
 * and today's limits. The route makes the room and signs both tokens from it.
 */
export const VoiceSessionGrant = z
  .object({
    sessionId: IdSchema,
    sub: IdSchema,
    bos_role: StaffRoleKeySchema,
    entity_ids: z.array(EntityIdSchema).min(1),
    mode: VoiceSessionModeSchema,
    consentRecording: z.boolean(),
    startedAt: z.iso.datetime(),
    limits: z
      .object({
        minutesRemainingToday: z.number().int().min(0),
        paiseRemainingToday: z.number().int().min(0),
        maxSessionMinutes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type VoiceSessionGrant = z.infer<typeof VoiceSessionGrant>;

/**
 * `voice.session.token` (`voice.use`, run as the session's voice principal): the claims of a new
 * 5-minute BOS token for the session the caller's token names, while that session is live. The
 * session comes from the caller's principal, never from the body, so the call carries no fields.
 */
export const RefreshVoiceTokenInput = z.object({}).strict();
export type RefreshVoiceTokenInput = z.infer<typeof RefreshVoiceTokenInput>;

export const VoiceTokenGrant = z
  .object({
    jti: IdSchema,
    sub: IdSchema,
    sid: IdSchema,
    bos_role: StaffRoleKeySchema,
    entity_ids: z.array(EntityIdSchema).min(1),
    /** The session's longest length from its start: no token of it lives past this. */
    notAfter: z.iso.datetime(),
  })
  .strict();
export type VoiceTokenGrant = z.infer<typeof VoiceTokenGrant>;

/**
 * `voice.session.record` (`voice.session.record`, the platform's): what LiveKit's events and the
 * voice worker's report tell of a session. Every value only moves forward: the end is kept once
 * set, minutes and spend never go down, and turn stats replace the earlier ones only with more
 * turns, so a repeated or late event changes nothing.
 */
export const RecordVoiceSessionInput = z
  .object({
    sessionId: IdSchema,
    endedAt: z.iso.datetime().optional(),
    minutes: z.number().int().min(0).max(VOICE_SESSION_MAX_RECORDED_MINUTES).optional(),
    costPaise: z.number().int().min(0).max(100_000_000).optional(),
    turnStats: VoiceTurnStatsSchema.optional(),
  })
  .strict();
export type RecordVoiceSessionInput = z.infer<typeof RecordVoiceSessionInput>;

export const VOICE_SESSION_RECORD_OUTCOMES = ['recorded', 'unchanged', 'missing'] as const;

export const VoiceSessionRecordDto = z
  .object({
    sessionId: IdSchema,
    outcome: z.enum(VOICE_SESSION_RECORD_OUTCOMES),
    endedAt: z.iso.datetime().nullable(),
    minutes: z.number().int().min(0).nullable(),
    costPaise: z.number().int().min(0),
  })
  .strict();
export type VoiceSessionRecordDto = z.infer<typeof VoiceSessionRecordDto>;
