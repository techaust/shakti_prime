import { describe, expect, it } from 'vitest';
import { roleGrantsVersion } from './role-grants-version';

describe('roleGrantsVersion', () => {
  it('depends on the set, not its order, and changes with any scope', () => {
    const a = { permission: 'crm.lead.read', scope: 'own' };
    const b = { permission: 'pricing.read', scope: 'entity' };
    expect(roleGrantsVersion([a, b])).toBe(roleGrantsVersion([b, a]));
    expect(roleGrantsVersion([a, b])).toMatch(/^[0-9a-f]{64}$/);
    expect(roleGrantsVersion([a, { ...b, scope: 'all' }])).not.toBe(roleGrantsVersion([a, b]));
    expect(roleGrantsVersion([a])).not.toBe(roleGrantsVersion([a, b]));
    expect(roleGrantsVersion([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
