import { PERMISSION_KEYS, permissionModule, type RolePermissionDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import {
  byModule,
  costWarning,
  grantsOf,
  hasChanges,
  initialChoices,
  isKeptGrant,
  isScopeChoice,
  permissionMessageKey,
  SCOPE_CHOICES,
  summarise,
} from './roles';

const perm = (key: RolePermissionDto['key'], scope: RolePermissionDto['scope']) => ({
  key,
  module: permissionModule(key),
  description: key,
  scope,
});

const catalogue: RolePermissionDto[] = [
  perm('crm.lead.read', 'team'),
  perm('crm.lead.write', 'own'),
  perm('crm.lead.assign', null),
  perm('pricing.read', 'entity'),
  perm('finance.cost.read', null),
];

describe('the role editor', () => {
  it('names every permission, module and scope in plain words', () => {
    const names = en.adminRoles.permissions as Record<string, string>;
    const modules = en.adminRoles.modules as Record<string, string>;
    for (const key of PERMISSION_KEYS) {
      expect(names[permissionMessageKey(key)], key).toBeTruthy();
      expect(modules[permissionModule(key)], key).toBeTruthy();
    }
    expect(Object.keys(names)).toHaveLength(PERMISSION_KEYS.length);
    for (const choice of SCOPE_CHOICES) {
      expect((en.adminRoles.scope as Record<string, string>)[choice]).toBeTruthy();
    }
  });

  it('recognises the scope choices and nothing else', () => {
    expect(isScopeChoice('none')).toBe(true);
    expect(isScopeChoice('entity')).toBe(true);
    expect(isScopeChoice('company')).toBe(false);
  });

  it('warns on the two cost permissions only', () => {
    expect(costWarning('finance.cost.read')).toBe('costWarning');
    expect(costWarning('procurement.rate.read')).toBe('rateWarning');
    expect(costWarning('pricing.read')).toBeUndefined();
  });

  it('locks the admin grants of the Executive role only', () => {
    expect(isKeptGrant('executive', 'admin.roles.write')).toBe(true);
    expect(isKeptGrant('executive', 'admin.users.write')).toBe(true);
    expect(isKeptGrant('executive', 'admin.flags.write')).toBe(false);
    expect(isKeptGrant('general_manager', 'admin.roles.write')).toBe(false);
  });

  it('summarises what the choices change', () => {
    const saved = initialChoices(catalogue);
    expect(saved).toEqual({
      'crm.lead.read': 'team',
      'crm.lead.write': 'own',
      'crm.lead.assign': 'none',
      'pricing.read': 'entity',
      'finance.cost.read': 'none',
    });
    const none = summarise(saved, saved);
    expect(none).toEqual({ added: 0, removed: 0, widened: 0, narrowed: 0 });
    expect(hasChanges(none)).toBe(false);

    const chosen = {
      ...saved,
      'crm.lead.read': 'own',
      'crm.lead.write': 'all',
      'crm.lead.assign': 'team',
      'finance.cost.read': 'entity',
      'pricing.read': 'none',
    } as const;
    const summary = summarise(saved, chosen);
    expect(summary).toEqual({ added: 2, removed: 1, widened: 1, narrowed: 1 });
    expect(hasChanges(summary)).toBe(true);
    expect(grantsOf(catalogue, chosen)).toEqual([
      { permission: 'crm.lead.read', scope: 'own' },
      { permission: 'crm.lead.write', scope: 'all' },
      { permission: 'crm.lead.assign', scope: 'team' },
      { permission: 'finance.cost.read', scope: 'entity' },
    ]);
  });

  it('groups permissions by module in catalogue order', () => {
    expect(byModule(catalogue).map((g) => [g.module, g.permissions.length])).toEqual([
      ['crm', 3],
      ['pricing', 1],
      ['finance', 1],
    ]);
  });
});
