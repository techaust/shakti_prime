// The Agent Inbox's count in the top bar, kept briefly per person and company scope (docs/03-roadmap-appendix/
// phase1.md §7.1): every staff page's layout reads it, and one read is a transaction of its own of
// about 7 ms (the AI0 review's measure), so a page opened within a few seconds of the last reuses
// it. A decision clears the person's own counts at once; a suggestion filed or decided by someone
// else shows within the time to live. Kept in the server's memory, so each instance has its own.

/** How long a count is reused. */
export const INBOX_COUNT_TTL_MS = 10_000;

/** Counts kept at most, the oldest dropped first. */
const MAX_ENTRIES = 2_000;

interface Entry {
  open: number;
  at: number;
}

export interface InboxCountCache {
  get(key: string, now: number): number | undefined;
  set(key: string, open: number, now: number): void;
  /** Drops every count of one person. */
  forget(principalId: string): void;
}

/** The key of one person's count in one company scope. */
export function inboxCountKey(principalId: string, entityIds: readonly number[]): string {
  return `${principalId}:${[...entityIds].sort((a, b) => a - b).join(',')}`;
}

export function inboxCountCache(ttlMs = INBOX_COUNT_TTL_MS): InboxCountCache {
  const entries = new Map<string, Entry>();
  return {
    get(key, now) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (now - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.open;
    },
    set(key, open, now) {
      entries.delete(key);
      entries.set(key, { open, at: now });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    forget(principalId) {
      for (const key of entries.keys()) {
        if (key.startsWith(`${principalId}:`)) entries.delete(key);
      }
    },
  };
}

/** The one cache of this server instance. */
export const inboxCounts: InboxCountCache = inboxCountCache();
