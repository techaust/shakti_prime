import type { PermissionGrant } from '@shakti/contracts';
import {
  Building2,
  Cable,
  Contact,
  FileUp,
  House,
  IndianRupee,
  ListTodo,
  Package,
  Palette,
  Percent,
  ScrollText,
  Store,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import type en from '../messages/en.json';

/** A screen's name in the menu, under `nav.*`. */
export type NavLabelKey = keyof (typeof en)['nav'];

/** The sidebar's sections: daily work, then administration, then the design preview. */
export type NavGroup = 'work' | 'admin' | 'more';

export interface NavItem {
  id: string;
  /** A typed route: `next build` fails when a listed screen has no page. */
  href: Route;
  label: NavLabelKey;
  icon: LucideIcon;
  group: NavGroup;
  /**
   * Every grant the screen needs, each at the narrowest scope that still lets its main query or
   * command run (docs/SECURITY.md §3.2). Empty: everyone who is signed in.
   */
  requires: readonly PermissionGrant[];
}

/**
 * The single list of BOS screens (DESIGN.md §5, BLUEPRINT §11.1): the sidebar, the phone menu,
 * the command palette's "Go to" group and the home shortcuts all read it. An item is shown when
 * the principal's own grants allow it, never by role name; the screen and the command behind it
 * check again, so hiding an item is a courtesy, not the guard.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', href: '/home', label: 'home', icon: House, group: 'work', requires: [] },
  {
    id: 'leads',
    href: '/leads',
    label: 'leads',
    icon: ListTodo,
    group: 'work',
    // listLeads narrows an own-scope reader to their own leads.
    requires: [{ key: 'crm.lead.read', scope: 'own' }],
  },
  {
    id: 'customers',
    href: '/customers',
    label: 'customers',
    icon: Contact,
    group: 'work',
    // Every staff role that reads leads also reads customers at own scope or wider; listCustomers
    // shows the customers they look after and those of their leads (0057).
    requires: [{ key: 'crm.account.read', scope: 'own' }],
  },
  {
    id: 'leads-new',
    href: '/leads/new',
    label: 'newLead',
    icon: UserPlus,
    group: 'work',
    // crm.lead.create writes the customer as well as the lead.
    requires: [
      { key: 'crm.lead.write', scope: 'own' },
      { key: 'crm.account.write', scope: 'own' },
    ],
  },
  {
    id: 'leads-walk-in',
    href: '/leads/walk-in',
    label: 'walkIn',
    icon: Store,
    group: 'work',
    // The walk-in form creates the lead through crm.lead.create, like New lead.
    requires: [
      { key: 'crm.lead.write', scope: 'own' },
      { key: 'crm.account.write', scope: 'own' },
    ],
  },
  {
    id: 'price-master',
    href: '/price-master',
    label: 'priceMaster',
    icon: IndianRupee,
    group: 'work',
    requires: [{ key: 'pricing.read', scope: 'entity' }],
  },
  {
    id: 'catalogue',
    href: '/catalogue',
    label: 'catalogue',
    icon: Package,
    group: 'work',
    // Items are shared and readable with any context; the screen sits beside the price lists,
    // and changes need catalogue.write, which the commands check.
    requires: [{ key: 'pricing.read', scope: 'entity' }],
  },
  {
    id: 'imports',
    href: '/imports',
    label: 'imports',
    icon: FileUp,
    group: 'work',
    requires: [{ key: 'imports.write', scope: 'entity' }],
  },
  {
    id: 'admin-users',
    href: '/admin/users',
    label: 'adminUsers',
    icon: UsersRound,
    group: 'admin',
    requires: [{ key: 'admin.users.write', scope: 'all' }],
  },
  {
    id: 'admin-roles',
    href: '/admin/roles',
    label: 'adminRoles',
    icon: ShieldCheck,
    group: 'admin',
    requires: [{ key: 'admin.roles.write', scope: 'all' }],
  },
  {
    id: 'admin-activity',
    href: '/admin/activity',
    label: 'adminActivity',
    icon: ScrollText,
    group: 'admin',
    requires: [{ key: 'audit.read', scope: 'entity' }],
  },
  {
    id: 'admin-integrations',
    href: '/admin/integrations',
    label: 'adminIntegrations',
    icon: Cable,
    group: 'admin',
    // app.outbox_health() and platform.probe.run
    requires: [{ key: 'admin.integrations.write', scope: 'all' }],
  },
  {
    id: 'settings-companies',
    href: '/settings/companies',
    label: 'settingsCompanies',
    icon: Building2,
    group: 'admin',
    // org.entity.update
    requires: [{ key: 'admin.entities.write', scope: 'all' }],
  },
  {
    id: 'settings-pipelines',
    href: '/settings/pipelines',
    label: 'settingsPipelines',
    icon: Workflow,
    group: 'admin',
    // crm.pipeline.update, crm.stage.*, crm.disposition.set and crm.score_rule.set
    requires: [{ key: 'crm.config.write', scope: 'all' }],
  },
  {
    id: 'settings-tax',
    href: '/settings/tax',
    label: 'settingsTax',
    icon: Percent,
    group: 'admin',
    // tax.rate.set and tax.composite.set; a change also needs a request for every company.
    requires: [{ key: 'tax.rates.write', scope: 'entity' }],
  },
  { id: 'design', href: '/design', label: 'design', icon: Palette, group: 'more', requires: [] },
];

/**
 * The grants a menu screen's page checks through `screenAccess()`, read from the same list as the
 * menu, so the page guard and the menu cannot drift apart (a page test checks every item's page
 * asks for its own id).
 */
export function navRequires(id: string): readonly PermissionGrant[] {
  const item = NAV_ITEMS.find((i) => i.id === id);
  if (item === undefined) throw new Error(`no menu item ${id}`);
  return item.requires;
}

/** The menu item a path belongs to: the longest matching `href`, so `/leads/new` is not Leads. */
export function activeNavId(pathname: string, items: readonly NavItem[]): string | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === undefined || item.href.length > best.href.length)) best = item;
  }
  return best?.id;
}
