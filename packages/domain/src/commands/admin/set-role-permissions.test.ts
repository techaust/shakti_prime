import { DomainError, type RoleGrantInput } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { assertEditableGrants } from './set-role-permissions';

const executiveAdmin: RoleGrantInput[] = [
  { permission: 'admin.roles.write', scope: 'all' },
  { permission: 'admin.users.write', scope: 'all' },
];

/** The refusal `assertEditableGrants` answers, or undefined when it accepts the set. */
function refusal(roleKey: string, grants: readonly RoleGrantInput[]) {
  try {
    assertEditableGrants(roleKey, grants);
    return undefined;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return { code: e.code, details: e.details };
  }
}

describe('assertEditableGrants', () => {
  it('accepts any staff role, including an empty set for a role other than Executive', () => {
    expect(refusal('hr_admin', [])).toBeUndefined();
    expect(
      refusal('tele_caller_cc', [{ permission: 'crm.lead.read', scope: 'own' }]),
    ).toBeUndefined();
    expect(refusal('executive', executiveAdmin)).toBeUndefined();
  });

  it('refuses agent roles, system roles and unknown roles', () => {
    for (const key of ['agent:triage', 'agent:chief', 'system:workers', 'owner', '']) {
      expect(refusal(key, [])).toEqual({
        code: 'forbidden',
        details: { reason: 'role_not_editable' },
      });
    }
  });

  it('refuses a platform-only permission for any staff role', () => {
    // Reaches the command only once the key is in the catalogue; the check does not wait for it.
    const grants = [{ permission: 'files.process', scope: 'all' }] as unknown as RoleGrantInput[];
    for (const key of ['executive', 'hr_admin']) {
      expect(refusal(key, [...executiveAdmin, ...grants])).toEqual({
        code: 'validation_failed',
        details: { reason: 'permission_platform_only', permissions: ['files.process'] },
      });
    }
  });

  it('keeps both admin grants at all on the Executive role, and on no other role', () => {
    const keep = { code: 'validation_failed', details: { reason: 'executive_keeps_admin' } };
    expect(refusal('executive', [])).toEqual(keep);
    expect(refusal('executive', executiveAdmin.slice(0, 1))).toEqual(keep);
    expect(
      refusal('executive', [
        { permission: 'admin.roles.write', scope: 'all' },
        { permission: 'admin.users.write', scope: 'entity' },
      ]),
    ).toEqual(keep);
    expect(refusal('general_manager', [])).toBeUndefined();
  });
});
