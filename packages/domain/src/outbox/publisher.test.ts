import { newId } from '@shakti/contracts';
import type * as Contracts from '@shakti/contracts';
import type { ClaimOutbox, OutboxRow, OutboxUpdate } from '@shakti/db';
import { describe, expect, it, vi } from 'vitest';
import { memoryEventPublisher, type EventPublisher } from '../ports/event-publisher';
import { memoryLogger } from '../ports/logger';
import {
  DEAD_LETTER_LOG_IDS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  runOutboxPublisher,
} from './publisher';

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

/**
 * A claim over fixed rows that records the limit asked for and the updates returned; `spent` are
 * the ids the claim dead-lettered because their attempts were used up by runs that died.
 */
function claimOf(rows: OutboxRow[], spent: string[] = []) {
  const seen: { limit?: number; maxAttempts?: number; updates: readonly OutboxUpdate[] } = {
    updates: [],
  };
  const claim: ClaimOutbox = async (limit, deliver, maxAttempts, onDeadLettered) => {
    seen.limit = limit;
    seen.maxAttempts = maxAttempts;
    if (spent.length > 0) onDeadLettered?.(spent);
    const claimed = rows.slice(0, limit);
    seen.updates = claimed.length === 0 ? [] : await deliver(claimed);
    return { claimed: claimed.length, deadLettered: spent };
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
    // The claim dead-letters an event whose runs kept dying once this many attempts are spent.
    expect(seen.maxAttempts).toBe(OUTBOX_MAX_ATTEMPTS);
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

describe('runOutboxPublisher and the events the claim dead-lettered', () => {
  it('counts them with the run’s dead letters and logs a warning with their ids only', async () => {
    const spent = [newId(), newId()];
    const { claim } = claimOf([row()], spent);
    const logger = memoryLogger();
    const counts = await runOutboxPublisher({ claim, publisher: memoryEventPublisher(), logger });
    expect(counts).toEqual({ claimed: 1, published: 1, skipped: 0, failed: 0, deadLettered: 2 });
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        event: 'outbox.no_outcome_dead_lettered',
        fields: { count: 2, ids: spent },
      },
    ]);
  });

  it('counts and logs them when the claim leased nothing else', async () => {
    const spent = [newId()];
    const { claim } = claimOf([], spent);
    const logger = memoryLogger();
    const counts = await runOutboxPublisher({ claim, publisher: memoryEventPublisher(), logger });
    expect(counts).toEqual({ claimed: 0, published: 0, skipped: 0, failed: 0, deadLettered: 1 });
    expect(logger.entries).toHaveLength(1);
  });

  it('names the run’s request id, and at most twenty ids with the full count', async () => {
    const spent = Array.from({ length: 25 }, () => newId());
    const { claim } = claimOf([], spent);
    const logger = memoryLogger();
    await runOutboxPublisher({
      claim,
      publisher: memoryEventPublisher(),
      logger,
      requestId: 'outbox-run-1',
    });
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        event: 'outbox.no_outcome_dead_lettered',
        fields: {
          requestId: 'outbox-run-1',
          count: 25,
          ids: spent.slice(0, DEAD_LETTER_LOG_IDS),
          truncated: true,
        },
      },
    ]);
    expect(DEAD_LETTER_LOG_IDS).toBe(20);
  });

  it('logs them before the delivery, so a delivery that throws does not lose them', async () => {
    const spent = [newId()];
    const claim: ClaimOutbox = async (_limit, deliver, _max, onDeadLettered) => {
      onDeadLettered?.(spent);
      await deliver([row()]);
      throw new Error('the run was cut short');
    };
    const logger = memoryLogger();
    await expect(
      runOutboxPublisher({ claim, publisher: memoryEventPublisher(), logger }),
    ).rejects.toThrow('the run was cut short');
    expect(logger.entries).toEqual([
      expect.objectContaining({
        event: 'outbox.no_outcome_dead_lettered',
        fields: expect.objectContaining({ ids: spent }) as unknown,
      }),
    ]);
  });

  it('logs nothing when the claim dead-lettered nothing', async () => {
    const { claim } = claimOf([row()]);
    const logger = memoryLogger();
    await runOutboxPublisher({ claim, publisher: memoryEventPublisher(), logger });
    expect(logger.entries).toEqual([]);
  });
});

describe('runOutboxPublisher backoff', () => {
  it('makes a failed event due again after the wait for its attempt count', async () => {
    const first = row();
    const later = row({ attempts: 5 });
    const { claim, seen } = claimOf([first, later]);
    await runOutboxPublisher({
      claim,
      publisher: memoryEventPublisher(() => 'http_503'),
      random: () => 0.5,
    });
    expect(seen.updates).toEqual([
      expect.objectContaining({ id: first.id, attempts: 1, retryInSeconds: 60 }),
      expect.objectContaining({ id: later.id, attempts: 6, retryInSeconds: 32 * 60 }),
    ]);
  });

  it('gives a dead letter no next attempt', async () => {
    const tired = row({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const stray = row({ type: 'crm.lead.vanished' });
    const { claim, seen } = claimOf([tired, stray]);
    await runOutboxPublisher({ claim, publisher: memoryEventPublisher(() => 'http_404') });
    expect(seen.updates).toHaveLength(2);
    for (const update of seen.updates) {
      expect(update).toMatchObject({ outcome: 'failed', deadLetter: true });
      expect(update).not.toHaveProperty('retryInSeconds');
    }
  });
});

describe('runOutboxPublisher and its dead letters (docs/design/phase1.md §5.2)', () => {
  it('names every event it dead-lettered, spent by the claim or failed here', async () => {
    const tired = row({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const stray = row({ type: 'crm.lead.vanished' });
    const fine = row();
    const spent = [newId()];
    const { claim } = claimOf([tired, stray, fine], spent);
    const seen: (readonly string[])[] = [];
    const counts = await runOutboxPublisher({
      claim,
      publisher: memoryEventPublisher((e) => (e.id === tired.id ? 'http_404' : undefined)),
      onDeadLettered: (ids) => seen.push(ids),
    });
    expect(counts.deadLettered).toBe(3);
    // The claim's own at once, then the run's once recorded.
    expect(seen).toEqual([spent, [stray.id, tired.id]]);
  });

  it('names the events the claim dead-lettered even when the delivery fails afterwards', async () => {
    const spent = [newId(), newId()];
    const claim: ClaimOutbox = (_limit, _deliver, _max, onDeadLettered) => {
      onDeadLettered?.(spent);
      return Promise.reject(new Error('the record was lost'));
    };
    const seen: (readonly string[])[] = [];
    await expect(
      runOutboxPublisher({
        claim,
        publisher: memoryEventPublisher(),
        onDeadLettered: (ids) => seen.push(ids),
      }),
    ).rejects.toThrow('the record was lost');
    expect(seen).toEqual([spent]);
  });

  it('says nothing when the run dead-lettered nothing', async () => {
    const { claim } = claimOf([row()]);
    const seen: (readonly string[])[] = [];
    await runOutboxPublisher({
      claim,
      publisher: memoryEventPublisher(),
      onDeadLettered: (ids) => seen.push(ids),
    });
    expect(seen).toEqual([]);
  });
});
