import { newId } from '@shakti/contracts';
import type * as Contracts from '@shakti/contracts';
import type { ClaimOutbox, OutboxRow, OutboxUpdate } from '@shakti/db';
import { describe, expect, it, vi } from 'vitest';
import { memoryEventPublisher, type EventPublisher } from '../ports/event-publisher';
import { OUTBOX_BATCH_SIZE, OUTBOX_MAX_ATTEMPTS, runOutboxPublisher } from './publisher';

// Nothing is subscribed in Phase 0, so these tests switch one type on through the catalogue.
vi.mock('@shakti/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof Contracts>();
  return { ...actual, isSubscribed: (type: string) => type === 'crm.lead.created' };
});

let sequence = 0;
function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  sequence += 1;
  return {
    id: newId(),
    sequence: String(sequence),
    entityId: 1,
    type: 'crm.lead.created',
    aggregateType: 'opportunity',
    aggregateId: newId(),
    payload: { v: 1, pipelineKey: 'pump', sourceCode: null, existingAccount: false },
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

/** A claim over fixed rows that records the limit asked for and the updates returned. */
function claimOf(rows: OutboxRow[]) {
  const seen: { limit?: number; updates: readonly OutboxUpdate[] } = { updates: [] };
  const claim: ClaimOutbox = async (limit, deliver) => {
    seen.limit = limit;
    const claimed = rows.slice(0, limit);
    seen.updates = await deliver(claimed);
    return claimed.length;
  };
  return { claim, seen };
}

describe('runOutboxPublisher', () => {
  it('publishes subscribed events in order and marks them delivered', async () => {
    const rows = [row(), row()];
    const { claim, seen } = claimOf(rows);
    const publisher = memoryEventPublisher();
    const counts = await runOutboxPublisher({ claim, publisher });
    expect(counts).toEqual({ claimed: 2, published: 2, skipped: 0, failed: 0, deadLettered: 0 });
    expect(publisher.sent.map((e) => e.id)).toEqual(rows.map((r) => r.id));
    expect(publisher.sent[0]).toEqual({
      id: rows[0]?.id,
      sequence: rows[0]?.sequence,
      type: 'crm.lead.created',
      entityId: 1,
      aggregateType: 'opportunity',
      aggregateId: rows[0]?.aggregateId,
      payload: rows[0]?.payload,
    });
    expect(seen.updates).toEqual(rows.map((r) => ({ id: r.id, outcome: 'published' })));
    expect(seen.limit).toBe(OUTBOX_BATCH_SIZE);
  });

  it('marks an event nobody listens to as delivered without sending it', async () => {
    const quiet = row({ type: 'admin.user.reactivated', payload: { v: 1 } });
    const { claim, seen } = claimOf([quiet]);
    const publisher = memoryEventPublisher();
    const counts = await runOutboxPublisher({ claim, publisher });
    expect(counts).toMatchObject({ claimed: 1, published: 0, skipped: 1 });
    expect(publisher.sent).toEqual([]);
    expect(seen.updates).toEqual([{ id: quiet.id, outcome: 'published' }]);
  });

  it('counts a refused event as one more attempt and keeps a short code', async () => {
    const refused = row({ attempts: 3 });
    const { claim, seen } = claimOf([refused]);
    const publisher = memoryEventPublisher(() => `http_503 ${'x'.repeat(500)}`);
    const counts = await runOutboxPublisher({ claim, publisher });
    expect(counts).toMatchObject({ failed: 1, deadLettered: 0, published: 0 });
    const [update] = seen.updates;
    expect(update).toMatchObject({
      id: refused.id,
      outcome: 'failed',
      attempts: 4,
      deadLetter: false,
    });
    expect(update?.outcome === 'failed' && update.lastError.length).toBe(200);
  });

  it('dead-letters an event on its last allowed attempt', async () => {
    const tired = row({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const { claim, seen } = claimOf([tired]);
    const counts = await runOutboxPublisher({
      claim,
      publisher: memoryEventPublisher(() => 'http_404'),
    });
    expect(counts).toMatchObject({ failed: 1, deadLettered: 1 });
    expect(seen.updates).toEqual([
      {
        id: tired.id,
        outcome: 'failed',
        attempts: OUTBOX_MAX_ATTEMPTS,
        lastError: 'http_404',
        deadLetter: true,
      },
    ]);
  });

  it('fails every event of a call that failed as a whole', async () => {
    const rows = [row(), row()];
    const { claim, seen } = claimOf(rows);
    const publisher: EventPublisher = {
      publish: () => Promise.reject(Object.assign(new Error('slow'), { name: 'TimeoutError' })),
    };
    const counts = await runOutboxPublisher({ claim, publisher });
    expect(counts).toMatchObject({ failed: 2, published: 0 });
    expect(seen.updates.map((u) => u.outcome === 'failed' && u.lastError)).toEqual([
      'TimeoutError',
      'TimeoutError',
    ]);
  });

  it('fails an event the queue did not answer for', async () => {
    const rows = [row(), row()];
    const { claim, seen } = claimOf(rows);
    const publisher: EventPublisher = {
      publish: (events) => Promise.resolve([{ id: events[0]?.id ?? '', ok: true }]),
    };
    await runOutboxPublisher({ claim, publisher });
    expect(seen.updates).toEqual([
      { id: rows[0]?.id, outcome: 'published' },
      expect.objectContaining({ id: rows[1]?.id, outcome: 'failed', lastError: 'no_answer' }),
    ]);
  });

  it('dead-letters at once a row that no longer fits the catalogue', async () => {
    const stray = row({ type: 'crm.lead.vanished' });
    const { claim, seen } = claimOf([stray]);
    const publisher = memoryEventPublisher();
    const counts = await runOutboxPublisher({ claim, publisher });
    expect(counts).toMatchObject({ failed: 1, deadLettered: 1 });
    expect(publisher.sent).toEqual([]);
    expect(seen.updates).toEqual([
      expect.objectContaining({ lastError: 'not_in_catalogue', deadLetter: true, attempts: 1 }),
    ]);
  });

  it('claims no more than the limit it is given', async () => {
    const { claim, seen } = claimOf([row(), row(), row()]);
    const counts = await runOutboxPublisher({ claim, publisher: memoryEventPublisher(), limit: 2 });
    expect(seen.limit).toBe(2);
    expect(counts.claimed).toBe(2);
  });
});
