import { PERMISSION_KEYS, type PermissionGrant } from '@shakti/contracts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import { activeNavId, NAV_ITEMS, navRequires } from './nav';
import { visibleNav } from './screens/menu-access';
import { isBosPath } from './session-gate';

const ids = (grants: readonly PermissionGrant[]) => visibleNav(grants).map((i) => i.id);

describe('visibleNav', () => {
  it('shows only Home and the design preview to someone with no grants', () => {
    expect(ids([])).toEqual(['home', 'design']);
  });

  it('shows Leads to an own-scope reader, and New lead only with both write grants', () => {
    const reader: PermissionGrant[] = [{ key: 'crm.lead.read', scope: 'own' }];
    expect(ids(reader)).toEqual(['home', 'leads', 'design']);
    expect(ids([...reader, { key: 'crm.lead.write', scope: 'own' }])).not.toContain('leads-new');
    expect(
      ids([
        ...reader,
        { key: 'crm.lead.write', scope: 'own' },
        { key: 'crm.account.write', scope: 'own' },
      ]),
    ).toContain('leads-new');
  });

  it('needs the scope the screen needs: an entity grant is not enough for group-wide admin', () => {
    expect(ids([{ key: 'admin.users.write', scope: 'entity' }])).not.toContain('admin-users');
    expect(ids([{ key: 'admin.users.write', scope: 'all' }])).toContain('admin-users');
    expect(ids([{ key: 'admin.roles.write', scope: 'entity' }])).not.toContain('admin-roles');
    expect(ids([{ key: 'admin.roles.write', scope: 'all' }])).toContain('admin-roles');
    expect(ids([{ key: 'pricing.read', scope: 'own' }])).not.toContain('price-master');
    expect(ids([{ key: 'pricing.read', scope: 'all' }])).toContain('price-master');
    expect(ids([{ key: 'audit.read', scope: 'entity' }])).toContain('admin-activity');
    expect(ids([{ key: 'imports.write', scope: 'entity' }])).toContain('imports');
    expect(ids([{ key: 'admin.entities.write', scope: 'all' }])).toContain('settings-companies');
  });

  it('shows every screen, in menu order, to someone holding every grant group-wide', () => {
    const all = PERMISSION_KEYS.map((key) => ({ key, scope: 'all' as const }));
    expect(ids(all)).toEqual(NAV_ITEMS.map((i) => i.id));
  });
});

describe('NAV_ITEMS', () => {
  it('has unique ids and paths, each a BOS screen the proxy checks', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(isBosPath(item.href)).toBe(true);
  });

  it('has a menu name for every item and a home shortcut line for every item but Home', () => {
    const hints: Record<string, string> = en.home.hint;
    for (const item of NAV_ITEMS) {
      expect(en.nav[item.label]).toBeTruthy();
      if (item.id !== 'home') expect(hints[item.label]).toBeTruthy();
    }
  });
});

describe('activeNavId', () => {
  it('picks the longest matching path', () => {
    expect(activeNavId('/leads', NAV_ITEMS)).toBe('leads');
    expect(activeNavId('/leads/01J9', NAV_ITEMS)).toBe('leads');
    expect(activeNavId('/leads/new', NAV_ITEMS)).toBe('leads-new');
    expect(activeNavId('/admin/users', NAV_ITEMS)).toBe('admin-users');
    expect(activeNavId('/admin/roles/accounts', NAV_ITEMS)).toBe('admin-roles');
    expect(activeNavId('/settings/profile', NAV_ITEMS)).toBeUndefined();
  });
});

describe('page guards', () => {
  const pages = join(dirname(fileURLToPath(import.meta.url)), 'app', '(bos)');
  const pageSource = (href: string) => readFileSync(join(pages, href, 'page.tsx'), 'utf8');

  it("every menu screen's page checks the grants the menu shows it for", () => {
    for (const item of NAV_ITEMS) {
      expect(pageSource(item.href), item.id).toContain(`screenAccess(navRequires('${item.id}'))`);
    }
  });

  it('no page reads the session by hand', () => {
    const hand = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return hand(path);
        return name === 'page.tsx' && readFileSync(path, 'utf8').includes('currentSession(')
          ? [path]
          : [];
      });
    expect(hand(pages)).toEqual([]);
  });

  it('navRequires answers the menu grants and refuses an unknown screen', () => {
    expect(navRequires('settings-companies')).toEqual([
      { key: 'admin.entities.write', scope: 'all' },
    ]);
    expect(navRequires('leads-new')).toEqual([
      { key: 'crm.lead.write', scope: 'own' },
      { key: 'crm.account.write', scope: 'own' },
    ]);
    expect(() => navRequires('nowhere')).toThrow();
  });
});
