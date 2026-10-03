import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { memoryAlertSink } from '../observability/alerts';
import { failedEventId, holdBackFailure, workerErrorFor } from './outbox-failures';

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

describe('the failure callback, read', () => {
  it('names a final refusal worker_refused and anything else worker_failed', () => {
    for (const status of [400, 403, 404]) expect(workerErrorFor(status)).toBe('worker_refused');
    for (const status of [0, 409, 429, 500, 503])
      expect(workerErrorFor(status)).toBe('worker_failed');
  });

  it('finds the event id in the copy of the event QStash sends back, or none', () => {
    const id = newId();
    expect(failedEventId({ status: 500, sourceBody: base64({ id, type: 'x' }) })).toBe(id);
    expect(failedEventId({ status: 500, sourceBody: base64({ id: 'not an id' }) })).toBeUndefined();
    expect(failedEventId({ status: 500, sourceBody: base64(['list']) })).toBeUndefined();
    expect(failedEventId({ status: 500, sourceBody: 'bm90IGpzb24=' })).toBeUndefined();
  });
});

describe('holdBackFailure', () => {
  it('holds the event back and tells the owner once, with the id only', async () => {
    const id = newId();
    const alerts = memoryAlertSink();
    const held: [string, string][] = [];
    const result = await holdBackFailure(id, 503, {
      requestId: 'r',
      alerts,
      hold: (eventId, lastError) => {
        held.push([eventId, lastError]);
        return Promise.resolve('held');
      },
    });
    expect(result).toEqual({ eventId: id, outcome: 'held', lastError: 'worker_failed' });
    expect(held).toEqual([[id, 'worker_failed']]);
    expect(alerts.alerts).toEqual([
      { name: 'outbox.dead_lettered', fields: { count: 1, ids: [id] } },
    ]);
  });

  it('tells no one when the event was already held back', async () => {
    const alerts = memoryAlertSink();
    const result = await holdBackFailure(newId(), 404, {
      requestId: 'r',
      alerts,
      hold: () => Promise.resolve('unchanged'),
    });
    expect(result).toMatchObject({ outcome: 'unchanged', lastError: 'worker_refused' });
    expect(alerts.alerts).toEqual([]);
  });
});
