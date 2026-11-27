import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Outbox } from '../src/outbox';
import { tempDir } from './harness';

const DAY = 24 * 60 * 60_000;
let dir: ReturnType<typeof tempDir>;

afterEach(() => {
  dir.remove();
});

describe('the outbox', () => {
  it('keeps pending rows in order, each with its own key, across a reopen', () => {
    dir = tempDir();
    const path = join(dir.dir, 'outbox.sqlite');
    let outbox = new Outbox(path);
    const a = outbox.enqueue({
      kind: 'batch',
      company: 'C',
      fromAlterId: 0,
      maxAlterId: 200,
      body: '{"a":1}',
    });
    const b = outbox.enqueue({
      kind: 'batch',
      company: 'C',
      fromAlterId: 200,
      maxAlterId: 400,
      body: '{"b":2}',
    });
    const s = outbox.enqueue({ kind: 'snapshot', company: 'D', body: '{"s":3}' });
    expect(a.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set([a.idempotencyKey, b.idempotencyKey, s.idempotencyKey]).size).toBe(3);
    outbox.markSent(a.id);
    outbox.noteAttempt(b.id);
    outbox.close();

    outbox = new Outbox(path);
    expect(outbox.pending()).toEqual([
      { ...b, attempts: 1 },
      { ...s, fromAlterId: null, maxAlterId: null },
    ]);
    expect(outbox.depth()).toBe(2);
    outbox.close();
  });

  it('keeps answered rows seven days, and never removes a pending one', () => {
    dir = tempDir();
    let now = Date.UTC(2026, 10, 1);
    const outbox = new Outbox(join(dir.dir, 'outbox.sqlite'), () => now);
    const sent = outbox.enqueue({
      kind: 'batch',
      company: 'C',
      fromAlterId: 0,
      maxAlterId: 1,
      body: '{}',
    });
    const waiting = outbox.enqueue({
      kind: 'batch',
      company: 'C',
      fromAlterId: 1,
      maxAlterId: 2,
      body: '{}',
    });
    outbox.markSent(sent.id);
    now += 7 * DAY - 1;
    expect(outbox.prune(7)).toBe(0);
    now += 2;
    expect(outbox.prune(7)).toBe(1);
    now += 30 * DAY;
    expect(outbox.prune(7)).toBe(0);
    expect(outbox.pending().map((r) => r.id)).toEqual([waiting.id]);
    outbox.close();
  });

  it('sets a company’s pending batches aside, leaving its snapshot and other companies', () => {
    dir = tempDir();
    const outbox = new Outbox(join(dir.dir, 'outbox.sqlite'));
    outbox.enqueue({ kind: 'batch', company: 'C', fromAlterId: 0, maxAlterId: 1, body: '{}' });
    outbox.enqueue({ kind: 'batch', company: 'C', fromAlterId: 1, maxAlterId: 2, body: '{}' });
    const snapshot = outbox.enqueue({ kind: 'snapshot', company: 'C', body: '{}' });
    const other = outbox.enqueue({
      kind: 'batch',
      company: 'D',
      fromAlterId: 0,
      maxAlterId: 1,
      body: '{}',
    });
    expect(outbox.supersedeBatches('C')).toBe(2);
    expect(outbox.pending().map((r) => r.id)).toEqual([snapshot.id, other.id]);
    outbox.setState('snapshot_day:C', '2026-11-27');
    expect(outbox.getState('snapshot_day:C')).toBe('2026-11-27');
    expect(outbox.getState('snapshot_day:D')).toBeUndefined();
    outbox.close();
  });
});
