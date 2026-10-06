import { EmbeddingsIndexJob, newId, type DeliveredEvent } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { INDEX_EVENT, indexEventOf, indexJobOf } from './job';

function requested(knowledgeEntityId: number | null): DeliveredEvent {
  return {
    id: newId(),
    sequence: '7',
    type: INDEX_EVENT,
    entityId: 3,
    aggregateType: 'knowledge_file',
    aggregateId: newId(),
    payload: { knowledgeEntityId, sensitivity: 'management', v: 1 },
  };
}

describe('an index job and its event', () => {
  it('carries the event id as its key, the vault file, its company and the upload’s company', () => {
    const event = requested(null);
    const job = indexJobOf(event);
    expect(job).toEqual({
      eventId: event.id,
      knowledgeFileId: event.aggregateId,
      entityId: null,
      fileEntityId: 3,
      sensitivity: 'management',
    });
    expect(EmbeddingsIndexJob.safeParse(job).success).toBe(true);
  });

  it('stands for the same event again, so the route claims the event id', () => {
    const event = requested(3);
    const back = indexEventOf(indexJobOf(event));
    expect(back).toMatchObject({
      id: event.id,
      type: INDEX_EVENT,
      entityId: 3,
      aggregateType: 'knowledge_file',
      aggregateId: event.aggregateId,
      payload: { knowledgeEntityId: 3, sensitivity: 'management', v: 1 },
    });
  });

  it('refuses an event whose payload is not a vault file’s', () => {
    const event = { ...requested(1), payload: { sensitivity: 'secret', v: 1 } } as DeliveredEvent;
    expect(() => indexJobOf(event)).toThrow();
  });
});
