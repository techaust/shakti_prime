import { SetUserRolesInput, type UserDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { entityRolesFrom, roleChoicesOf, userActions } from './user-roles';

const companies = [{ id: 1 }, { id: 2 }, { id: 3 }];
const team = '01990000-0000-7000-8000-00000000a001';

describe('the roles form', () => {
  it('starts from the person’s current role in each company offered', () => {
    expect(
      roleChoicesOf(
        [
          { entityId: 2, roleKey: 'accounts', teamId: null },
          { entityId: 4, roleKey: 'hr_admin', teamId: null },
        ],
        companies,
      ),
    ).toEqual({ 1: '', 2: 'accounts', 3: '' });
  });

  it('sends one role per company given one, keeping the team of a role that stays', () => {
    const current = [
      { entityId: 1, roleKey: 'tele_caller_cc' as const, teamId: team },
      { entityId: 2, roleKey: 'accounts' as const, teamId: team },
    ];
    const rows = entityRolesFrom(
      { 1: 'tele_caller_cc', 2: 'store_manager', 3: '' },
      companies,
      current,
    );
    expect(rows).toEqual([
      { entityId: 1, roleKey: 'tele_caller_cc', teamId: team },
      { entityId: 2, roleKey: 'store_manager' },
    ]);
    expect(
      SetUserRolesInput.safeParse({
        userId: '01990000-0000-7000-8000-00000000a002',
        entityRoles: rows,
      }).success,
    ).toBe(true);
  });

  it('sends nothing for a person given no role, which the contract refuses', () => {
    expect(entityRolesFrom({ 1: '', 2: '' }, companies)).toEqual([]);
  });
});

describe('row actions', () => {
  const user = (over: Partial<UserDto>): UserDto => ({
    id: 'u1',
    email: 'meena@shakti.in',
    displayName: 'Meena',
    phone: null,
    status: 'active',
    theme: 'system',
    twoFactorEnabled: true,
    lastLoginAt: null,
    entityRoles: [],
    updatedAt: '2026-09-27T00:00:00.000Z',
    ...over,
  });

  it('never offers an administrator a change to their own access', () => {
    expect(Object.values(userActions(user({ id: 'me' }), 'me'))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('offers reactivation only to a suspended person, and a reset only when an app is set up', () => {
    expect(userActions(user({ status: 'suspended' }), 'me')).toMatchObject({
      suspend: false,
      reactivate: true,
    });
    expect(userActions(user({ twoFactorEnabled: false }), 'me').resetAuthenticator).toBe(false);
    expect(userActions(user({ status: 'offboarded' }), 'me')).toMatchObject({
      changeRoles: false,
      liftLock: false,
    });
  });
});
