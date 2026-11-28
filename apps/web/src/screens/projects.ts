// J1's project screens (docs/03-roadmap-appendix/phase4.md §6.1): links, badges, the project page's
// tabs and the steps editor's keys. Pure functions, so the screens and their tests share them.
// Browser code: types only from the contracts.

import type { ProjectState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The project page of one project. */
export function projectHref(entityId: number, projectId: string): Route {
  return `/projects/${String(entityId)}/${projectId}` as Route;
}

/** How each state of a project reads as a badge. */
export const PROJECT_STATE_TONE: Record<ProjectState, StatusTone> = {
  active: 'accent',
  on_hold: 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

/**
 * The project page's tabs, in order: the key that names the tab in `projects.tabs`. Each later
 * slice adds its tab here, one line each (Documents J3, Schedule J5, QC and Costs J6, Loan J2),
 * and its panel in the page's `TAB_PANELS`.
 */
export const PROJECT_TABS = ['milestones'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** The tab a `?tab=` value names, the first tab for anything else. */
export function projectTab(value: string | undefined): ProjectTab {
  return (PROJECT_TABS as readonly string[]).includes(value ?? '')
    ? (value as ProjectTab)
    : PROJECT_TABS[0];
}

/**
 * A new step's key from its name, as the steps editor makes it: lower case letters, digits and
 * `_`, starting with a letter, at most 40 characters, and none the list already has (`_2`, `_3`…).
 */
export function stepKeyFrom(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 36) || 'step';
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${String(n)}`;
  return key;
}
