import { describe, expect, it } from 'vitest';
import {
  formatMs,
  markdownTable,
  openLoopOffsets,
  percentiles,
  sendLag,
  shareWithin,
  storedOnce,
  verdict,
} from './stats';

// The G2 measures' arithmetic (docs/03-roadmap-appendix/phase2.md §8.1 and §14).

describe('percentiles', () => {
  it('takes p50, p95 and p99 by nearest rank, as the speech benchmark does', () => {
    // 1..100: the nth percentile by nearest rank is n itself.
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentiles(values)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, min: 1, max: 100 });
  });

  it('reads a small sample without interpolating', () => {
    // Ranks: p50 ceil(2.5) = 3rd, p95 and p99 ceil(4.75) and ceil(4.95) = 5th.
    expect(percentiles([40, 10, 30, 20, 1000])).toEqual({
      n: 5,
      p50: 30,
      p95: 1000,
      p99: 1000,
      min: 10,
      max: 1000,
    });
  });

  it('keeps one decimal place for sub-millisecond figures', () => {
    expect(percentiles([0.04, 0.26, 0.31]).p50).toBe(0.3);
  });

  it('answers NaN for every stat with no sample', () => {
    const none = percentiles([]);
    expect(none.n).toBe(0);
    for (const stat of [none.p50, none.p95, none.p99, none.min, none.max]) {
      expect(Number.isNaN(stat)).toBe(true);
    }
  });

  it('handles a sample far larger than the spread operator could take', () => {
    const values = Array.from({ length: 200_000 }, (_, i) => i);
    expect(percentiles(values).max).toBe(199_999);
  });
});

describe('shareWithin', () => {
  it('counts samples at or under the limit', () => {
    expect(shareWithin([1, 2, 2, 3], 2)).toBe(0.75);
    expect(Number.isNaN(shareWithin([], 2))).toBe(true);
  });
});

describe('verdict', () => {
  const stats = percentiles([100, 200, 300, 400, 2500]);

  it('meets a target at or under its limit and misses one over it', () => {
    expect(verdict(stats, { stat: 'p50', limitMs: 300 })).toBe('met');
    expect(verdict(stats, { stat: 'p50', limitMs: 299 })).toBe('missed');
    expect(verdict(stats, { stat: 'max', limitMs: 2000 })).toBe('missed');
  });

  it('says there were no samples rather than meeting a target', () => {
    expect(verdict(percentiles([]), { stat: 'p95', limitMs: 1 })).toBe('no samples');
  });
});

describe('openLoopOffsets', () => {
  it('spaces the deliveries evenly at the rate for the run', () => {
    expect(openLoopOffsets(20, 0.25)).toEqual([0, 50, 100, 150, 200]);
    const hundred = openLoopOffsets(100, 30);
    expect(hundred).toHaveLength(3000);
    expect(hundred.at(-1)).toBe(29_990);
  });

  it('refuses a rate or length that is not a positive number', () => {
    expect(() => openLoopOffsets(0, 10)).toThrow(RangeError);
    expect(() => openLoopOffsets(20, Number.NaN)).toThrow(RangeError);
  });
});

describe('sendLag', () => {
  it('measures how late the generator sent against its plan, never below zero', () => {
    expect(sendLag([0, 10, 20], [1, 10, 25])).toMatchObject({ n: 3, p50: 1, max: 5 });
    expect(sendLag([10], [9]).max).toBe(0);
    expect(() => sendLag([0], [])).toThrow(RangeError);
  });
});

describe('storedOnce', () => {
  it('passes when every id sent is held once, repeats sent included', () => {
    expect(storedOnce(['a', 'b', 'a'], ['a', 'b'])).toEqual({
      sent: 2,
      stored: 2,
      missing: [],
      repeated: [],
      unexpected: [],
      ok: true,
    });
  });

  it('names an id missing, held twice or never sent', () => {
    const result = storedOnce(['a', 'b', 'c'], ['a', 'a', 'b', 'z']);
    expect(result).toMatchObject({
      sent: 3,
      stored: 2,
      missing: ['c'],
      repeated: ['a'],
      unexpected: ['z'],
      ok: false,
    });
  });
});

describe('markdownTable', () => {
  it('writes the figures, the target and whether it was met', () => {
    const table = markdownTable([
      {
        measure: 'Lead Ads event to a lead',
        stats: percentiles([800, 900, 12_000]),
        target: { stat: 'max', limitMs: 10_000 },
        note: 'in process',
      },
      { measure: 'outbox batch of 200', stats: percentiles([4.25]) },
    ]);
    expect(table.split('\n')).toEqual([
      '| Measure | n | p50 ms | p95 ms | p99 ms | max ms | Target | Result |',
      '|---|---|---|---|---|---|---|---|',
      '| Lead Ads event to a lead | 3 | 900 | 12000 | 12000 | 12000 | max ≤ 10000 ms | missed; in process |',
      '| outbox batch of 200 | 1 | 4.3 | 4.3 | 4.3 | 4.3 | – | – |',
    ]);
  });

  it('formats figures for reading', () => {
    expect(formatMs(1234.56)).toBe('1235');
    expect(formatMs(0.25)).toBe('0.3');
    expect(formatMs(Number.NaN)).toBe('–');
  });
});
