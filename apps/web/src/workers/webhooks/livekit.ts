import {
  IdSchema,
  VoiceWorkerReport,
  type LiveKitWebhook,
  type RecordVoiceSessionInput,
} from '@shakti/contracts';
import { executeCommand, recordVoiceSession } from '@shakti/domain';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import type { WebhookHandled, WebhookHandlerContext } from './registry';

/** LiveKit's 64-bit seconds, which protobuf JSON may send as a string, as an instant. */
export function liveKitInstant(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  // A value past the year 3000 is milliseconds or nanoseconds, never a time LiveKit sends here.
  if (seconds > 32_503_680_000) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/** The voice worker's report from its participant's metadata, or undefined when there is none. */
function workerReport(metadata: string | undefined): VoiceWorkerReport | undefined {
  if (metadata === undefined || metadata === '') return undefined;
  try {
    const parsed = VoiceWorkerReport.safeParse(JSON.parse(metadata));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What one event tells of its session: a room that finished ended the session at the event's
 * time; the voice worker leaving the room left its last report (spend, turn timings and, for a
 * recorded Teach session, its vault files). Every other event, and every room the BOS did not
 * name after a session, records nothing.
 */
export function voiceRecordOf(payload: LiveKitWebhook): RecordVoiceSessionInput | undefined {
  const sessionId = IdSchema.safeParse(payload.room?.name);
  if (!sessionId.success) return undefined;
  if (payload.event === 'room_finished') {
    const endedAt = liveKitInstant(payload.createdAt);
    return endedAt === undefined ? undefined : { sessionId: sessionId.data, endedAt };
  }
  // Only the voice worker's report counts: LiveKit marks a dispatched worker's participant as an
  // agent, and the person's join token neither makes them one nor lets them set their metadata.
  if (payload.event === 'participant_left' && payload.participant?.kind === 'AGENT') {
    const report = workerReport(payload.participant.metadata);
    if (report === undefined) return undefined;
    return {
      sessionId: sessionId.data,
      costPaise: report.costPaise,
      turnStats: report.turnStats,
      ...(report.audioFileId === undefined ? {} : { audioFileId: report.audioFileId }),
      ...(report.transcriptFileId === undefined
        ? {}
        : { transcriptFileId: report.transcriptFileId }),
    };
  }
  return undefined;
}

/**
 * The `livekit` handler (docs/03-roadmap-appendix/phase2.md §7.5), run by the webhook worker as
 * `system:workers` with the platform-only `voice.session.record`, with no company, since a session
 * may cover several. A delivery is stored once by LiveKit's event id (`webhook_inbox`), and the
 * record only moves forward, so a repeated or late event changes nothing. Logs carry ids and
 * outcomes only.
 */
export async function handleLiveKit(
  payload: LiveKitWebhook,
  context: Pick<WebhookHandlerContext, 'requestId'>,
): Promise<WebhookHandled> {
  const input = voiceRecordOf(payload);
  if (input === undefined) return { entityId: null };
  const recorded = await executeCommand(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId: context.requestId },
    recordVoiceSession,
    input,
  );
  if (recorded.outcome === 'missing' || !recorded.filesLinked) {
    logger.log('warn', 'voice.record_unmatched', {
      requestId: context.requestId,
      sessionId: input.sessionId,
      outcome: recorded.outcome,
      filesLinked: recorded.filesLinked,
    });
  }
  return { entityId: null };
}
