import type { Principal } from '@shakti/contracts';
import { schema, type RequestContext, type RequestTx } from '@shakti/db';
import { and, eq, gte } from 'drizzle-orm';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';

/** A voice session as the token and its checks read it. */
export interface VoiceSessionFacts {
  entityId: number | null;
  entityIds: number[];
  mode: string;
  consentRecording: boolean;
  audioFileId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  /** The session's own longest length, set when it opened. */
  maxMinutes: number;
}

/**
 * Whether a session is live at `now`: not ended, and inside its own longest length from its start
 * (`max_minutes`: a session's longest, `AGENT_DEFAULTS.voice.sessionMaxMinutes`, or the minutes
 * the person had left that day). A session whose room never closed (it failed to open, or its
 * event was lost) stops being live by itself, so its token cannot be refreshed and no route takes
 * it.
 */
export function voiceSessionLive(
  session: Pick<VoiceSessionFacts, 'startedAt' | 'endedAt' | 'maxMinutes'>,
  now: Date,
): boolean {
  return session.endedAt === null && now.getTime() < voiceSessionNotAfter(session).getTime();
}

/** The latest moment a session's token may live to: its own longest length from its start. */
export function voiceSessionNotAfter(
  session: Pick<VoiceSessionFacts, 'startedAt' | 'maxMinutes'>,
): Date {
  return new Date(session.startedAt.getTime() + session.maxMinutes * 60_000);
}

/**
 * The session a voice principal acts through, read under the person's own policy (their own
 * session, in a request covering its companies). Undefined for any other principal, or a session
 * that is not the person's.
 */
export async function voiceSessionOf(
  tx: RequestTx,
  principal: Principal,
): Promise<VoiceSessionFacts | undefined> {
  const sessionId = principal.voiceSessionId;
  if (principal.kind !== 'voice_session' || sessionId === undefined) return undefined;
  const vs = schema.voiceSessions;
  const [session] = await tx
    .select({
      entityId: vs.entityId,
      entityIds: vs.entityIds,
      mode: vs.mode,
      consentRecording: vs.consentRecording,
      audioFileId: vs.audioFileId,
      startedAt: vs.startedAt,
      endedAt: vs.endedAt,
      maxMinutes: vs.maxMinutes,
    })
    .from(vs)
    .where(and(eq(vs.id, sessionId), eq(vs.userId, principal.id)))
    .limit(1);
  return session;
}

/** Whether the voice principal's session is its person's own and live at `now`. */
export async function liveVoiceSession(context: RequestContext, now: Date): Promise<boolean> {
  const session = await voiceSessionOf(context.tx, context.principal);
  return session !== undefined && voiceSessionLive(session, now);
}

/** The voice principal's session while it is its person's own and live; undefined otherwise. */
export async function liveVoiceSessionFacts(
  context: RequestContext,
  now: Date,
): Promise<VoiceSessionFacts | undefined> {
  const session = await voiceSessionOf(context.tx, context.principal);
  return session !== undefined && voiceSessionLive(session, now) ? session : undefined;
}

/**
 * The file of the recording upload begun for the voice principal's session: `files.upload.begin`
 * run under the session's id as its idempotency key (one per session), read from the person's own
 * keys. Undefined for any other principal, or before the upload is begun. The recording's
 * completion takes this file only, never another of the person's uploads.
 */
export async function voiceRecordingUpload(context: RequestContext): Promise<string | undefined> {
  const { principal } = context;
  const sessionId = principal.voiceSessionId;
  if (principal.kind !== 'voice_session' || sessionId === undefined) return undefined;
  const k = schema.idempotencyKeys;
  const [row] = await context.tx
    .select({ response: k.responseJson })
    .from(k)
    .where(
      and(
        eq(k.principalId, principal.id),
        eq(k.key, sessionId),
        eq(k.command, 'files.upload.begin'),
      ),
    )
    .limit(1);
  const response: unknown = row?.response;
  const fileId =
    typeof response === 'object' && response !== null && 'fileId' in response
      ? response.fileId
      : undefined;
  return typeof fileId === 'string' ? fileId : undefined;
}

/** The start of the day in India for an instant, when a person's minutes and spend start again. */
export function voiceDayStart(now: Date): Date {
  const ist = 330 * 60_000;
  const day = 24 * 60 * 60_000;
  return new Date(Math.floor((now.getTime() + ist) / day) * day - ist);
}

/** What `/voice` shows before a session: the person's minutes left today and a session's longest. */
export interface VoiceToday {
  minutesLeft: number;
  sessionMaxMinutes: number;
}

/**
 * The person's own sessions of today in India, read under their policy in the companies they are
 * viewing: the minutes left of `AGENT_DEFAULTS.voice.personDailyMinutes`. `voice.session.start`
 * checks every company again before it opens a session, so this is what the screen shows, never
 * what decides.
 */
export async function voiceToday(context: RequestContext, now: Date): Promise<VoiceToday> {
  const vs = schema.voiceSessions;
  const rows = await context.tx
    .select({
      minutes: vs.minutes,
      startedAt: vs.startedAt,
      maxMinutes: vs.maxMinutes,
    })
    .from(vs)
    .where(and(eq(vs.userId, context.principal.id), gte(vs.startedAt, voiceDayStart(now))));
  // A session still open counts the minutes it has run, at most its own longest length.
  const used = rows.reduce(
    (sum, r) =>
      sum +
      (r.minutes ??
        Math.ceil(Math.min(now.getTime() - r.startedAt.getTime(), r.maxMinutes * 60_000) / 60_000)),
    0,
  );
  const minutesLeft = Math.max(0, AGENT_DEFAULTS.voice.personDailyMinutes - used);
  return {
    minutesLeft,
    sessionMaxMinutes: Math.min(AGENT_DEFAULTS.voice.sessionMaxMinutes, minutesLeft),
  };
}
