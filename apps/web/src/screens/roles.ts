// Admin › Roles (docs/design/phase1.md §6.2): the words for a permission and a scope, and what a
// role editor's choices change. Pure functions, so the screen, the Activity log and their tests
// share them. Browser code: types only from the contracts.

import type { PermissionKey, RolePermissionDto, Scope } from '@shakti/contracts';
import { COST_PERMISSION_KEYS, EXECUTIVE_KEPT_PERMISSIONS, SCOPE_VALUES } from './contract-values';

/** The choices of the scope picker, narrowest first; `none` means the role lacks the permission. */
export const SCOPE_CHOICES = ['none', 'own', 'team', 'entity', 'all'] as const;
export type ScopeChoice = (typeof SCOPE_CHOICES)[number];

const SCOPE_ORDER: readonly string[] = SCOPE_VALUES;

/** The key of a permission's plain name under `adminRoles.permissions`: dots become underscores. */
export function permissionMessageKey(key: string): string {
  return key.replaceAll('.', '_');
}

/** Whether a scope code is one the picker names. */
export function isScopeChoice(value: string): value is ScopeChoice {
  return (SCOPE_CHOICES as readonly string[]).includes(value);
}

/**
 * The warning a permission carries on the editor: the two cost permissions show costs or what
 * suppliers charge (CLAUDE.md, cost data isolation).
 */
export function costWarning(key: string): 'costWarning' | 'rateWarning' | undefined {
  const [cost, rate] = COST_PERMISSION_KEYS;
  if (key === cost) return 'costWarning';
  if (key === rate) return 'rateWarning';
  return undefined;
}

/** Whether the editor locks this choice: the Executive role never loses its admin grants. */
export function isKeptGrant(roleKey: string, permission: string): boolean {
  return roleKey === 'executive' && (EXECUTIVE_KEPT_PERMISSIONS as readonly string[]).includes(permission);
}

export type Choices = Readonly<Record<string, ScopeChoice>>;

/** The role's grants as the editor starts them. */
export function initialChoices(permissions: readonly RolePermissionDto[]): Choices {
  return Object.fromEntries(permissions.map((p) => [p.key, p.scope ?? 'none']));
}

export interface ChangeSummary {
  added: number;
  removed: number;
  widened: number;
  narrowed: number;
}

/** What the choices change against the saved grants: "3 permissions given, 1 narrowed". */
export function summarise(saved: Choices, chosen: Choices): ChangeSummary {
  const summary: ChangeSummary = { added: 0, removed: 0, widened: 0, narrowed: 0 };
  for (const [key, was] of Object.entries(saved)) {
    const now = chosen[key] ?? was;
    if (now === was) continue;
    if (was === 'none') summary.added += 1;
    else if (now === 'none') summary.removed += 1;
    else if (SCOPE_ORDER.indexOf(now) > SCOPE_ORDER.indexOf(was)) summary.widened += 1;
    else summary.narrowed += 1;
  }
  return summary;
}

export function hasChanges(summary: ChangeSummary): boolean {
  return summary.added + summary.removed + summary.widened + summary.narrowed > 0;
}

/** The grant set the command receives: every permission with a scope, in catalogue order. */
export function grantsOf(
  permissions: readonly RolePermissionDto[],
  chosen: Choices,
): { permission: PermissionKey; scope: Scope }[] {
  return permissions.flatMap((p) => {
    const choice = chosen[p.key] ?? 'none';
    return choice === 'none' ? [] : [{ permission: p.key, scope: choice }];
  });
}

/** The permissions grouped by module, keeping the catalogue's order of modules and permissions. */
export function byModule(
  permissions: readonly RolePermissionDto[],
): { module: string; permissions: RolePermissionDto[] }[] {
  const groups = new Map<string, RolePermissionDto[]>();
  for (const p of permissions) {
    const list = groups.get(p.module) ?? [];
    list.push(p);
    groups.set(p.module, list);
  }
  return [...groups.entries()].map(([module, list]) => ({ module, permissions: list }));
}
