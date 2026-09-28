import type { Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPrincipal, closeDb, principalFor, withoutContext } from '../../src/testing/index';
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
});
