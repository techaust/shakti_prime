import { PLATFORM_ONLY_PERMISSIONS, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { asMigrator, asPrincipal, closeDb, principalFor, roleId } from '../../src/testing/index';

// The role editor's database rules (docs/SECURITY.md §3.1): a role's grants reach every company,
// so they are written only by admin.roles.write:all in a request acting for every company, and a
// platform-only permission is refused for any role that is not a system role, whoever writes.
// Every attempt is rolled back.

afterAll(closeDb);

const ROLLBACK = new Error('rollback');

type Outcome = 'written' | 'none' | 'refused' | 'platform_only';

function classify(e: unknown): Outcome | undefined {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  if (!(cause instanceof Error)) return undefined;
  const c = cause as Error & { code?: string; constraint_name?: string };
  if (c.code === '23514' && c.constraint_name === 'role_permissions_platform_only') {
    return 'platform_only';
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
    expect(await attempt(principalFor('executive'), grantPlatformOnly(roleId('agent:triage')))).toBe(
      'platform_only',
    );
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

  it.each(writes)(
    'the Executive acting for one company may not %s',
    async (name, statement) => {
      const outcome = await attempt(principalFor('executive', [1]), statement());
      expect(outcome).toBe(name === 'add a grant' ? 'refused' : 'none');
    },
  );

  it.each(writes)('the General Manager may not %s', async (name, statement) => {
    const outcome = await attempt(principalFor('general_manager'), statement());
    expect(outcome).toBe(name === 'add a grant' ? 'refused' : 'none');
  });
});
