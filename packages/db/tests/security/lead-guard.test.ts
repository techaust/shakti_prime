import type { Principal } from '@shakti/contracts';
import { newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestUser,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// The two definers of 0055: app.lead_phone_status(), which tells crm.lead.create and the import
// commit whether a new customer's number belongs to a customer a colleague looks after in the
// company, and app.hand_over_customer(), which moves that relationship with a lead handed over.
// The fixture's customers: account n has the number +9198000{10000 + n}; A and B (team 1) and
// C (team 2) are tele-callers of company 1, L leads team 1, D is a tele-caller of company 2, and
// account 0 is A's in company 1 and D's in company 2.

const PHONE = (n: number) => `+9198000${String(10000 + n)}`;
const STATUS = 'app.lead_phone_status(text, smallint)';
const HANDOVER = 'app.hand_over_customer(uuid, uuid)';
const ACTIVE = 'app.user_is_active(uuid)';

let fx: CrmFixture;

beforeAll(async () => {
  fx = await crmFixture();
});
afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

const statusCall = (phone: string, entityId: number) =>
  sql`select app.lead_phone_status(${phone}::text, ${entityId}::smallint) as status`;

async function status(principal: Principal, phone: string, entityId = 1): Promise<unknown[]> {
  return asPrincipal(principal, async ({ tx }) => {
    return await tx.execute(statusCall(phone, entityId));
  });
}

/** The lead's stage, read outside any request (the worker's own request cannot read leads). */
async function stageOf(lead: string): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ stage_id: string }[]>`select stage_id from opportunities where id = ${lead}`,
  );
  if (!row) throw new Error('no lead');
  return row.stage_id;
}

const rollback = new Error('rollback');

/** Runs `statements` as `principal` in one transaction, answers the last one's rows, rolls back. */
async function inRollback(principal: Principal, statements: SQL[]): Promise<unknown[]> {
  let rows: unknown[] = [];
  try {
    await asPrincipal(principal, async ({ tx }) => {
      for (const statement of statements) rows = await tx.execute(statement);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return rows;
}

async function grantsOf(signature: string) {
  const [row] = await withoutContext<Record<string, boolean>>(sql`
    select has_function_privilege('app_user', ${signature}, 'execute') as app,
           has_function_privilege('auth_service', ${signature}, 'execute') as auth,
           has_function_privilege('outbox_publisher', ${signature}, 'execute') as outbox,
           has_function_privilege('readonly_reporter', ${signature}, 'execute') as reporter,
           has_function_privilege('public', ${signature}, 'execute') as pub
  `);
  return row;
}

async function shapeOf(signature: string) {
  const [row] = await withoutContext<{ result: string; definer: boolean; config: string[] }>(sql`
    select pg_get_function_result(p.oid) as result, p.prosecdef as definer, p.proconfig as config
      from pg_proc p where p.oid = ${signature}::regprocedure
  `);
  return row;
}

describe('app.lead_phone_status(): who may call it and what it returns', () => {
  it('only the application role may call it, a definer with an empty search path', async () => {
    expect(await grantsOf(STATUS)).toEqual({
      app: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
    });
    const shape = await shapeOf(STATUS);
    expect(shape?.result).toBe('text');
    expect(shape?.definer).toBe(true);
    expect(shape?.config).toContain('search_path=""');
  });

  it('refuses a caller without crm.lead.write, a company outside the request and no request', async () => {
    expect(await failure(status(principalFor('hr_admin', [1]), PHONE(2)))).toMatch(
      /permission crm.lead.write:own required/,
    );
    expect(await failure(status(fx.principals.a, PHONE(2), 2))).toMatch(
      /entity 2 outside the request scope/,
    );
    expect(await failure(withoutContext(statusCall(PHONE(2), 1)))).toMatch(
      /outside the request scope/,
    );
  });

  it('answers one status and nothing of the customer it found', async () => {
    const rows = await status(fx.principals.a, PHONE(2));
    expect(rows).toEqual([{ status: 'held_by_other' }]);
  });
});

describe('app.lead_phone_status(): held only when the caller may not act for the holder', () => {
  it('follows crm.account.write own, team and company scope in the company asked about', async () => {
    const answer = async (principal: Principal, phone: string, entityId = 1) =>
      ((await status(principal, phone, entityId))[0] as { status: string }).status;
    // B's customer in company 1
    expect(await answer(fx.principals.a, PHONE(2))).toBe('held_by_other');
    expect(await answer(fx.principals.c, PHONE(2))).toBe('held_by_other');
    expect(await answer(fx.principals.b, PHONE(2))).toBe('clear');
    expect(await answer(fx.principals.l, PHONE(2))).toBe('clear');
    expect(await answer(fx.principals.gm, PHONE(2))).toBe('clear');
    // C's customer, in team 2, which L does not lead
    expect(await answer(fx.principals.l, PHONE(3))).toBe('held_by_other');
    // A number nobody has, and one known only in another company
    expect(await answer(fx.principals.a, '+919000000001')).toBe('clear');
    expect(await answer(fx.principals.d, PHONE(2), 2)).toBe('clear');
    // Account 0 is A's in company 1 and D's in company 2: each is asked about their own company
    expect(await answer(fx.principals.d, PHONE(0), 2)).toBe('clear');
    expect(await answer(fx.principals.a, PHONE(0))).toBe('clear');
    expect(await answer(fx.principals.b, PHONE(0))).toBe('held_by_other');
    expect(
      await answer(principalFor('tele_caller_cc', [2], { teamId: fx.teams.t3 }), PHONE(0), 2),
    ).toBe('held_by_other');
  });
});

describe('app.hand_over_customer(): who may call it and what it moves', () => {
  const handOver = (lead: string, previousOwner: string) =>
    sql`select status, previous_team_id as "previousTeamId" from app.hand_over_customer(${lead}::uuid, ${previousOwner}::uuid)`;
  const giveLead = (lead: string, to: Principal) =>
    sql`update opportunities set owner_id = ${to.id}, team_id = ${to.teamId ?? null} where id = ${lead}`;
  const holderOf = (account: string) =>
    sql`select owner_id as owner from account_entities where account_id = ${account} and entity_id = 1`;

  it('only the application role may call it, a definer with an empty search path', async () => {
    expect(await grantsOf(HANDOVER)).toEqual({
      app: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
    });
    const shape = await shapeOf(HANDOVER);
    expect(shape?.result).toBe('TABLE(status text, relationship_id uuid, previous_team_id uuid)');
    expect(shape?.definer).toBe(true);
    expect(shape?.config).toContain('search_path=""');
  });

  it('refuses a caller without crm.lead.assign, and a lead outside their write scope', async () => {
    const lead = fx.leads.b[0] ?? '';
    expect(
      await failure(inRollback(fx.principals.a, [handOver(lead, fx.principals.b.id)])),
    ).toMatch(/permission crm.lead.assign:own required/);
    // C's lead is in team 2, which L does not lead
    expect(
      await failure(
        inRollback(fx.principals.l, [handOver(fx.leads.c[0] ?? '', fx.principals.c.id)]),
      ),
    ).toMatch(/outside the caller's write scope/);
    expect(await failure(withoutContext(handOver(lead, fx.principals.b.id)))).toMatch(
      /permission crm.lead.assign:own required/,
    );
  });

  it('moves the relationship to the lead owner only when the previous lead owner held it', async () => {
    const lead = fx.leads.b[0] ?? '';
    const account = fx.accounts.b[0] ?? '';
    const moved = await inRollback(fx.principals.l, [
      giveLead(lead, fx.principals.a),
      handOver(lead, fx.principals.b.id),
    ]);
    expect(moved).toEqual([{ status: 'moved', previousTeamId: fx.teams.t1 }]);
    expect(
      await inRollback(fx.principals.l, [
        giveLead(lead, fx.principals.a),
        handOver(lead, fx.principals.b.id),
        holderOf(account),
      ]),
    ).toEqual([{ owner: fx.principals.a.id }]);
    // Someone else held it: left as it is.
    expect(
      await inRollback(fx.principals.l, [
        giveLead(lead, fx.principals.a),
        handOver(lead, fx.principals.l.id),
      ]),
    ).toEqual([{ status: 'held_by_other', previousTeamId: null }]);
    // Already the lead owner's.
    expect(await inRollback(fx.principals.l, [handOver(lead, fx.principals.a.id)])).toEqual([
      { status: 'unchanged', previousTeamId: null },
    ]);
  });

  it('never moves a relationship for an agent, whose lead handover leaves the customer as it is (0059)', async () => {
    const lead = fx.leads.b[0] ?? '';
    const triageId = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage')?.id ?? '';
    const handOverFull = sql`select status, relationship_id as "relationshipId"
      from app.hand_over_customer(${lead}::uuid, ${fx.principals.b.id}::uuid)`;
    // The seeded Triage agent, as it acts: the lead moves, the relationship does not.
    const triage = principalFor('agent:triage', [1], { id: triageId });
    expect(await inRollback(triage, [giveLead(lead, fx.principals.a), handOverFull])).toEqual([
      { status: 'unchanged', relationshipId: null },
    ]);
    // Either marker is enough: an agent role key under a person's id, and the agent's own
    // principal row under a staff role key that could otherwise move it.
    const agentKey = principalFor('agent:triage', [1], { id: fx.principals.l.id });
    const agentRow = principalFor('sales_team_lead', [1], { id: triageId, teamId: fx.teams.t1 });
    for (const who of [agentKey, agentRow]) {
      expect(await inRollback(who, [giveLead(lead, fx.principals.a), handOverFull])).toEqual([
        { status: 'unchanged', relationshipId: null },
      ]);
    }
    // The same handover by the team lead moves it, so the path itself is open.
    expect(
      await inRollback(fx.principals.l, [
        giveLead(lead, fx.principals.a),
        handOver(lead, fx.principals.b.id),
      ]),
    ).toEqual([{ status: 'moved', previousTeamId: fx.teams.t1 }]);
  });

  it('moves a relationship for system:workers only with the handover permission (the owner, 09-10-2026)', async () => {
    const lead = fx.leads.b[0] ?? '';
    const handOverFull = sql`select status, relationship_id as "relationshipId"
      from app.hand_over_customer(${lead}::uuid, ${fx.principals.b.id}::uuid)`;
    const handover = [{ key: 'crm.handover.run' as const, scope: 'all' as const }];
    // The worker, as it acts: the relationship moves with the lead, as a person's handover moves it.
    const worker = principalFor('system:workers', [1], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      permissions: handover,
    });
    const taker = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc' }]);
    const give = sql`select status from app.handover_assign(1::smallint, ${lead}::uuid, ${taker.id}::uuid, ${newId()}::uuid, ${await stageOf(lead)}::uuid, now() + interval '1 day', false, 48)`;
    const [moved] = await inRollback(worker, [give, handOverFull]);
    expect(moved).toMatchObject({ status: 'moved' });
  });

  it('answers unchanged to a system request without the handover permission, though it holds the assign and write of a person (0064)', async () => {
    const lead = fx.leads.b[0] ?? '';
    const handOverFull = sql`select status, relationship_id as "relationshipId"
      from app.hand_over_customer(${lead}::uuid, ${fx.principals.b.id}::uuid)`;
    const assign = [
      { key: 'crm.lead.assign' as const, scope: 'entity' as const },
      { key: 'crm.lead.write' as const, scope: 'entity' as const },
      { key: 'crm.lead.read' as const, scope: 'entity' as const },
    ];
    // By the role key (the principal row is a person's), and by the principal row (the role key is a person's).
    const byKey = principalFor('system:workers', [1], {
      id: fx.principals.l.id,
      permissions: assign,
    });
    const byRow = principalFor('sales_team_lead', [1], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      teamId: fx.teams.t1,
      permissions: assign,
    });
    for (const who of [byKey, byRow]) {
      expect(await inRollback(who, [giveLead(lead, fx.principals.a), handOverFull])).toEqual([
        { status: 'unchanged', relationshipId: null },
      ]);
    }
    // The same request with the handover permission added moves it: the permission is what is narrowed.
    const withPermission = principalFor('system:workers', [1], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      permissions: [...assign, { key: 'crm.handover.run' as const, scope: 'all' as const }],
    });
    const taker = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc' }]);
    const give = sql`select status from app.handover_assign(1::smallint, ${lead}::uuid, ${taker.id}::uuid, ${newId()}::uuid, ${await stageOf(lead)}::uuid, now() + interval '1 day', false, 48)`;
    const [result] = await inRollback(withPermission, [give, handOverFull]);
    expect(result).toMatchObject({ status: 'moved' });
  });
});

describe('app.user_is_active(): leads go only to people who can work (0059)', () => {
  const activeCall = (userId: string) => sql`select app.user_is_active(${userId}::uuid) as active`;
  const active = async (principal: Principal, userId: string) =>
    asPrincipal(principal, async ({ tx }) => {
      const [row] = (await tx.execute(activeCall(userId))) as unknown as { active: boolean }[];
      return row?.active;
    });

  it('only the application role may call it, a definer with an empty search path', async () => {
    expect(await grantsOf(ACTIVE)).toEqual({
      app: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
    });
    const shape = await shapeOf(ACTIVE);
    expect(shape?.result).toBe('boolean');
    expect(shape?.definer).toBe(true);
    expect(shape?.config).toContain('search_path=""');
  });

  it('refuses a caller who may not hand out leads, and a call with no request', async () => {
    const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
    expect(await failure(active(principalFor('hr_admin', [1]), user.id))).toMatch(
      /permission crm.lead.assign:own required/,
    );
    expect(await failure(withoutContext(activeCall(user.id)))).toMatch(
      /permission crm.lead.assign:own required/,
    );
  });

  it('answers yes only for an active person with a role in a company of the request', async () => {
    const gm = principalFor('general_manager', [1]);
    const role = [{ entityId: 1, roleKey: 'tele_caller_cc' as const }];
    expect(await active(gm, (await createTestUser(role)).id)).toBe(true);
    for (const status of ['invited', 'suspended', 'offboarded']) {
      expect(await active(gm, (await createTestUser(role, { status })).id), status).toBe(false);
    }
    // Active, but working only in company 2: nothing is said about them to company 1.
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_cc' }]);
    expect(await active(gm, elsewhere.id)).toBe(false);
    expect(await active(principalFor('general_manager', [2]), elsewhere.id)).toBe(true);
    expect(await active(gm, (await createTestUser([])).id)).toBe(false);
  });
});
