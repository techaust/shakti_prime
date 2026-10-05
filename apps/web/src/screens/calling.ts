// The Cold Caller workspace (`/calling`, docs/design/phase1.md §7.2): pure helpers the screen and
// its tests share. Browser code, so only types come from the contracts.

import type {
  CallQueueItemDto,
  DispositionDto,
  DispositionNextAction,
  OpportunityLostReason,
  OpportunityState,
} from '@shakti/contracts';
import type { Route } from 'next';
import { localFromIso } from './customers';

/** What an outcome asks the caller for before the call is saved. */
export type OutcomeNeed = 'callbackTime' | 'lostReason' | 'nurtureReason';

/**
 * The detail an outcome needs, as `calls.log` asks for it: a time for a callback, a reason for a
 * lost lead, a reason for parking an open lead. Any other outcome is saved on its key alone.
 */
export function outcomeNeeds(
  nextAction: DispositionNextAction,
  state: OpportunityState,
): OutcomeNeed | undefined {
  if (nextAction === 'callback') return 'callbackTime';
  if (nextAction === 'not_interested' || nextAction === 'wrong_number') return 'lostReason';
  if (nextAction === 'nurture' && state === 'open') return 'nurtureReason';
  return undefined;
}

/** The lost reason the dialog starts on for an outcome: the caller may choose another. */
export function suggestedLostReason(nextAction: DispositionNextAction): OpportunityLostReason {
  return nextAction === 'wrong_number' ? 'not_reachable' : 'not_interested';
}

/** What a key pressed on the workspace asks for. */
export type Shortcut =
  | { kind: 'next' }
  | { kind: 'dial' }
  | { kind: 'search' }
  | { kind: 'outcome'; key: number };

/**
 * The workspace's keys (DESIGN.md §6, Caller workspace; PRD TEL-01): `N` the next lead, `D` the
 * number to dial, `/` search and `1` to `9` the outcomes. A key with Ctrl, Alt or the command key
 * held is the browser's or the palette's, never the workspace's.
 */
export function shortcutFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): Shortcut | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.key === 'n' || event.key === 'N') return { kind: 'next' };
  if (event.key === 'd' || event.key === 'D') return { kind: 'dial' };
  if (event.key === '/') return { kind: 'search' };
  if (/^[1-9]$/.test(event.key)) return { kind: 'outcome', key: Number(event.key) };
  return undefined;
}

/** Whether a key press belongs to a field being typed in, not to the workspace. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The outcome a number key picks. */
export function outcomeForKey(
  outcomes: readonly DispositionDto[],
  key: number,
): DispositionDto | undefined {
  return outcomes.find((o) => o.key === key);
}

/** The lead after `current` in the queue; the first lead when none is open or it left the queue. */
export function nextLead(
  items: readonly CallQueueItemDto[],
  current: string | undefined,
): CallQueueItemDto | undefined {
  const at = current === undefined ? -1 : items.findIndex((i) => i.opportunityId === current);
  return items[at + 1] ?? (at === -1 ? items[0] : undefined);
}

const HOUR_MS = 3_600_000;
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The time a callback field starts on, as a `datetime-local` value in India time: 10:00 the next
 * day, a time inside calling hours the caller changes as the customer asks.
 */
export function defaultCallbackLocal(now: Date): string {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const nextDay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return localFromIso(new Date(nextDay + 10 * HOUR_MS - IST_OFFSET_MS).toISOString());
}

/** The workspace showing one team member's queue, for their team lead. */
export function callerQueueHref(callerId: string, entityId: number): Route {
  return `/calling?caller=${callerId}&company=${String(entityId)}` as Route;
}
