import { describe, expect, it } from 'vitest';
import { INBOX_COUNT_TTL_MS, inboxCountCache, inboxCountKey } from './inbox-count-cache';

describe('the inbox count cache', () => {
  it('reuses a count within its time to live, per person and company scope', () => {
    const cache = inboxCountCache();
    const key = inboxCountKey('p1', [2, 1]);
    expect(key).toBe(inboxCountKey('p1', [1, 2]));
    cache.set(key, 4, 1_000);
    expect(cache.get(key, 1_000 + INBOX_COUNT_TTL_MS - 1)).toBe(4);
    expect(cache.get(key, 1_000 + INBOX_COUNT_TTL_MS)).toBeUndefined();
    expect(cache.get(inboxCountKey('p1', [1]), 1_000)).toBeUndefined();
  });

  it('forgets every count of one person after a decision, and no one else’s', () => {
    const cache = inboxCountCache();
    cache.set(inboxCountKey('p1', [1]), 3, 0);
    cache.set(inboxCountKey('p1', [1, 2]), 5, 0);
    cache.set(inboxCountKey('p10', [1]), 7, 0);
    cache.forget('p1');
    expect(cache.get(inboxCountKey('p1', [1]), 1)).toBeUndefined();
    expect(cache.get(inboxCountKey('p1', [1, 2]), 1)).toBeUndefined();
    expect(cache.get(inboxCountKey('p10', [1]), 1)).toBe(7);
  });
});
