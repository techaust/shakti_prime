import {
  PERMISSION_KEYS,
  PERMISSION_SCOPES,
  PLATFORM_ONLY_PERMISSIONS,
  ROLE_KEYS,
  roleMayHold,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  grantsForRole,
  principalFor,
  roleId,
  withoutContext,
} from '../../src/testing/index';

// The role editor's database rules (docs/07-security.md §3.1): a role's grants reach every company,
// so they are written only by admin.roles.write:all in a request acting for every company; who may
// hold a permission at all (a platform-only one only a system role, admin.* and the replay of
// failed messages only the Executive role, a cost permission only its listed roles) is refused,
// whoever writes; and no transaction leaves the Executive role without its admin grants. Every
// attempt is rolled back.

afterAll(closeDb);

const ROLLBACK = new Error('rollback');

type Outcome = 'written' | 'none' | 'refused' | 'platform_only' | 'holder' | 'executive_keeps';

function classify(e: unknown): Outcome | undefined {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  if (!(cause instanceof Error)) return undefined;
  const c = cause as Error & { code?: string; constraint_name?: string };
  if (c.code === '23514' && c.constraint_name === 'role_permissions_platform_only') {
    return 'platform_only';
  }
  if (c.code === '23514' && c.constraint_name === 'role_permissions_holder') return 'holder';
  if (c.code === '23514' && c.constraint_name === 'role_permissions_executive_keeps_admin') {
    return 'executive_keeps';
  }
  if (/row-level security|permission denied/.test(c.message)) return 'refused';
  return undefined;
}

async function attempt(principal: Principal, statement: SQL): Promise<Outcome> {
  let outcome: Outcome | undefined;
  try {
    await asPrincipal(principal, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      outcome = rows.length > 0 ? 'written' : 'none';
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK && outcome !== undefined) return outcome;
    const known = classify(e);
    if (known !== undefined) return known;
    throw e;
  }
  throw new Error('the attempt neither wrote nor failed');
}

const grantPlatformOnly = (role: string) =>
  sql`insert into role_permissions (role_id, permission_key, scope)
      values (${role}, ${PLATFORM_ONLY_PERMISSIONS[0] ?? ''}, 'all') returning role_id`;

const removeGrant = () =>
  sql`delete from role_permissions
      where role_id = ${roleId('hr_admin')} and permission_key = 'hr.export' returning role_id`;

const rescopeGrant = () =>
  sql`update role_permissions set scope = 'entity'
      where role_id = ${roleId('hr_admin')} and permission_key = 'hr.export' returning role_id`;

const addGrant = () =>
  sql`insert into role_permissions (role_id, permission_key, scope)
      values (${roleId('hr_admin')}, 'pricing.read', 'entity') returning role_id`;

const markCustomised = () =>
  sql`update roles set customised_at = now() where id = ${roleId('hr_admin')} returning id`;

describe('platform-only permissions', () => {
  it('match the contract list', async () => {
    const [row] = await asMigrator(
      (m) => m<{ keys: string[] }[]>`select app.platform_only_permissions() as keys`,
    );
    expect([...(row?.keys ?? [])].sort()).toEqual([...PLATFORM_ONLY_PERMISSIONS].sort());
  });

  it('are refused for a staff role even for the Executive', async () => {
    for (const role of ['executive', 'hr_admin', 'general_manager'] as const) {
      expect(await attempt(principalFor('executive'), grantPlatformOnly(roleId(role)))).toBe(
        'platform_only',
      );
    }
  });

  it('are refused for an agent role and for the table owner too', async () => {
    expect(
      await attempt(principalFor('executive'), grantPlatformOnly(roleId('agent:triage'))),
    ).toBe('platform_only');
    const refused = await asMigrator(async (m) => {
      try {
        await m`insert into role_permissions (role_id, permission_key, scope)
                values (${roleId('hr_admin')}, ${PLATFORM_ONLY_PERMISSIONS[0] ?? ''}, 'all')`;
        return false;
      } catch (e) {
        return classify(e) === 'platform_only';
      }
    });
    expect(refused).toBe(true);
  });

  it('cannot be reached by moving an existing grant onto one', async () => {
    const move = sql`update role_permissions set permission_key = ${PLATFORM_ONLY_PERMISSIONS[0] ?? ''}
                     where role_id = ${roleId('hr_admin')} and permission_key = 'hr.export'
                     returning role_id`;
    expect(await attempt(principalFor('executive'), move)).toBe('platform_only');
  });
});

describe("a role's grants are written only for every company at once", () => {
  const writes = [
    ['add a grant', addGrant],
    ['remove a grant', removeGrant],
    ['change a scope', rescopeGrant],
    ['mark the role customised', markCustomised],
  ] as const;

  it.each(writes)('the Executive acting for every company may %s', async (_name, statement) => {
    expect(await attempt(principalFor('executive'), statement())).toBe('written');
  });

  it.each(writes)('the Executive acting for one company may not %s', async (name, statement) => {
    const outcome = await attempt(principalFor('executive', [1]), statement());
    expect(outcome).toBe(name === 'add a grant' ? 'refused' : 'none');
  });

  it.each(writes)('the General Manager may not %s', async (name, statement) => {
    const outcome = await attempt(principalFor('general_manager'), statement());
    expect(outcome).toBe(name === 'add a grant' ? 'refused' : 'none');
  });
});

describe('who may hold a permission (BLUEPRINT 7.1 to 7.3)', () => {
  it('app.role_may_hold() answers as roleMayHold() for every role and permission', async () => {
    const roles = [...ROLE_KEYS, 'system:workers'];
    const permissions = [...PERMISSION_KEYS, ...PLATFORM_ONLY_PERMISSIONS];
    const rows = await asMigrator(
      (m) => m<{ role: string; permission: string; may: boolean }[]>`
        select r as role, p as permission, app.role_may_hold(r, p) as may
          from unnest(${roles}::text[]) r cross join unnest(${permissions}::text[]) p`,
    );
    expect(rows).toHaveLength(roles.length * permissions.length);
    const differ = rows.filter((row) => row.may !== roleMayHold(row.role, row.permission));
    expect(differ).toEqual([]);
  });

  it('the seeded matrix keeps to the holder rules and the scopes each permission honours', () => {
    for (const role of ROLE_KEYS) {
      for (const g of grantsForRole(role)) {
        expect(roleMayHold(role, g.key), `${role} ${g.key}`).toBe(true);
        if (!role.startsWith('agent:')) {
          expect(PERMISSION_SCOPES[g.key], `${role} ${g.key}`).toContain(g.scope);
        }
      }
    }
  });

  it.each([
    ['general_manager', 'finance.cost.read', 'entity'],
    ['inventory_manager', 'finance.cost.read', 'entity'],
    ['sales_team_lead', 'procurement.rate.read', 'entity'],
    ['accounts', 'admin.users.write', 'all'],
    ['hr_admin', 'integrations.dlq.replay', 'all'],
    ['agent:chief', 'finance.cost.read', 'entity'],
  ] as const)('refuses %s holding %s, even for the Executive', async (role, permission, scope) => {
    const insert = sql`insert into role_permissions (role_id, permission_key, scope)
      values (${roleId(role)}, ${permission}, ${scope}) returning role_id`;
    expect(await attempt(principalFor('executive'), insert)).toBe('holder');
  });

  it('refuses moving an existing grant onto a permission the role may not hold', async () => {
    const move = sql`update role_permissions set permission_key = 'admin.flags.write'
                     where role_id = ${roleId('hr_admin')} and permission_key = 'hr.export'
                     returning role_id`;
    expect(await attempt(principalFor('executive'), move)).toBe('holder');
  });

  it('lets the allowed roles hold a cost permission', async () => {
    const insert = sql`insert into role_permissions (role_id, permission_key, scope)
      values (${roleId('inventory_manager')}, 'procurement.rate.read', 'all')
      on conflict (role_id, permission_key) do update set scope = excluded.scope
      returning role_id`;
    expect(await attempt(principalFor('executive'), insert)).toBe('written');
  });
});

describe('the Executive role keeps its admin grants in every transaction', () => {
  const dropRoles = sql`delete from role_permissions
    where role_id = ${roleId('executive')} and permission_key = 'admin.roles.write' returning role_id`;
  const narrowUsers = sql`update role_permissions set scope = 'entity'
    where role_id = ${roleId('executive')} and permission_key = 'admin.users.write' returning role_id`;
  const putBack = sql`insert into role_permissions (role_id, permission_key, scope)
    values (${roleId('executive')}, 'admin.roles.write', 'all') returning role_id`;
  const check = sql`set constraints all immediate`;

  it.each([
    ['takes admin.roles.write away', [dropRoles]],
    ['narrows admin.users.write', [narrowUsers]],
  ] as const)('refuses a transaction that %s, at commit', async (_name, statements) => {
    let outcome: Outcome | undefined;
    try {
      await asPrincipal(principalFor('executive'), async ({ tx }) => {
        for (const s of statements) await tx.execute(s);
        await tx.execute(check);
        outcome = 'written';
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) outcome = classify(e);
    }
    expect(outcome).toBe('executive_keeps');
  });

  it('lets a transaction rewrite the grants and put them back, as the seed does', async () => {
    let outcome: Outcome | undefined;
    try {
      await asPrincipal(principalFor('executive'), async ({ tx }) => {
        await tx.execute(dropRoles);
        await tx.execute(putBack);
        await tx.execute(check);
        outcome = 'written';
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) outcome = classify(e);
    }
    expect(outcome).toBe('written');
  });
});

describe('the catalogue and the set of roles belong to the seed', () => {
  it('lets app_user update only the customised mark of a role, and add or edit no catalogue row', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'roles', 'INSERT') as role_insert,
             has_column_privilege('app_user', 'roles', 'customised_at', 'UPDATE') as customised,
             has_column_privilege('app_user', 'roles', 'updated_by', 'UPDATE') as updated_by,
             has_column_privilege('app_user', 'roles', 'key', 'UPDATE') as key,
             has_column_privilege('app_user', 'roles', 'is_system', 'UPDATE') as is_system,
             has_column_privilege('app_user', 'roles', 'name', 'UPDATE') as name,
             has_table_privilege('app_user', 'permissions', 'INSERT') as permission_insert,
             has_table_privilege('app_user', 'permissions', 'UPDATE') as permission_update
    `);
    expect(row).toEqual({
      role_insert: false,
      customised: true,
      updated_by: true,
      key: false,
      is_system: false,
      name: false,
      permission_insert: false,
      permission_update: false,
    });
  });

  it.each([
    [
      'rename a role',
      () => sql`update roles set name = name where key = 'tele_caller_cc' returning id`,
    ],
    [
      'add a role',
      () =>
        sql`insert into roles (id, key, name) values (gen_random_uuid(), 'executive', 'Probe') returning id`,
    ],
    [
      'add a permission',
      () =>
        sql`insert into permissions (key, module, description) values ('probe.write', 'probe', 'Probe') returning key`,
    ],
    [
      'edit a permission',
      () =>
        sql`update permissions set description = description where key = 'crm.lead.read' returning key`,
    ],
  ] as const)('refuses the Executive who tries to %s', async (_name, statement) => {
    expect(await attempt(principalFor('executive'), statement())).toBe('refused');
  });
});
