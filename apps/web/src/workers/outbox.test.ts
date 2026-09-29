import { newId, type DeliveredEvent } from '@shakti/contracts';
import type { ClaimOutbox, OutboxRow, OutboxUpdate } from '@shakti/db';
import { memoryEventPublisher, memoryKeyValue, type EventPublisher } from '@shakti/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAlertSink } from '../observability/alerts';

/** The rows the next claim hands out, and what the run recorded for them. */
const outbox = vi.hoisted(() => ({
  rows: [] as OutboxRow[],
  updates: [] as readonly OutboxUpdate[],
  fail: undefined as Error | undefined,
}));

vi.mock('@shakti/db/outbox', () => ({
  claimOutbox: (async (limit, deliver) => {
    if (outbox.fail !== undefined) throw outbox.fail;
    const claimed = outbox.rows.slice(0, limit);
    outbox.updates = claimed.length === 0 ? [] : await deliver(claimed);
    return { claimed: claimed.length, deadLettered: [] };
  }) satisfies ClaimOutbox,
  checkOutboxReady: () => Promise.resolve('ok'),
}));

const { ALERT_IDS, FAILING_RUNS_ALERT, inProcessEventPublisher, lastPublisherRun, publishOutbox } =
  await import('./outbox');

let sequence = 0;
function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  sequence += 1;
  return {
    id: newId(),
    sequence: String(sequence),
    entityId: 1,
    type: 'platform.probe.requested',
    aggregateType: 'delivery_probe',
    aggregateId: newId(),
    payload: { v: 1, requestedAt: '2026-09-29T10:00:00.000Z' },
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

const refusing: EventPublisher = memoryEventPublisher(() => 'queue_refused');

beforeEach(() => {
  outbox.rows = [];
  outbox.updates = [];
  outbox.fail = undefined;
});

describe('publishOutbox and the outbox alerts (docs/design/phase1.md §5.2)', () => {
  it('reports every event a run dead-lettered, with counts and ids only', async () => {
    const tired = Array.from({ length: 25 }, () => row({ attempts: 9 }));
    outbox.rows = tired;
    const alerts = memoryAlertSink();
    const counts = await publishOutbox({
      publisher: refusing,
      keyValue: memoryKeyValue(),
      alerts,
    });
    expect(counts.deadLettered).toBe(25);
    expect(alerts.alerts).toEqual([
      {
        name: 'outbox.dead_lettered',
        fields: { count: 25, ids: tired.slice(0, ALERT_IDS).map((r) => r.id) },
      },
    ]);
  });

  it('reports once when a third run in a row delivers nothing, and resets after a delivery', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    const failingRun = async () => {
      outbox.rows = [row()];
      await publishOutbox({ publisher: refusing, keyValue, alerts });
    };
    await failingRun();
    await failingRun();
    expect(alerts.alerts).toEqual([]);
    await failingRun();
    expect(alerts.alerts).toEqual([
      { name: 'outbox.publisher_failing', fields: { runs: FAILING_RUNS_ALERT, failed: 1 } },
    ]);
    await failingRun();
    expect(alerts.alerts).toHaveLength(1);

    outbox.rows = [row()];
    await publishOutbox({ publisher: memoryEventPublisher(), keyValue, alerts });
    await failingRun();
    await failingRun();
    expect(alerts.alerts).toHaveLength(1);
    await failingRun();
    expect(alerts.alerts).toHaveLength(2);
  });

  it('counts a run that throws as failing, and a run with nothing to send as neither', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    outbox.fail = new Error('the database is away');
    for (let i = 0; i < 2; i += 1) {
      await expect(publishOutbox({ publisher: refusing, keyValue, alerts })).rejects.toThrow();
    }
    outbox.fail = undefined;
    outbox.rows = [];
    await publishOutbox({ publisher: refusing, keyValue, alerts });
    expect(alerts.alerts).toEqual([]);
    outbox.rows = [row()];
    await publishOutbox({ publisher: refusing, keyValue, alerts });
    expect(alerts.alerts.map((a) => a.name)).toEqual(['outbox.publisher_failing']);
  });

  it('keeps the last run’s counts for Integration Health', async () => {
    const keyValue = memoryKeyValue();
    outbox.rows = [row()];
    await publishOutbox({
      publisher: memoryEventPublisher(),
      keyValue,
      alerts: memoryAlertSink(),
      now: () => new Date('2026-09-29T10:00:00.000Z'),
    });
    expect(await lastPublisherRun(keyValue)).toEqual({
      at: '2026-09-29T10:00:00.000Z',
      claimed: 1,
      published: 1,
      skipped: 0,
      failed: 0,
      deadLettered: 0,
    });
  });

  it('runs even when the store is away, and says so only in the log', async () => {
    const down = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
      incr: () => Promise.reject(new Error('down')),
      setIfAbsent: () => Promise.reject(new Error('down')),
      raiseTo: () => Promise.reject(new Error('down')),
    };
    outbox.rows = [row()];
    const alerts = memoryAlertSink();
    await expect(
      publishOutbox({ publisher: refusing, keyValue: down, alerts }),
    ).resolves.toMatchObject({ failed: 1 });
    expect(alerts.alerts).toEqual([]);
  });
});

describe('inProcessEventPublisher (no queue: local development and CI)', () => {
  it('delivers a subscribed event to its worker in this process', async () => {
    const keyValue = memoryKeyValue();
    const event = row();
    outbox.rows = [event];
    const counts = await publishOutbox({
      publisher: inProcessEventPublisher(keyValue),
      keyValue,
      alerts: memoryAlertSink(),
    });
    expect(counts).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    expect(await keyValue.get(`evt:${event.id}`)).toBe('done');
    expect(await keyValue.get(`probe:${event.aggregateId}`)).toContain('arrivedAt');
  });

  it('fails an event whose worker failed, with the worker’s code, for a later retry', async () => {
    const keyValue = memoryKeyValue();
    const publisher = inProcessEventPublisher(keyValue);
    const broken: DeliveredEvent = {
      id: newId(),
      sequence: '7',
      type: 'platform.probe.requested',
      entityId: 1,
      aggregateType: 'delivery_probe',
      aggregateId: newId(),
      payload: { v: 1 },
    };
    expect(await publisher.publish([broken])).toEqual([
      { id: broken.id, ok: false, error: 'validation_failed' },
    ]);
  });
});
