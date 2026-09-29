import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  roleId,
  withoutContext,
  type TestUser,
} from '../../src/testing/index';

// The tables that hold access itself: whoever can write them can grant themselves anything.
// Each attempt runs in a transaction that is always rolled back, so the permitted writes by the
// holder leave nothing behind (AUDIT M40).

afterAll(closeDb);

type Outcome = 'written' | 'none' | 'refused';
const ROLLBACK = new Error('rollback');

const refusedByDatabase = (e: unknown) =>
  e instanceof Error &&
  e.cause instanceof Error &&
  /row-level security|permission denied/.test(e.cause.message);

/** Runs `statement` as `principal` and rolls it back. Inserts count as written when accepted. */
async function attempt(principal: Principal, statement: SQL, kind: Kind): Promise<Outcome> {
  let outcome: Outcome | undefined;
  try {
    await asPrincipal(principal, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      outcome = kind === 'insert' || rows.length > 0 ? 'written' : 'none';
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK && outcome !== undefined) return outcome;
    if (refusedByDatabase(e)) return 'refused';
    throw e;
  }
  throw new Error('the attempt neither wrote nor failed');
}

async function attemptWithoutContext(statement: SQL, kind: Kind): Promise<Outcome> {
  try {
    const rows = await withoutContext(statement);
    return kind === 'insert' || rows.length > 0 ? 'written' : 'none';
  } catch (e) {
    if (refusedByDatabase(e)) return 'refused';
    throw e;
  }
}

type Kind = 'insert' | 'update' | 'delete';

interface Case {
  name: string;
  kind: Kind;
  statement: () => SQL;
}

let target: TestUser;
let principalOnly: string;
let team: string;

beforeAll(async () => {
  target = await createTestUser([{ entityId: 1, roleKey: 'field_engineer' }]);
  principalOnly = (await createTestPrincipal('field_engineer', [1])).id;
  team = await createTestTeam(1, 'write-policy team');
});

const CASES: Case[] = [
  {
    name: 'grant a permission to a role',
    kind: 'insert',
    statement: () =>
      sql`insert into role_permissions (role_id, permission_key, scope)
          values (${roleId('tele_caller_cc')}, 'finance.cost.read', 'all')`,
  },
  {
    name: 'widen a role permission',
    kind: 'update',
    statement: () =>
      sql`update role_permissions set scope = 'all'
          where role_id = ${roleId('tele_caller_cc')} and permission_key = 'crm.lead.read'
          returning role_id`,
  },
  {
    name: 'remove a permission from a role',
    kind: 'delete',
    statement: () =>
      sql`delete from role_permissions
          where role_id = ${roleId('tele_caller_cc')} and permission_key = 'crm.lead.read'
          returning role_id`,
  },
  {
    // The set of roles is fixed (AUDIT L17): editing one marks it customised (AUDIT M21).
    name: 'mark a role customised',
    kind: 'update',
    statement: () =>
      sql`update roles set customised_at = customised_at where key = 'tele_caller_lc' returning id`,
  },
  {
    name: 'rename a role',
    kind: 'update',
    statement: () => sql`update roles set name = name where key = 'tele_caller_cc' returning id`,
  },
  {
    name: 'add a permission to the catalogue',
    kind: 'insert',
    statement: () =>
      sql`insert into permissions (key, module, description)
          values (${`test.write_policy_${newId().slice(-8)}`}, 'test', 'Write policy probe')`,
  },
  {
    name: 'edit a permission',
    kind: 'update',
    statement: () =>
      sql`update permissions set description = description where key = 'crm.lead.read' returning key`,
  },
  {
    name: 'create a principal',
    kind: 'insert',
    statement: () =>
      sql`insert into principals (id, kind, display_name) values (${newId()}, 'user', 'Probe')`,
  },
  {
    name: 'edit a principal',
    kind: 'update',
    statement: () =>
      sql`update principals set display_name = display_name where id = ${principalOnly} returning id`,
  },
  {
    name: 'create a user',
    kind: 'insert',
    statement: () =>
      sql`insert into users (id, name, email)
          values (${principalOnly}, 'Probe', ${`probe-${newId().slice(-12)}@shakti.test`})`,
  },
  {
    name: 'change a user status',
    kind: 'update',
    statement: () => sql`update users set status = status where id = ${target.id} returning id`,
  },
  {
    name: 'give someone a role in an entity',
    kind: 'insert',
    statement: () =>
      sql`insert into user_entity_roles (id, user_id, entity_id, role_id)
          values (${newId()}, ${target.id}, 2, ${roleId('executive')})`,
  },
  {
    name: 'change the role someone holds',
    kind: 'update',
    statement: () =>
      sql`update user_entity_roles set role_id = ${roleId('executive')}
          where user_id = ${target.id} returning id`,
  },
  {
    name: 'remove the roles someone holds',
    kind: 'delete',
    statement: () => sql`delete from user_entity_roles where user_id = ${target.id} returning id`,
  },
  {
    name: 'create a team',
    kind: 'insert',
    statement: () =>
      sql`insert into teams (id, entity_id, name) values (${newId()}, 1, 'Probe team')`,
  },
  {
    name: 'edit a team',
    kind: 'update',
    statement: () => sql`update teams set name = name where id = ${team} returning id`,
  },
  {
    name: 'create an entity',
    kind: 'insert',
    statement: () =>
      sql`insert into entities (id, code, legal_name, brand_name, state_code)
          values (99, 'PROBE', 'Probe Private Limited', 'Probe', '08')`,
  },
  {
    name: 'edit an entity',
    kind: 'update',
    statement: () => sql`update entities set brand_name = brand_name where id = 1 returning id`,
  },
];

/** Roles that must never write access, agents included. */
const NON_HOLDERS: RoleKey[] = [
  'general_manager',
  'sales_team_lead',
  'tele_caller_cc',
  'accounts',
  'hr_admin',
  'agent:chief',
  'agent:triage',
];

describe('only the Executive writes the tables that hold access', () => {
  it.each(CASES)('the Executive may $name', async ({ statement, kind }) => {
    expect(await attempt(principalFor('executive'), statement(), kind)).toBe('written');
  });

  describe.each(NON_HOLDERS)('%s', (roleKey) => {
    it.each(CASES)('may not $name', async ({ statement, kind }) => {
      const outcome = await attempt(principalFor(roleKey), statement(), kind);
      expect(outcome).toBe(kind === 'insert' ? 'refused' : 'none');
    });
  });

  it.each(CASES)('a connection with no context may not $name', async ({ statement, kind }) => {
    const outcome = await attemptWithoutContext(statement(), kind);
    expect(outcome).toBe(kind === 'insert' ? 'refused' : 'none');
  });
});
