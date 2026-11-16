// Where a WhatsApp chat opens (docs/03-roadmap-appendix/phase2.md §6.1): `/messages` with the chat
// chosen, in its company. Browser code: no contract values.
import type { Route } from 'next';

/** `/messages` with one chat open, in the chat's company. */
export function messagesHref(entityId: number, threadId: string): Route {
  return `/messages?company=${String(entityId)}&thread=${threadId}` as Route;
}
