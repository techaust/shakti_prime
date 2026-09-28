import { describe, expect, it } from 'vitest';
import { OUTBOX_BACKOFF_CAP_SECONDS, outboxRetryDelaySeconds } from './backoff';
import { OUTBOX_MAX_ATTEMPTS } from './publisher';

const middle = () => 0.5;
const lowest = () => 0;
const highest = () => 0.999_999;

/** Minutes from the first failure to the last attempt: the waits after failures 1 to 9. */
function minutesToLastAttempt(random: () => number): number {
  let seconds = 0;
  for (let failures = 1; failures < OUTBOX_MAX_ATTEMPTS; failures += 1) {
    seconds += outboxRetryDelaySeconds(failures, random);
  }
  return seconds / 60;
}

describe('outboxRetryDelaySeconds', () => {
  it('doubles from a minute and stops at an hour', () => {
    const minutes = Array.from(
      { length: 9 },
      (_, i) => outboxRetryDelaySeconds(i + 1, middle) / 60,
    );
    expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it('moves each wait by at most a fifth, and never past the hour', () => {
    expect(outboxRetryDelaySeconds(1, lowest)).toBe(48);
    expect(outboxRetryDelaySeconds(1, highest)).toBe(72);
    expect(outboxRetryDelaySeconds(6, lowest)).toBe(1536);
    expect(outboxRetryDelaySeconds(6, highest)).toBe(2304);
    expect(outboxRetryDelaySeconds(7, lowest)).toBe(2880);
    expect(outboxRetryDelaySeconds(9, highest)).toBe(OUTBOX_BACKOFF_CAP_SECONDS);
    for (let i = 0; i < 200; i += 1) {
      const failures = (i % 12) + 1;
      const wait = outboxRetryDelaySeconds(failures);
      expect(wait).toBeGreaterThanOrEqual(48);
      expect(wait).toBeLessThanOrEqual(OUTBOX_BACKOFF_CAP_SECONDS);
    }
  });

  it('brings the tenth attempt several hours after the first, so a long outage recovers', () => {
    expect(minutesToLastAttempt(middle)).toBe(243);
    expect(minutesToLastAttempt(lowest)).toBeGreaterThan(3 * 60);
    expect(minutesToLastAttempt(highest)).toBeLessThan(4.5 * 60);
  });

  it('treats a count below one, or a random answer out of range, as the gentlest case', () => {
    expect(outboxRetryDelaySeconds(0, middle)).toBe(60);
    expect(outboxRetryDelaySeconds(Number.NaN, middle)).toBe(60);
    expect(outboxRetryDelaySeconds(1, () => 7)).toBe(72);
    expect(outboxRetryDelaySeconds(1, () => -3)).toBe(48);
    expect(outboxRetryDelaySeconds(1000, middle)).toBe(OUTBOX_BACKOFF_CAP_SECONDS);
  });
});
