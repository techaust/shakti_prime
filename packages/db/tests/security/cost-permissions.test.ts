import {
  AGENT_FORBIDDEN_PERMISSIONS,
  AGENT_ROLE_KEYS,
  COST_PERMISSIONS,
  ROLE_KEYS,
  STAFF_ROLE_KEYS,
  type PermissionKey,
  type StaffRoleKey,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { asPrincipal, closeDb, grantsForRole, principalFor, roleId } from '../../src/testing/index';

afterAll(closeDb);

/** Who holds each cost permission (docs/SECURITY.md §3.2, §7.2 of the blueprint). */
const HOLDERS: Record<(typeof COST_PERMISSIONS)[number], readonly StaffRoleKey[]> = {
  'finance.cost.read': ['executive', 'accounts'],
  'procurement.rate.read': ['executive', 'inventory_manager', 'accounts'],
};

async function seededGrants(roleKey: (typeof ROLE_KEYS)[number]) {
  return asPrincipal(principalFor('executive'), async ({ tx }) => {
    const rows = (await tx.execute(sql`
      select permission_key as key, scope from role_permissions
      where role_id = ${roleId(roleKey)} order by permission_key
    `)) as unknown as { key: PermissionKey; scope: string }[];
    return rows;
  });
}

describe('seeded matrix equals docs/SECURITY.md §3.2', () => {
  it.each(ROLE_KEYS)('%s', async (roleKey) => {
    const expected = grantsForRole(roleKey)
      .map((g) => ({ key: g.key, scope: g.scope }))
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(await seededGrants(roleKey)).toEqual(expected);
  });
});

describe.each(COST_PERMISSIONS)('%s', (permission) => {
  it.each(STAFF_ROLE_KEYS)('%s holds it only if listed', async (roleKey) => {
    const holds = (await seededGrants(roleKey)).some((g) => g.key === permission);
    expect(holds).toBe(HOLDERS[permission].includes(roleKey));
  });

  it.each(STAFF_ROLE_KEYS)(
    'app.has_perm() agrees for %s inside a request context',
    async (roleKey) => {
      const answer = await asPrincipal(principalFor(roleKey, [1]), async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select app.has_perm(${`${permission}:entity`}) as p`,
        )) as unknown as { p: boolean }[];
        return rows[0]?.p;
      });
      expect(answer).toBe(HOLDERS[permission].includes(roleKey));
    },
  );

  it('is never granted to an agent principal', async () => {
    for (const agent of AGENT_ROLE_KEYS) {
      const grants = await seededGrants(agent);
      expect(grants.map((g) => g.key)).not.toContain(permission);
    }
  });
});

describe('the General Manager', () => {
  it('sees operations but neither supplier rates nor costs', async () => {
    const keys = (await seededGrants('general_manager')).map((g) => g.key);
    expect(keys).toContain('inventory.stock.read');
    expect(keys).toContain('crm.lead.read');
    expect(keys).not.toContain('procurement.rate.read');
    expect(keys).not.toContain('finance.cost.read');
  });
});

describe('the Inventory Manager', () => {
  it('sees supplier rates but no costs or margins', async () => {
    const keys = (await seededGrants('inventory_manager')).map((g) => g.key);
    expect(keys).toContain('procurement.rate.read');
    expect(keys).not.toContain('finance.cost.read');
  });
});

describe('agent principals', () => {
  it.each(AGENT_ROLE_KEYS)(
    '%s holds no cost, admin, sensitive-document or executive-vault permission',
    async (agent) => {
      const keys = (await seededGrants(agent)).map((g) => g.key);
      for (const forbidden of AGENT_FORBIDDEN_PERMISSIONS) expect(keys).not.toContain(forbidden);
    },
  );

  it('has_perm() denies cost permissions for every agent context', async () => {
    for (const agent of AGENT_ROLE_KEYS) {
      const answer = await asPrincipal(principalFor(agent, [1]), async ({ tx }) => {
        const rows = (await tx.execute(sql`
          select app.has_perm('finance.cost.read:own') as c, app.has_perm('procurement.rate.read:own') as r
        `)) as unknown as { c: boolean; r: boolean }[];
        return rows[0];
      });
      expect(answer).toEqual({ c: false, r: false });
    }
  });
});
