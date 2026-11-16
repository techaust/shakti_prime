import { EVENT_VERSION, MessagingSendJob, type DeliveredEvent } from '@shakti/contracts';

/*
 * A send job and the outbox event it comes from (docs/06-api.md §6), each made from the other, as
 * the render job's are (../pdf/job.ts), kept apart from the sender so the publisher loads none of it.
 */

/** The event a send job comes from. */
export const SEND_EVENT = 'messaging.message.requested';

/** The job the outbox sends for a `messaging.message.requested` event. */
export function sendJobOf(event: DeliveredEvent): MessagingSendJob {
  return MessagingSendJob.parse({
    eventId: event.id,
    entityId: event.entityId,
    messageId: event.payload.messageId,
  });
}

/**
 * The event a job stands for, so the send route claims the job's id as an event worker does
 * (`deliverEvent`), which reads only its id, type and company; the job names no thread, so the
 * message stands in as the aggregate.
 */
export function sendEventOf(job: MessagingSendJob): DeliveredEvent {
  return {
    id: job.eventId,
    sequence: '0',
    type: SEND_EVENT,
    entityId: job.entityId,
    aggregateType: 'whatsapp_message',
    aggregateId: job.messageId,
    payload: { messageId: job.messageId, threadId: job.messageId, kind: 'text', v: EVENT_VERSION },
  };
}
