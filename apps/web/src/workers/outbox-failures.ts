import {
  IdSchema,
  OutboxFailureResult,
  type OutboxFailureCallback,
  type OutboxWorkerError,
} from '@shakti/contracts';
import { holdBackFailedEvent } from '@shakti/db/outbox';
import { logger } from '../log';
import { sentryAlertSink, type AlertSink } from '../observability/alerts';

/**
 * The largest failure callback taken: QStash sends the event again (at most 4 KiB, in base64), the
 * worker's last answer and the headers of both, well under this.
 */
export const FAILURE_BODY_MAX_BYTES = 64 * 1024;

/** The worker statuses that answer with QStash's no-retry header (a final refusal). */
const REFUSED: ReadonlySet<number> = new Set([400, 403, 404]);

/** `worker_refused` for a final refusal, `worker_failed` for anything after the last retry. */
export function workerErrorFor(status: number): OutboxWorkerError {
  return REFUSED.has(status) ? 'worker_refused' : 'worker_failed';
}

/** The id of the event QStash sent, from the callback's base64 copy of it, when it has one. */
export function failedEventId(callback: OutboxFailureCallback): string | undefined {
  try {
    const sent: unknown = JSON.parse(Buffer.from(callback.sourceBody, 'base64').toString('utf8'));
    if (typeof sent !== 'object' || sent === null || !('id' in sent)) return undefined;
    const id = IdSchema.safeParse(sent.id);
    return id.success ? id.data : undefined;
  } catch {
    return undefined;
  }
}

export interface HoldBackOptions {
  requestId: string;
  alerts?: AlertSink;
  hold?: typeof holdBackFailedEvent;
}

/**
 * Turns an event QStash gave up on back into a dead letter (`holdBackFailedEvent`, as
 * outbox_publisher), so Integration Health lists it and Send again replays it, and tells the
 * owner as a publisher run that dead-letters an event does (`outbox.dead_lettered`).
 */
export async function holdBackFailure(
  eventId: string,
  status: number,
  options: HoldBackOptions,
): Promise<OutboxFailureResult> {
  const lastError = workerErrorFor(status);
  const outcome = await (options.hold ?? holdBackFailedEvent)(eventId, lastError);
  logger.log('warn', 'outbox.worker_gave_up', {
    requestId: options.requestId,
    eventId,
    status,
    lastError,
    outcome,
  });
  if (outcome === 'held') {
    (options.alerts ?? sentryAlertSink).report('outbox.dead_lettered', {
      count: 1,
      ids: [eventId],
    });
  }
  return OutboxFailureResult.parse({ eventId, outcome, lastError });
}
