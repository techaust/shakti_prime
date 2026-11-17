import {
  DomainError,
  isStaffRole,
  newId,
  RecordVoiceSessionInput,
  RefreshVoiceTokenInput,
  StartVoiceSessionInput,
  VOICE_SESSION_RECORD_OUTCOMES,
  VoiceSessionGrant,
  VoiceSessionRecordDto,
  VoiceTokenGrant,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';
import { defineCommand } from '../../command/define-command';
import {
  voiceSessionLive,
  voiceSessionNotAfter,
  voiceSessionOf,
} from '../../queries/voice/sessions';

// Live voice Teach and Ask (docs/03-roadmap-appendix/phase2.md §7.5, BLUEPRINT §9.2, ADR 0010).
// A session is opened by its person through `app.voice_session_open()`, which checks the day's
// limits across every company, and recorded by the platform through `app.record_voice_session()`;
// no request role writes `voice_sessions` otherwise. The tokens are signed by the routes from what
// these commands settle, so no token passes through a command, its audit row or its key.

const toIso = (value: Date | string): string => new Date(value).toISOString();

/** The day's limits of one person (question 12 (a)), named in `AGENT_DEFAULTS.voice`. */
const LIMITS = {
  dayMinutes: AGENT_DEFAULTS.voice.personDailyMinutes,
  dayPaise: AGENT_DEFAULTS.voice.personDailyCapPaise,
  sessionMinutes: AGENT_DEFAULTS.voice.sessionMaxMinutes,
};

interface OpenedRow {
  outcome: string;
  minutes_used: number;
  paise_used: number;
  started_at: Date | string | null;
  max_minutes: number | null;
  ended_sessions: string[] | null;
}

/**
 * `voice.session.start` (`voice.use`, for people only): opens a "Talk to Shakti" session for the
 * person themselves, in one company or every company of the request, after their answer to the
 * recording question (the input requires it, so no session starts without one). The person's
 * earlier session still open ends (the route then deletes its room), then their minutes and spend
 * of the day in India are read across every company; at either limit nothing is written and the
 * answer is `voice_cap_reached`. The session keeps its own longest length: a session's longest,
 * or the minutes the person has left today when fewer.
 * Command mode is not offered until Phase 6, so the input names Teach or Ask only.
 */
export const startVoiceSession = defineCommand({
  name: 'voice.session.start',
  permission: 'voice.use',
  minScope: 'all',
  peopleOnly: true,
  input: StartVoiceSessionInput,
  output: VoiceSessionGrant,
  auditFields: ['mode', 'consentRecording'],
  async handler(ctx, input) {
    const { principal } = ctx;
    if (!isStaffRole(principal.roleKey)) {
      throw new DomainError('forbidden', 'only a person of the staff may talk to Shakti');
    }
    if (input.entityId !== undefined && !ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    const entityIds =
      input.entityId === undefined
        ? [...new Set(ctx.entityIds)].sort((a, b) => a - b)
        : [input.entityId];
    if (entityIds.length === 0) {
      throw new DomainError('forbidden', 'a voice session needs a company in scope');
    }
    const sessionId = newId();
    const rows = (await ctx.tx.execute(sql`
      select outcome, minutes_used, paise_used, started_at, max_minutes, ended_sessions
        from app.voice_session_open(${sessionId}::uuid,
                                    ${`{${entityIds.join(',')}}`}::smallint[],
                                    ${input.mode}::text, ${input.consentRecording}::boolean,
                                    ${LIMITS.dayMinutes}::integer, ${LIMITS.dayPaise}::integer,
                                    ${LIMITS.sessionMinutes}::integer)`)) as unknown as OpenedRow[];
    const [row] = rows;
    if (!row) throw new DomainError('internal', 'opening a voice session answered no row');
    if (row.outcome === 'cap_reached') {
      throw new DomainError('forbidden', 'the day’s voice minutes or spend are used up', {
        reason: 'voice_cap_reached',
      });
    }
    if (row.outcome !== 'started' || row.started_at === null || row.max_minutes === null) {
      throw new DomainError('internal', `unknown voice session outcome ${row.outcome}`);
    }
    const startedAt = new Date(row.started_at);
    const maxMinutes = row.max_minutes;
    const minutesRemainingToday = Math.max(0, LIMITS.dayMinutes - row.minutes_used);
    const entityId = entityIds.length === 1 ? (entityIds[0] ?? null) : null;
    ctx.audit({
      aggregateType: 'voice_session',
      aggregateId: sessionId,
      entityId,
      after: { mode: input.mode, consentRecording: input.consentRecording, entityIds },
    });
    return {
      sessionId,
      sub: principal.id,
      bos_role: principal.roleKey,
      entity_ids: entityIds,
      mode: input.mode,
      consentRecording: input.consentRecording,
      startedAt: startedAt.toISOString(),
      notAfter: voiceSessionNotAfter({ startedAt, maxMinutes }).toISOString(),
      limits: {
        minutesRemainingToday,
        paiseRemainingToday: Math.max(0, LIMITS.dayPaise - row.paise_used),
        maxSessionMinutes: maxMinutes,
      },
      endedSessionIds: row.ended_sessions ?? [],
    };
  },
});

/**
 * `voice.session.token` (`voice.use`, run as the session's voice principal): the claims of a new
 * BOS token for the session the caller acts through, while it is live and is the caller's own.
 * A person's own session, an agent or the system has no session to refresh; an ended session or
 * one past its longest length is refused (`voice_session_ended`), so the worker stops.
 */
export const refreshVoiceToken = defineCommand({
  name: 'voice.session.token',
  permission: 'voice.use',
  minScope: 'all',
  input: RefreshVoiceTokenInput,
  output: VoiceTokenGrant,
  auditFields: ['bosRole'],
  async handler(ctx) {
    const { principal } = ctx;
    const sessionId = principal.voiceSessionId;
    if (principal.kind !== 'voice_session' || sessionId === undefined) {
      throw new DomainError('forbidden', 'only a voice session refreshes its token');
    }
    if (!isStaffRole(principal.roleKey)) {
      throw new DomainError('forbidden', 'only a person of the staff may talk to Shakti');
    }
    const session = await voiceSessionOf(ctx.tx, principal);
    if (session === undefined || !voiceSessionLive(session, ctx.now)) {
      throw new DomainError('forbidden', 'the voice session has ended', {
        reason: 'voice_session_ended',
      });
    }
    const jti = newId();
    ctx.audit({
      aggregateType: 'voice_session',
      aggregateId: sessionId,
      entityId: session.entityId,
      after: { bosRole: principal.roleKey },
    });
    return {
      jti,
      sub: principal.id,
      sid: sessionId,
      bos_role: principal.roleKey,
      entity_ids: [...session.entityIds].sort((a, b) => a - b),
      notAfter: voiceSessionNotAfter(session).toISOString(),
    };
  },
});

interface RecordedRow {
  outcome: string;
  entity_id: number | null;
  user_id: string | null;
  ended_at: Date | string | null;
  minutes: number | null;
  cost_paise: number | null;
  files_linked: boolean;
}

/**
 * `voice.session.record` (the platform's `voice.session.record`): what LiveKit's events and the
 * worker's report tell of a session (its end, minutes, spend and turn timings), through
 * `app.record_voice_session()`, where each value only moves forward, so a repeated or late event
 * changes nothing. A session may cover several companies, so the platform records it with no
 * company of its own. Audited only when something moved.
 */
export const recordVoiceSession = defineCommand({
  name: 'voice.session.record',
  permission: 'voice.session.record',
  minScope: 'all',
  input: RecordVoiceSessionInput,
  output: VoiceSessionRecordDto,
  auditFields: ['endedAt', 'minutes', 'costPaise', 'turns'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select outcome, entity_id, user_id, ended_at, minutes, cost_paise, files_linked
        from app.record_voice_session(${input.sessionId}::uuid,
                                      ${input.endedAt ?? null}::timestamptz,
                                      ${input.minutes ?? null}::integer,
                                      ${input.costPaise ?? null}::integer,
                                      ${input.turnStats === undefined ? null : JSON.stringify(input.turnStats)}::jsonb,
                                      ${input.audioFileId ?? null}::uuid,
                                      ${input.transcriptFileId ?? null}::uuid)`)) as unknown as RecordedRow[];
    const [row] = rows;
    if (!row) throw new DomainError('internal', 'the voice session record answered no row');
    const outcome = VOICE_SESSION_RECORD_OUTCOMES.find((o) => o === row.outcome);
    if (outcome === undefined) {
      throw new DomainError('internal', `unknown voice record outcome ${row.outcome}`);
    }
    const endedAt = row.ended_at === null ? null : toIso(row.ended_at);
    if (outcome === 'recorded') {
      ctx.audit({
        aggregateType: 'voice_session',
        aggregateId: input.sessionId,
        entityId: null,
        after: {
          endedAt,
          minutes: row.minutes,
          costPaise: row.cost_paise,
          ...(input.turnStats === undefined ? {} : { turns: input.turnStats.turns }),
          // The files only when they were linked, as the row now holds them.
          ...(row.files_linked && input.audioFileId !== undefined
            ? { audioFileId: input.audioFileId }
            : {}),
          ...(row.files_linked && input.transcriptFileId !== undefined
            ? { transcriptFileId: input.transcriptFileId }
            : {}),
        },
      });
    }
    return {
      sessionId: input.sessionId,
      outcome,
      endedAt,
      minutes: row.minutes,
      costPaise: row.cost_paise ?? 0,
      filesLinked: row.files_linked,
    };
  },
});
