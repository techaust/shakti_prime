import { describe, expect, it, vi } from 'vitest';
import { testPhone } from './phone';

describe('testPhone', () => {
  it('gives ten digits that start with 6 to 9, as an Indian mobile number has', () => {
    for (const now of [0, 999_999_999, 1_000_000_000, 3_999_999_998, Date.now()]) {
      expect(testPhone(now)).toMatch(/^[6-9]\d{9}$/);
    }
  });

  it('never gives one number twice, even when the clock stands still or goes back', () => {
    const seen = new Set<string>();
    const now = Date.now();
    for (let i = 0; i < 5_000; i += 1) seen.add(testPhone(now - (i % 3)));
    expect(seen.size).toBe(5_000);
  });

  it('counts on from the clock, and from a later time for a later file', async () => {
    vi.resetModules();
    const { testPhone: fresh } = await import('./phone');
    expect(fresh(1_234_567_890)).toBe('7234567890');
    expect(fresh(1_234_567_890)).toBe('7234567891');
    expect(fresh(1_234_600_000)).toBe('7234600000');
    expect(fresh(3_999_999_999)).toBe('9999999999');
  });
});
