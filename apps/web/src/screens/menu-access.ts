import { hasGrant, type PermissionGrant } from '@shakti/contracts';
import { NAV_ITEMS, type NavItem } from '../nav';
import { PALETTE_ACTIONS, type PaletteAction } from './palette';

// What the principal's grants open in the shell: the menu's screens, the palette's actions and
// its search. Decided on the server, where the layout hands the shell only the ids: the grant
// check loads the contracts, and with them Zod, which the browser does not need for this.

/** The screens these grants open, in menu order. */
export function visibleNav(grants: readonly PermissionGrant[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.requires.every((g) => hasGrant(grants, g.key, g.scope)));
}

/** The actions these grants allow, in palette order. */
export function visibleActions(grants: readonly PermissionGrant[]): PaletteAction[] {
  return PALETTE_ACTIONS.filter((a) => a.requires.every((g) => hasGrant(grants, g.key, g.scope)));
}

/** Whether these grants can search anything: leads, or team members for a user administrator. */
export function canSearch(grants: readonly PermissionGrant[]): boolean {
  return hasGrant(grants, 'crm.lead.read', 'own') || hasGrant(grants, 'admin.users.write', 'all');
}
