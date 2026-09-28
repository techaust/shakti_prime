import {
  hasGrant,
  type PermissionGrant,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import type { UserAccess } from '@shakti/domain';
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
  const needed: readonly PermissionGrant[] =
    required === undefined ? [] : 'key' in required ? [required] : required;
  if (!needed.every((g) => can(g.key, g.scope))) notFound();
  return {
    principal,
    access: session.access,
    activeEntityId: principal.entityIds.length === 1 ? principal.entityIds[0] : undefined,
    can,
  };
}

/** Company names by id, from the companies the caller holds a role in. */
export function companyNames(access: UserAccess): Record<number, string> {
  return Object.fromEntries(access.entities.map((e) => [e.entityId, e.entityName]));
}
