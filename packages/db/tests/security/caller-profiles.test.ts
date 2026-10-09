import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// Caller profiles and the handover's definers (docs/03-roadmap-appendix/phase1.md §8.2, DATABASE §6.2): a
// person reads their own profile and changes only its presence; whoever may assign leads manages
// the profiles in their scope; the handover permission is the worker's alone. The suites never
// clean these tables, so every row here is found by this run's own ids.

afterAll(closeDb);

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const CO = 4;
let team: string;
let otherTeam: string;
let person: Principal;
let colleague: Principal;
let outsider: Principal;
let teamLead: Principal;
let otherTeamLead: Principal;
let gm: Principal;
let gmElsewhere: Principal;
const profiles: Record<string, string> = {};

beforeAll(async () => {
  team = await createTestTeam(CO, 'profiles team');
  otherTeam = await createTestTeam(CO, 'profiles other team');
  const make = (role: 'tele_caller_lc' | 'sales_team_lead' | 'general_manager', teamId?: string) =>
    createTestUser([{ entityId: CO, roleKey: role, ...(teamId ? { teamId } : {}) }]);
  const a = await make('tele_caller_lc', team);
  const b = await make('tele_caller_lc', team);
  const c = await make('tele_caller_lc', otherTeam);
  const t = await make('sales_team_lead', team);
  const t2 = await make('sales_team_lead', otherTeam);
  const g = await make('general_manager');
  const g2 = await createTestUser([{ entityId: 2, roleKey: 'general_manager' }]);
  person = principalFor('tele_caller_lc', [CO], { id: a.id, teamId: team });
  colleague = principalFor('tele_caller_lc', [CO], { id: b.id, teamId: team });
  outsider = principalFor('tele_caller_lc', [CO], { id: c.id, teamId: otherTeam });
  teamLead = principalFor('sales_team_lead', [CO], { id: t.id, teamId: team });
  otherTeamLead = principalFor('sales_team_lead', [CO], { id: t2.id, teamId: otherTeam });
  gm = principalFor('general_manager', [CO], { id: g.id });
  gmElsewhere = principalFor('general_manager', [2], { id: g2.id });
  for (const [name, user] of [
    ['person', a.id],
    ['colleague', b.id],
    ['outsider', c.id],
  ] as const) {
    const id = newId();
    profiles[name] = id;
    await asMigrator(
      (m) => m`insert into caller_profiles (id, user_id, entity_id, is_converter, presence)
        values (${id}, ${user}, ${CO}, true, 'away')`,
    );
  }
});

const visible = (principal: Principal) =>
  rows<{ id: string }>(
    principal,
    sql`select id from caller_profiles where id = any(${`{${Object.values(profiles).join(',')}}`}::uuid[])`,
  ).then((r) => r.map((x) => x.id).sort());
const ids = (...names: string[]) => names.map((n) => profiles[n] ?? '').sort();

describe('who reads a caller profile', () => {
  it('shows nothing without a request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from caller_profiles`,
    );
    expect(row?.n).toBe(0);
  });

  it('shows a person their own profile only', async () => {
    expect(await visible(person)).toEqual(ids('person'));
    expect(await visible(outsider)).toEqual(ids('outsider'));
  });

  it('shows a team lead their team and a General Manager the company, never another company', async () => {
    expect(await visible(teamLead)).toEqual(ids('person', 'colleague'));
    expect(await visible(otherTeamLead)).toEqual(ids('outsider'));
    expect(await visible(gm)).toEqual(ids('person', 'colleague', 'outsider'));
    expect(await visible(gmElsewhere)).toEqual([]);
  });

  it('lets the reader pool read what a person may read', async () => {
    const [row] = await asMigrator(
      (m) =>
        m<
          { ok: boolean }[]
        >`select has_table_privilege('app_reader', 'caller_profiles', 'select') as ok`,
    );
    expect(row?.ok).toBe(true);
  });
});

describe('who writes a caller profile', () => {
  it('lets a person change only their own presence', async () => {
    await rows(
      person,
      sql`update caller_profiles set presence = 'present' where id = ${profiles.person}::uuid`,
    );
    const [row] = await asMigrator(
      (m) =>
        m<
          { presence: string }[]
        >`select presence from caller_profiles where id = ${profiles.person}`,
    );
    expect(row?.presence).toBe('present');
    expect(
      await failure(
        rows(
          person,
          sql`update caller_profiles set max_open = 99 where id = ${profiles.person}::uuid`,
        ),
      ),
    ).toMatch(/only their own presence/);
    expect(
      await failure(
        rows(
          person,
          sql`update caller_profiles set is_converter = false where id = ${profiles.person}::uuid`,
        ),
      ),
    ).toMatch(/only their own presence/);
  });

  it('changes nobody else’s row for a person', async () => {
    const changed = await rows(
      person,
      sql`update caller_profiles set presence = 'present' where id = ${profiles.colleague}::uuid returning id`,
    );
    expect(changed).toHaveLength(0);
  });

  it('lets a manager edit a profile in their scope and not outside it', async () => {
    await rows(
      teamLead,
      sql`update caller_profiles set max_open = 4, languages = '{en}' where id = ${profiles.colleague}::uuid`,
    );
    const outside = await rows(
      teamLead,
      sql`update caller_profiles set max_open = 4 where id = ${profiles.outsider}::uuid returning id`,
    );
    expect(outside).toHaveLength(0);
    const whole = await rows(
      gm,
      sql`update caller_profiles set segments = '{farmer_pumps}' where id = ${profiles.outsider}::uuid returning id`,
    );
    expect(whole).toHaveLength(1);
    const elsewhere = await rows(
      gmElsewhere,
      sql`update caller_profiles set max_open = 2 where id = ${profiles.outsider}::uuid returning id`,
    );
    expect(elsewhere).toHaveLength(0);
  });

  it('keeps a profile with its person and company, and its values to the known lists', async () => {
    expect(
      await failure(
        rows(
          gm,
          sql`update caller_profiles set user_id = ${gm.id}::uuid where id = ${profiles.person}::uuid`,
        ),
      ),
    ).toMatch(/permission denied|stays with/);
    expect(
      await failure(
        rows(
          gm,
          sql`update caller_profiles set languages = '{klingon}' where id = ${profiles.person}::uuid`,
        ),
      ),
    ).toMatch(/languages_check/);
    expect(
      await failure(
        rows(gm, sql`update caller_profiles set max_open = 0 where id = ${profiles.person}::uuid`),
      ),
    ).toMatch(/max_open_check/);
  });

  it('lets a person start only a plain profile of their own and a manager start one for others', async () => {
    const fresh = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_cc', teamId: team }]);
    const own = principalFor('tele_caller_cc', [CO], { id: fresh.id, teamId: team });
    expect(
      await failure(
        rows(
          own,
          sql`insert into caller_profiles (id, user_id, entity_id, is_converter, presence)
              values (${newId()}, ${fresh.id}::uuid, ${CO}, true, 'present')`,
        ),
      ),
    ).toMatch(/row-level security/);
    await rows(
      own,
      sql`insert into caller_profiles (id, user_id, entity_id, presence)
          values (${newId()}, ${fresh.id}::uuid, ${CO}, 'present')`,
    );
    const other = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_cc', teamId: team }]);
    expect(
      await failure(
        rows(
          own,
          sql`insert into caller_profiles (id, user_id, entity_id) values (${newId()}, ${other.id}::uuid, ${CO})`,
        ),
      ),
    ).toMatch(/row-level security/);
    await rows(
      teamLead,
      sql`insert into caller_profiles (id, user_id, entity_id, is_converter)
          values (${newId()}, ${other.id}::uuid, ${CO}, true)`,
    );
    expect(
      await failure(
        rows(
          teamLead,
          sql`insert into caller_profiles (id, user_id, entity_id) values (${newId()}, ${outsider.id}::uuid, ${CO})`,
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('refuses an agent and the worker, and never deletes', async () => {
    const agent = principalFor('agent:triage', [CO]);
    expect(
      await failure(
        rows(
          agent,
          sql`insert into caller_profiles (id, user_id, entity_id) values (${newId()}, ${agent.id}::uuid, ${CO})`,
        ),
      ),
    ).toMatch(/row-level security|violates foreign key/);
    expect(
      await failure(rows(gm, sql`delete from caller_profiles where id = ${profiles.person}::uuid`)),
    ).toMatch(/permission denied/);
  });
});

describe('the handover definers', () => {
  const workers = (entityIds: number[]) =>
    principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

  it('keeps crm.handover.run to the worker principal: no role holds it', async () => {
    const held = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from role_permissions rp
          join roles r on r.id = rp.role_id
         where rp.permission_key = 'crm.handover.run' and r.key not like 'system:%'`,
    );
    expect(held[0]?.n).toBe(0);
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toEqual(
      expect.arrayContaining([
        'files.process',
        'imports.process',
        'crm.score.refresh',
        'crm.duplicates.scan',
        'sales.quote.expire',
        'notifications.send',
        'knowledge.index',
        'crm.handover.run',
      ]),
    );
    expect(list?.keys).toHaveLength(8);
  });

  it('refuses a caller without it, and a company outside the request', async () => {
    const lead = newId();
    for (const principal of [gm, teamLead, person]) {
      expect(
        await failure(
          rows(
            principal,
            sql`select * from app.handover_lead_facts(${CO}::smallint, ${lead}::uuid)`,
          ),
        ),
      ).toMatch(/crm.handover.run is required/);
      expect(
        await failure(
          rows(
            principal,
            sql`select * from app.handover_assign(${CO}::smallint, ${lead}::uuid, ${principal.id}::uuid, ${newId()}::uuid)`,
          ),
        ),
      ).toMatch(/crm.handover.run is required/);
    }
    expect(
      await failure(
        rows(
          workers([1]),
          sql`select * from app.handover_lead_facts(${CO}::smallint, ${lead}::uuid)`,
        ),
      ),
    ).toMatch(/outside the request/);
    expect(
      await rows(
        workers([CO]),
        sql`select * from app.handover_lead_facts(${CO}::smallint, ${lead}::uuid)`,
      ),
    ).toHaveLength(0);
  });

  it('shows the candidates to the worker and to a manager, not to a caller or an agent', async () => {
    expect(
      (await rows(workers([CO]), sql`select * from app.handover_candidates(${CO}::smallint)`))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await rows(gm, sql`select * from app.handover_candidates(${CO}::smallint)`)).length,
    ).toBeGreaterThan(0);
    for (const principal of [person, principalFor('agent:triage', [CO])]) {
      expect(
        await failure(rows(principal, sql`select * from app.handover_candidates(${CO}::smallint)`)),
      ).toMatch(/is required|an agent/);
    }
  });

  it('lists the people of a manager’s scope for the converters page and nobody else’s', async () => {
    const team1 = await rows<{ user_id: string }>(
      teamLead,
      sql`select user_id from app.caller_profile_people(${CO}::smallint)`,
    );
    expect(team1.map((r) => r.user_id)).toEqual(expect.arrayContaining([person.id, colleague.id]));
    expect(team1.map((r) => r.user_id)).not.toContain(outsider.id);
    expect(
      await failure(rows(person, sql`select * from app.caller_profile_people(${CO}::smallint)`)),
    ).toMatch(/crm.lead.assign is required/);
    expect(
      await failure(
        rows(gmElsewhere, sql`select * from app.caller_profile_people(${CO}::smallint)`),
      ),
    ).toMatch(/outside the request/);
  });
});
