import { describe, expect, it } from 'vitest';
import {
  AGENT_FORBIDDEN_PERMISSIONS,
  COST_PERMISSIONS,
  EXECUTIVE_KEPT_GRANTS,
  hasGrant,
  impliedScopes,
  isPlatformOnlyPermission,
  PERMISSION_KEYS,
  PLATFORM_ONLY_PERMISSIONS,
  serializeGrants,
} from './permissions';

describe('permission catalogue', () => {
  it('has unique keys in module.resource.action form', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z]+(\.[a-z]+){1,3}$/);
  });

  it('keeps platform-only permissions apart from the grants the Executive role keeps', () => {
    expect(isPlatformOnlyPermission('files.process')).toBe(true);
    expect(isPlatformOnlyPermission('crm.lead.read')).toBe(false);
    expect(isPlatformOnlyPermission('')).toBe(false);
    for (const g of EXECUTIVE_KEPT_GRANTS) {
      expect(PERMISSION_KEYS).toContain(g.key);
      expect(PLATFORM_ONLY_PERMISSIONS).not.toContain(g.key);
    }
  });

  it('lists both cost permissions among the agent-forbidden set', () => {
    for (const key of COST_PERMISSIONS) expect(AGENT_FORBIDDEN_PERMISSIONS).toContain(key);
  });
});

describe('scopes', () => {
  it('a wider scope implies every narrower one', () => {
    expect(impliedScopes('own')).toEqual(['own']);
    expect(impliedScopes('team')).toEqual(['own', 'team']);
    expect(impliedScopes('entity')).toEqual(['own', 'team', 'entity']);
    expect(impliedScopes('all')).toEqual(['own', 'team', 'entity', 'all']);
  });

  it('serialises grants with implied scopes for app.has_perm()', () => {
    const s = serializeGrants([
      { key: 'finance.cost.read', scope: 'all' },
      { key: 'crm.lead.read', scope: 'own' },
    ]);
    expect(s.split(',')).toEqual([
      'crm.lead.read:own',
      'finance.cost.read:all',
      'finance.cost.read:entity',
      'finance.cost.read:own',
      'finance.cost.read:team',
    ]);
  });

  it('hasGrant respects scope width', () => {
    const grants = [{ key: 'crm.lead.read' as const, scope: 'team' as const }];
    expect(hasGrant(grants, 'crm.lead.read', 'own')).toBe(true);
    expect(hasGrant(grants, 'crm.lead.read', 'team')).toBe(true);
    expect(hasGrant(grants, 'crm.lead.read', 'entity')).toBe(false);
    expect(hasGrant(grants, 'crm.lead.write', 'own')).toBe(false);
  });
});
