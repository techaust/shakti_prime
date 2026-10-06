import { EmbeddingsIndexJob, EVENT_VERSION, type DeliveredEvent } from '@shakti/contracts';

/*
 * An index job and the outbox event it comes from (docs/design/phase1.md §8.4, docs/API.md §3.6),
 * each made from the other, as the render job's are (../pdf/job.ts).
 */

/** The event an index job comes from. */
export const INDEX_EVENT = 'knowledge.file.index_requested';

/**
 * The job the outbox sends for a `knowledge.file.index_requested` event: the event's id is the
 * job's idempotency key, its company the one the upload is stored in, its aggregate the vault file.
 */
export function indexJobOf(event: DeliveredEvent): EmbeddingsIndexJob {
  // The job's schema checks the payload's company and sensitivity.
  return EmbeddingsIndexJob.parse({
    eventId: event.id,
    knowledgeFileId: event.aggregateId,
    entityId: event.payload.knowledgeEntityId,
    fileEntityId: event.entityId,
    sensitivity: event.payload.sensitivity,
  });
}

/** The event a job stands for, so the index route claims the job's id as an event worker does. */
export function indexEventOf(job: EmbeddingsIndexJob): DeliveredEvent {
  return {
    id: job.eventId,
    sequence: '0',
    type: INDEX_EVENT,
    entityId: job.fileEntityId,
    aggregateType: 'knowledge_file',
    aggregateId: job.knowledgeFileId,
    payload: {
      knowledgeEntityId: job.entityId,
      sensitivity: job.sensitivity,
      v: EVENT_VERSION,
    },
  };
}
