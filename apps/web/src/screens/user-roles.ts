import type { EntityRoleDto, UserDto } from '@shakti/contracts';

/** The role chosen for each company on the roles form: a role key, or '' for no access. */
export type RoleChoices = Readonly<Record<number, string>>;

/** The form's starting choices: the person's current role in each company offered. */
export function roleChoicesOf(
  current: readonly EntityRoleDto[],
  companies: readonly { id: number }[],
): Record<number, string> {
  return Object.fromEntries(
    companies.map((c) => [c.id, current.find((r) => r.entityId === c.id)?.roleKey ?? '']),
  );
}

/**
 * The `entityRoles` of `admin.user.invite` and `admin.user.role.set` from the form: one row per
 * company given a role, in the order the companies are offered. A company whose role is kept
 * keeps its team too, because setting the roles replaces every row and the form has no team
 * choice yet.
 */
export function entityRolesFrom(
  choices: RoleChoices,
  companies: readonly { id: number }[],
  current: readonly EntityRoleDto[] = [],
): { entityId: number; roleKey: string; teamId?: string }[] {
  return companies.flatMap((c) => {
    const roleKey = choices[c.id] ?? '';
    if (roleKey === '') return [];
    const kept = current.find((r) => r.entityId === c.id && r.roleKey === roleKey);
    return [
      kept?.teamId == null
        ? { entityId: c.id, roleKey }
        : { entityId: c.id, roleKey, teamId: kept.teamId },
    ];
  });
}

/** What an administrator may do to a row of the team list. */
export function userActions(user: UserDto, selfId: string) {
  const self = user.id === selfId;
  const gone = user.status === 'offboarded';
  return {
    changeRoles: !self && !gone,
    suspend: !self && (user.status === 'active' || user.status === 'invited'),
    reactivate: !self && user.status === 'suspended',
    resetAuthenticator: !self && !gone && user.twoFactorEnabled,
    liftLock: !self && !gone,
    // Leads move out of a person who works on them in some company; the screen checks the rest.
    moveLeads: !self && user.entityRoles.length > 0,
  };
}
