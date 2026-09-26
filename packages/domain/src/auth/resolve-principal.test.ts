import type { UserGrantRow } from '@shakti/db';
import { describe, expect, it } from 'vitest';
import { groupUserGrants, intersectGrants, resolvePrincipalFromGrants } from './resolve-principal';

const base: Omit<
  UserGrantRow,
  'entityId' | 'entityName' | 'roleKey' | 'teamId' | 'permissionKey' | 'scope'
> = {
  status: 'active',
  locale: 'hi',
  theme: 'dark',
  name: 'Asha',
  email: 'asha@shakti.test',
  twoFactorEnabled: true,
};

function row(
  entityId: number,
  roleKey: string,
  permissionKey: string,
  scope: string,
  teamId: string | null = null,
): UserGrantRow {
  return {
    ...base,
    entityId,
    entityName: `entity ${entityId}`,
    roleKey,
    teamId,
    permissionKey,
    scope,
  };
}

const userId = '01990000-0000-7000-8000-0000000000aa';
const teamId = '01990000-0000-7000-8000-0000000000bb';

describe('intersectGrants', () => {
  it('keeps a key only when every entity holds it, at the narrowest scope', () => {
    const grants = intersectGrants([
      {
        entityId: 1,
        entityName: 'one',
        roleKey: 'executive',
        teamId: null,
        grants: [
          { key: 'crm.lead.read', scope: 'all' },
          { key: 'pricing.write', scope: 'all' },
        ],
      },
      {
        entityId: 2,
        entityName: 'two',
        roleKey: 'tele_caller_cc',
        teamId: null,
        grants: [{ key: 'crm.lead.read', scope: 'own' }],
      },
    ]);
    expect(grants).toEqual([{ key: 'crm.lead.read', scope: 'own' }]);
  });

  it('is the row itself for a single entity and empty for none', () => {
    expect(
      intersectGrants([
        {
          entityId: 3,
          entityName: 'three',
          roleKey: 'accounts',
          teamId: null,
          grants: [{ key: 'finance.cost.read', scope: 'entity' }],
        },
      ]),
    ).toEqual([{ key: 'finance.cost.read', scope: 'entity' }]);
    expect(intersectGrants([])).toEqual([]);
  });
});

describe('resolvePrincipalFromGrants', () => {
  const rows = [
    row(1, 'executive', 'crm.lead.read', 'all'),
    row(1, 'executive', 'admin.users.write', 'all'),
    row(2, 'sales_team_lead', 'crm.lead.read', 'team', teamId),
    row(2, 'sales_team_lead', 'crm.lead.write', 'team', teamId),
  ];

  it('single-entity mode takes that row: role, grants and team', () => {
    const outcome = resolvePrincipalFromGrants(userId, rows, 2);
    expect(outcome.kind).toBe('principal');
    if (outcome.kind !== 'principal') return;
    expect(outcome.principal).toEqual({
      id: userId,
      kind: 'user',
      roleKey: 'sales_team_lead',
      entityIds: [2],
      permissions: [
        { key: 'crm.lead.read', scope: 'team' },
        { key: 'crm.lead.write', scope: 'team' },
      ],
      locale: 'hi',
      teamId,
    });
  });

  it('all-entities mode intersects grants, shows the narrowest role and drops the team', () => {
    const outcome = resolvePrincipalFromGrants(userId, rows);
    expect(outcome.kind).toBe('principal');
    if (outcome.kind !== 'principal') return;
    expect(outcome.principal.entityIds).toEqual([1, 2]);
    expect(outcome.principal.permissions).toEqual([{ key: 'crm.lead.read', scope: 'team' }]);
    expect(outcome.principal.roleKey).toBe('executive');
    expect(outcome.principal.teamId).toBeUndefined();
  });

  it('an entity outside the user’s access falls back to all entities', () => {
    const outcome = resolvePrincipalFromGrants(userId, rows, 9);
    expect(outcome.kind).toBe('principal');
    if (outcome.kind !== 'principal') return;
    expect(outcome.principal.entityIds).toEqual([1, 2]);
  });

  it('requires an authenticator for Executive, GM and Accounts until enrolled', () => {
    const notEnrolled = rows.map((r) => ({ ...r, twoFactorEnabled: false }));
    expect(resolvePrincipalFromGrants(userId, notEnrolled).kind).toBe('totp_required');
    const caller = [row(1, 'tele_caller_cc', 'crm.lead.read', 'own')].map((r) => ({
      ...r,
      twoFactorEnabled: false,
    }));
    expect(resolvePrincipalFromGrants(userId, caller).kind).toBe('principal');
  });

  it('a suspended, invited or unknown user resolves to nothing', () => {
    expect(
      resolvePrincipalFromGrants(
        userId,
        rows.map((r) => ({ ...r, status: 'suspended' })),
      ),
    ).toEqual({
      kind: 'inactive',
      status: 'suspended',
    });
    expect(
      resolvePrincipalFromGrants(
        userId,
        rows.map((r) => ({ ...r, status: 'invited' })),
      ),
    ).toEqual({
      kind: 'inactive',
      status: 'invited',
    });
    expect(resolvePrincipalFromGrants(userId, [])).toEqual({ kind: 'unknown' });
  });

  it('a user without any entity row has no access', () => {
    const noRoles: UserGrantRow[] = [
      {
        ...base,
        entityId: null,
        entityName: null,
        roleKey: null,
        teamId: null,
        permissionKey: null,
        scope: null,
      },
    ];
    expect(resolvePrincipalFromGrants(userId, noRoles)).toEqual({ kind: 'no_access' });
    expect(groupUserGrants(noRoles)?.entities).toEqual([]);
  });
});
