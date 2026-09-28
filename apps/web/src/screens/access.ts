import {
  hasGrant,
  type PermissionGrant,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import type { UserAccess } from '@shakti/domain';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../auth/current-principal';

export interface ScreenAccess {
  principal: Principal;
  access: UserAccess;
  /** The company being viewed, or undefined in All companies mode. */
  activeEntityId: number | undefined;
  /** Whether the caller holds `key` at `scope` or wider. */
  can: (key: PermissionKey, scope: Scope) => boolean;
}

/**
 * The signed-in caller of a BOS screen. A page checks again, because a layout does not re-run on
 * every client navigation. A screen the caller may not use answers the not-found screen, so its
 * address tells nobody it exists; the actions and the database refuse on their own as well.
 * `required` is one grant or every grant the screen needs; a menu screen passes
 * `navRequires('<id>')`, the same grants the menu shows it for.
 */
export async function screenAccess(
  required?: PermissionGrant | readonly PermissionGrant[],
): Promise<ScreenAccess> {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  if (session.blocked !== undefined) redirect('/sign-in?reason=no_access');
  if (!session.principal) redirect('/two-factor');
  const principal = session.principal;
  const can = (key: PermissionKey, scope: Scope) => hasGrant(principal.permissions, key, scope);
  if (!holdsAll(principal, required)) notFound();
  return {
    principal,
    access: session.access,
    activeEntityId: principal.entityIds.length === 1 ? principal.entityIds[0] : undefined,
    can,
  };
}

function holdsAll(
  principal: Principal,
  required: PermissionGrant | readonly PermissionGrant[] | undefined,
): boolean {
  const needed: readonly PermissionGrant[] =
    required === undefined ? [] : 'key' in required ? [required] : required;
  return needed.every((g) => hasGrant(principal.permissions, g.key, g.scope));
}

/**
 * A screen's browser-tab title, given only to a caller who may open the screen: anyone else gets
 * the app's own name, as the not-found screen does, so the tab does not name a screen the
 * address hides.
 */
export async function screenTitle(
  required: PermissionGrant | readonly PermissionGrant[] | undefined,
  title: string,
): Promise<Metadata> {
  const principal = (await currentSession())?.principal;
  return principal && holdsAll(principal, required) ? { title } : {};
}

/** Company names by id, from the companies the caller holds a role in. */
export function companyNames(access: UserAccess): Record<number, string> {
  return Object.fromEntries(access.entities.map((e) => [e.entityId, e.entityName]));
}
