import type { Principal } from '@shakti/contracts';
import { schema, type RequestContext, type RequestTx } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
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
}

/**
 * Whether a session is live at `now`: not ended, and inside its longest length
 * (`AGENT_DEFAULTS.voice.sessionMaxMinutes`) from its start. A session whose room never closed (it
 * failed to open, or its event was lost) stops being live by itself, so its token cannot be
 * refreshed and no route takes it.
 */
export function voiceSessionLive(
  session: Pick<VoiceSessionFacts, 'startedAt' | 'endedAt'>,
  now: Date,
  sessionMinutes: number = AGENT_DEFAULTS.voice.sessionMaxMinutes,
): boolean {
  return (
    session.endedAt === null &&
    now.getTime() < session.startedAt.getTime() + sessionMinutes * 60_000
  );
}

/** The latest moment a session's token may live to: its longest length from its start. */
export function voiceSessionNotAfter(startedAt: Date): Date {
  return new Date(startedAt.getTime() + AGENT_DEFAULTS.voice.sessionMaxMinutes * 60_000);
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
