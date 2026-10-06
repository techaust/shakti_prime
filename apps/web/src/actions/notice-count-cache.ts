// The bell's unread count, kept briefly per person and company scope (docs/design/phase1.md §8.1),
// as the Agent Inbox's count is (`inbox-count-cache.ts`, whose cache this is another instance of):
// every staff page's layout reads it and each open page asks again every 15 seconds while it is
// in view. Reading a notice clears the person's own counts at once; a notice written for them
// shows within the time to live. Kept in the server's memory, so each instance has its own.
import { inboxCountCache, type InboxCountCache } from './inbox-count-cache';

/** The one cache of this server instance. */
export const noticeCounts: InboxCountCache = inboxCountCache();
