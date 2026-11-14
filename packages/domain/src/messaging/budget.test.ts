import { describe, expect, it } from 'vitest';
import { memoryKeyValue } from '../ports/key-value';
import { countConversation, readBudget, readMessagingHealth, recordQuality, tierLimit } from './budget';

const NOW = new Date('2026-11-14T06:30:00.000Z');

describe('the WhatsApp portfolio budget (BLUEPRINT §13, design phase2 §6.1)', () => {
  it('reads Meta’s tiers', () => {
    expect(tierLimit('TIER_250')).toBe(250);
    expect(tierLimit('TIER_1K')).toBe(1000);
    expect(tierLimit('tier_100k')).toBe(100_000);
    expect(tierLimit('TIER_UNLIMITED')).toBe(1_000_000_000);
    expect(tierLimit('SOMETHING')).toBeNull();
    expect(tierLimit(undefined)).toBeNull();
  });

  it('counts each customer once in a rolling day, from the starting limit until Meta reports one', async () => {
    let now = NOW.getTime();
    const kv = memoryKeyValue(() => now);
    expect(await readBudget(kv, '919800000001', NOW)).toEqual({
      used: 0,
      limit: 250,
      alreadyCounted: false,
    });
    await countConversation(kv, '919800000001', NOW);
    await countConversation(kv, '919800000001', NOW);
    await countConversation(kv, '919800000002', new Date(NOW.getTime() + 3_600_000));
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await readBudget(kv, '919800000001', later)).toEqual({
      used: 2,
      limit: 250,
      alreadyCounted: true,
    });
    await recordQuality(kv, 1, 'UPGRADE', 'TIER_1K', NOW);
    expect((await readBudget(kv, '919800000003', later)).limit).toBe(1000);
    // A day later the first customer's chat no longer counts.
    now = NOW.getTime() + 24.25 * 3_600_000;
    const dayLater = new Date(now);
    expect(await readBudget(kv, '919800000001', dayLater)).toEqual({
      used: 1,
      limit: 1000,
      alreadyCounted: false,
    });
  });

  it('keeps each company’s last quality event for Integration Health', async () => {
    const kv = memoryKeyValue(() => NOW.getTime());
    await recordQuality(kv, 2, 'FLAGGED', undefined, NOW);
    expect(await readMessagingHealth(kv, [1, 2], NOW)).toEqual({
      limit: 250,
      limitReported: false,
      used: 0,
      quality: [
        { entityId: 1, event: null, at: null },
        { entityId: 2, event: 'FLAGGED', at: NOW.toISOString() },
      ],
    });
  });
});
