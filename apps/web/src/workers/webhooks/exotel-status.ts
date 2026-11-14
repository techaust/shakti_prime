import {
  CALL_RECORDING_MAX_BYTES,
  IdSchema,
  ProviderCallSidSchema,
  type ExotelCallStatusWebhook,
  type ReportedCallStatus,
} from '@shakti/contracts';
import {
  attachCallRecording,
  callRecordingKey,
  executeCommand,
  executeQuery,
  providerCallForReport,
  recordProviderCall,
  sha256Hex,
  type FileStore,
} from '@shakti/domain';
import { fileStore } from '../../files/store';
import { exotelClient, exotelConfig, type ExotelClient } from '../../integrations/exotel/client';
import { logger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';
import type { WebhookHandled, WebhookHandlerContext } from './registry';

/** What the handler reads besides the report; tests pass their own. */
export interface ExotelStatusDeps {
  /** The account's client, for the recording's copy; undefined when the runtime has none. */
  client: () => ExotelClient | undefined;
  store: () => FileStore | undefined;
}

const defaultDeps: ExotelStatusDeps = {
  client: () => {
    const config = exotelConfig();
    return config === undefined ? undefined : exotelClient(config);
  },
  store: () => fileStore(),
};

/** Exotel's status in the BOS's words; `queued` is the provider holding the call before it rings. */
const STATUS: Record<ExotelCallStatusWebhook['Status'], ReportedCallStatus> = {
  queued: 'ringing',
  'in-progress': 'in_progress',
  completed: 'completed',
  failed: 'failed',
  busy: 'busy',
  'no-answer': 'no_answer',
  canceled: 'canceled',
};

/** An Exotel time (`YYYY-MM-DD HH:mm:ss`, India time) as an instant. */
export function exotelInstant(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return undefined;
  const at = new Date(`${value.replace(' ', 'T')}+05:30`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function seconds(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,5}$/.test(value)) return undefined;
  const n = Number(value);
  return n <= 14_400 ? n : undefined;
}

/** The report's call reference: the signed address's (`bos_ref`), else the echoed `CustomField`. */
function referenceOf(payload: ExotelCallStatusWebhook): string | undefined {
  for (const candidate of [payload.bos_ref, payload.CustomField]) {
    if (typeof candidate === 'string' && IdSchema.safeParse(candidate).success) return candidate;
  }
  return undefined;
}

/**
 * The `exotel_status` handler (docs/03-roadmap-appendix/phase2.md §6.3), run by the webhook worker
 * as `system:workers` with the platform-only `calls.process`:
 * 1. the call is found by the reference the signed status address carried and the CallSid
 *    (`app.provider_call_for_report()`); a report of no call of ours, or of a call that holds
 *    another CallSid, records nothing;
 * 2. the status is recorded in the call's company (`calls.provider_call.record`), which takes the
 *    CallSid when the dial could not, moves the status only forward (a repeated or late report
 *    changes nothing back) and announces the end (`calls.dial.completed`);
 * 3. a completed call's recording is copied from `RecordingUrl` with the account's key into the
 *    file store, under the call's own id so a repeat finds it, and recorded as its
 *    `call_recording` file (`calls.recording.attach`); the link is never kept. A copy that fails is
 *    thrown, so the worker tries the delivery again; the status is then unchanged and only the
 *    copy runs.
 * Logs carry ids and codes only, never a number or the link.
 */
export function exotelStatusHandler(deps: ExotelStatusDeps = defaultDeps) {
  return async (
    payload: ExotelCallStatusWebhook,
    context: Pick<WebhookHandlerContext, 'requestId'>,
  ): Promise<WebhookHandled> => {
    const { requestId } = context;
    const ref = referenceOf(payload);
    const sid = ProviderCallSidSchema.safeParse(payload.CallSid);
    if (ref === undefined || !sid.success) return { entityId: null };
    const found = await executeQuery(
      systemWorkersPrincipal(null),
      { entityIds: [], requestId },
      (ctx) => providerCallForReport(ctx, ref, sid.data),
      { name: 'calls.status.lookup', pool: 'app_user' },
    );
    if (found === undefined) {
      logger.log('warn', 'calls.status_unmatched', { requestId, providerCallId: ref });
      return { entityId: null };
    }
    const entityId = found.entityId;
    const workers = systemWorkersPrincipal(entityId);
    const scope = { entityIds: [entityId], requestId };
    const status = STATUS[payload.Status];
    const end = status !== 'ringing' && status !== 'in_progress';
    const duration =
      seconds(payload.ConversationDuration) ??
      (payload.Legs ?? [])
        .map((leg) => seconds(leg.OnCallDuration))
        .filter((n): n is number => n !== undefined)
        .reduce<number | undefined>((max, n) => (max === undefined ? n : Math.max(max, n)), undefined);
    const answeredAt = status === 'in_progress' ? exotelInstant(payload.DateUpdated) : undefined;
    const endedAt = end ? (exotelInstant(payload.EndTime) ?? exotelInstant(payload.DateUpdated)) : undefined;
    const recorded = await executeCommand(workers, scope, recordProviderCall, {
      entityId,
      providerCallId: ref,
      callSid: sid.data,
      status,
      ...(answeredAt === undefined ? {} : { answeredAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(end && duration !== undefined ? { durationSeconds: duration } : {}),
    });
    if (recorded.outcome === 'other_call' || recorded.outcome === 'missing') return { entityId };

    const link = payload.RecordingUrl;
    if (recorded.status !== 'completed' || link === undefined || link === '' || found.hasRecording) {
      return { entityId };
    }
    const client = deps.client();
    const store = deps.store();
    if (client === undefined || store === undefined) {
      logger.log('warn', 'calls.recording_not_copied', { requestId, providerCallId: ref });
      return { entityId };
    }
    const recording = await client.fetchRecording(link, CALL_RECORDING_MAX_BYTES);
    // The call's own id names its file, so a delivery that runs again stores and records the same one.
    const fileId = ref;
    const key = callRecordingKey(entityId, fileId, recording.contentType);
    await store.put(key, recording.bytes, recording.contentType);
    const attached = await executeCommand(workers, scope, attachCallRecording, {
      entityId,
      providerCallId: ref,
      fileId,
      bucket: store.bucket,
      key,
      contentType: recording.contentType,
      size: recording.bytes.length,
      sha256: sha256Hex(recording.bytes),
    });
    logger.log('info', 'calls.recording_copied', {
      requestId,
      providerCallId: ref,
      outcome: attached.outcome,
    });
    return { entityId };
  };
}

export const handleExotelStatus = exotelStatusHandler();
