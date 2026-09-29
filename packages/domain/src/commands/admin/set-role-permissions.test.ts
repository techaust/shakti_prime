import type { RoleGrantInput } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { assertEditableGrants } from './set-role-permissions';

const executiveAdmin: RoleGrantInput[] = [
  { permission: 'admin.roles.write', scope: 'all' },
  { permission: 'admin.users.write', scope: 'all' },
];

describe('assertEditableGrants', () => {
  it('accepts any staff role, including an empty set for a role other than Executive', () => {
    expect(() => assertEditableGrants('hr_admin', [])).not.toThrow();
    expect(() =>
      assertEditableGrants('tele_caller_cc', [{ permission: 'crm.lead.read', scope: 'own' }]),
    ).not.toThrow();
    expect(() => assertEditableGrants('executive', executiveAdmin)).not.toThrow();
  });

  it('refuses agent roles, system roles and unknown roles', () => {
    for (const key of ['agent:triage', 'agent:chief', 'system:workers', 'owner', '']) {
      expect(() => assertEditableGrants(key, [])).toThrow(
        expect.objectContaining({ code: 'forbidden', details: { reason: 'role_not_editable' } }),
      );
    }
  });

  it('refuses a platform-only permission for any staff role', () => {
    // Reaches the command only once the key is in the catalogue; the check does not wait for it.
    const grants = [{ permission: 'files.process', scope: 'all' }] as unknown as RoleGrantInput[];
    for (const key of ['executive', 'hr_admin']) {
      expect(() => assertEditableGrants(key, [...executiveAdmin, ...grants])).toThrow(
        expect.objectContaining({
          code: 'validation_failed',
          details: { reason: 'permission_platform_only', permissions: ['files.process'] },
        }),
      );
    }
  });

  it('keeps both admin grants at all on the Executive role, and on no other role', () => {
    const keep = expect.objectContaining({ details: { reason: 'executive_keeps_admin' } });
    expect(() => assertEditableGrants('executive', [])).toThrow(keep);
    expect(() => assertEditableGrants('executive', [executiveAdmin[0]!])).toThrow(keep);
    expect(() =>
      assertEditableGrants('executive', [
        { permission: 'admin.roles.write', scope: 'all' },
        { permission: 'admin.users.write', scope: 'entity' },
      ]),
    ).toThrow(keep);
    expect(() => assertEditableGrants('general_manager', [])).not.toThrow();
  });
});
