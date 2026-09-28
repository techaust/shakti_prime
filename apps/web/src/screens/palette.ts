// The ⌘K palette's groups (DESIGN.md §6, Command palette): Go to, Search and Actions. What each
// group holds is decided here from the caller's grants and the search's answer; the shell only
// adds the words and the icons.

import type {
  LeadSearchHitDto,
  PaletteSearchDto,
  PermissionGrant,
  PersonSearchHitDto,
} from '@shakti/contracts';
import type { Route } from 'next';
import type en from '../../messages/en.json';
import type { NavItem } from '../nav';
import { SEARCH_MIN_CHARS } from './contract-values';
import { boardHref } from './lead-board';

/** How long typing must pause before the palette searches, so each key press is not a read. */
export const PALETTE_DEBOUNCE_MS = 250;

/** An action's name in the palette, under `shell.actions.*`. */
export type PaletteActionLabelKey = keyof (typeof en)['shell']['actions'];

export interface PaletteAction {
  id: 'new-lead' | 'new-import' | 'invite';
  href: Route;
  label: PaletteActionLabelKey;
  /** Every grant the screen behind the action needs, as the menu's items state them. */
  requires: readonly PermissionGrant[];
}

/**
 * The palette's actions, each opening the screen or dialog that does it. Shown only to a caller
 * whose grants let the command behind it run; the screen and the command check again.
 */
export const PALETTE_ACTIONS: readonly PaletteAction[] = [
  {
    id: 'new-lead',
    href: '/leads/new',
    label: 'newLead',
    requires: [
      { key: 'crm.lead.write', scope: 'own' },
      { key: 'crm.account.write', scope: 'own' },
    ],
  },
  {
    id: 'new-import',
    href: '/imports/new',
    label: 'newImport',
    requires: [{ key: 'imports.write', scope: 'entity' }],
  },
  {
    id: 'invite',
    href: '/admin/users?invite=1',
    label: 'invite',
    requires: [{ key: 'admin.users.write', scope: 'all' }],
  },
];

/** The text to search for, or undefined while fewer than two characters are typed. */
export function searchText(query: string): string | undefined {
  const text = query.trim();
  return text.length >= SEARCH_MIN_CHARS ? text : undefined;
}

/** The address a lead found opens: the leads board of its company and pipeline, at its status. */
export function leadHref(hit: Pick<LeadSearchHitDto, 'entityId' | 'pipelineKey' | 'state'>) {
  return boardHref({ entityId: hit.entityId, pipelineKey: hit.pipelineKey, show: hit.state });
}

export type PaletteEntry =
  | { kind: 'page'; id: string; href: Route; item: NavItem }
  | { kind: 'lead'; id: string; href: Route; hit: LeadSearchHitDto }
  | { kind: 'person'; id: string; href: Route; hit: PersonSearchHitDto }
  | { kind: 'action'; id: string; href: Route; action: PaletteAction };

export interface PaletteSection {
  id: 'goto' | 'search' | 'actions';
  entries: PaletteEntry[];
  /** The search's own matches: shown as found, not filtered again by the palette. */
  prefiltered: boolean;
}

/**
 * The palette's sections in DESIGN.md order. Go to lists the screens the caller may open, less
 * any screen an action already opens (New lead is an action, not a second page entry). Search
 * holds the leads and then the team members found, and is left out when nothing was searched.
 */
export function paletteSections(input: {
  nav: readonly NavItem[];
  actions: readonly PaletteAction[];
  found: PaletteSearchDto | undefined;
}): PaletteSection[] {
  const actionHrefs = new Set<string>(input.actions.map((a) => a.href));
  const sections: PaletteSection[] = [
    {
      id: 'goto',
      prefiltered: false,
      entries: input.nav
        .filter((item) => !actionHrefs.has(item.href))
        .map((item) => ({ kind: 'page', id: item.id, href: item.href, item })),
    },
  ];
  if (input.found !== undefined) {
    sections.push({
      id: 'search',
      prefiltered: true,
      entries: [
        ...input.found.leads.map((hit): PaletteEntry => ({
          kind: 'lead',
          id: `lead-${hit.id}`,
          href: leadHref(hit),
          hit,
        })),
        ...input.found.people.map((hit): PaletteEntry => ({
          kind: 'person',
          id: `person-${hit.id}`,
          href: '/admin/users',
          hit,
        })),
      ],
    });
  }
  sections.push({
    id: 'actions',
    prefiltered: false,
    entries: input.actions.map((action) => ({
      kind: 'action',
      id: action.id,
      href: action.href,
      action,
    })),
  });
  return sections;
}

/** How many records the search found, for the sentence read out to screen readers. */
export function foundCount(found: PaletteSearchDto): number {
  return found.leads.length + found.people.length;
}
