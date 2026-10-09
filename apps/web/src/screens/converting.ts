// The Lead Converter workspace (`/converting`, PRD TEL-03, docs/03-roadmap-appendix/phase1.md §9): pure helpers
// the screen and its tests share. Browser code, so only types come from the contracts.

import type { ConvertingLeadDto, ConvertingPanel } from '@shakti/contracts';
import type { Route } from 'next';

/** What a key pressed on the workspace asks for. */
export type ConvertingShortcut =
  | { kind: 'move'; step: 1 | -1 }
  | { kind: 'next' }
  | { kind: 'search' }
  | { kind: 'log' }
  | { kind: 'callback' }
  | { kind: 'sizing' }
  | { kind: 'quote' }
  | { kind: 'dial' }
  | { kind: 'help' }
  | { kind: 'outcome'; key: number };

/**
 * The workspace's keys (docs/08-design-system.md §6, Caller workspace): `/` search, `J` and `K` down and up
 * the board, `N` the first thing on the list, `L` log a call, `C` set a callback, `S` the sizing,
 * `Q` the quote, `D` the number to dial, `?` the list of keys and `1` to `9` the outcome of a call.
 * Enter is the browser's own: it presses the lead the keyboard is on. A key with Ctrl, Alt or the
 * command key held is the browser's or the palette's, never the workspace's.
 */
export function convertingShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): ConvertingShortcut | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  switch (event.key) {
    case '/':
      return { kind: 'search' };
    case '?':
      return { kind: 'help' };
    case 'j':
    case 'J':
      return { kind: 'move', step: 1 };
    case 'k':
    case 'K':
      return { kind: 'move', step: -1 };
    case 'n':
    case 'N':
      return { kind: 'next' };
    case 'l':
    case 'L':
      return { kind: 'log' };
    case 'c':
    case 'C':
      return { kind: 'callback' };
    case 's':
    case 'S':
      return { kind: 'sizing' };
    case 'q':
    case 'Q':
      return { kind: 'quote' };
    case 'd':
    case 'D':
      return { kind: 'dial' };
    default:
      return /^[1-9]$/.test(event.key) ? { kind: 'outcome', key: Number(event.key) } : undefined;
  }
}

/** One column of the board: the leads at one stage, in the order the board read them. */
export interface StageGroup {
  key: string;
  name: string;
  leads: ConvertingLeadDto[];
}

/**
 * The board's columns: the leads grouped by their stage's key, since the same stage of every
 * pipeline shares it, earliest stage first (by the lowest position any lead holds in it).
 */
export function groupByStage(leads: readonly ConvertingLeadDto[]): StageGroup[] {
  const groups = new Map<string, StageGroup & { position: number }>();
  for (const lead of leads) {
    const group = groups.get(lead.stageKey);
    if (group === undefined) {
      groups.set(lead.stageKey, {
        key: lead.stageKey,
        name: lead.stageName,
        leads: [lead],
        position: lead.stagePosition,
      });
    } else {
      group.leads.push(lead);
      group.position = Math.min(group.position, lead.stagePosition);
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key, 'en'))
    .map(({ key, name, leads: inStage }) => ({ key, name, leads: inStage }));
}

/** The id the board gives a lead's button, so `J` and `K` find the one the keyboard is on. */
export function leadKey(ref: { entityId: number; opportunityId: string }): string {
  return `${String(ref.entityId)}:${ref.opportunityId}`;
}

/**
 * The index `J` (step 1) or `K` (step -1) moves to among `count` leads, from `current` (the one
 * the keyboard is on, or -1 for none). It stops at the ends rather than wrapping; with no lead
 * chosen, either key lands on the first.
 */
export function movedIndex(count: number, current: number, step: 1 | -1): number | undefined {
  if (count <= 0) return undefined;
  if (current < 0) return 0;
  return Math.min(Math.max(current + step, 0), count - 1);
}

/** The panels of a lead's workspace: the order panel only while an order is held. */
export function panelsFor(
  lead: Pick<ConvertingLeadDto, 'heldOrder'> | undefined,
): ConvertingPanel[] {
  return lead?.heldOrder === undefined || lead.heldOrder === null
    ? ['calls', 'sizing', 'quote']
    : ['calls', 'sizing', 'quote', 'order'];
}

/** The page of one converter's board, for a team lead looking at a person of their team. */
export function converterHref(ownerId: string, entityId: number): Route {
  return `/converting?owner=${ownerId}&company=${String(entityId)}` as Route;
}
