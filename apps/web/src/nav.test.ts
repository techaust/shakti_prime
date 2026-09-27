import { PERMISSION_KEYS, type PermissionGrant } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import { activeNavId, NAV_ITEMS, visibleNav } from './nav';
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
    expect(ids([{ key: 'pricing.read', scope: 'own' }])).not.toContain('price-master');
    expect(ids([{ key: 'pricing.read', scope: 'all' }])).toContain('price-master');
    expect(ids([{ key: 'audit.read', scope: 'entity' }])).toContain('admin-activity');
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
    expect(activeNavId('/settings/profile', NAV_ITEMS)).toBeUndefined();
  });
});
