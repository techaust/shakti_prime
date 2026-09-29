import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  PIPELINE_SEED,
  principalFor,
  stageId,
  withoutContext,
} from '../../src/testing/index';

// app.customer_search_ids(): the customers list's candidate lookup, a security definer that uses
// the trigram and reversed-phone indexes the policies keep a plain query from using, and returns
// only customers the caller may read by the account_entities_read rule (0057).
//
// The rows, written here with new ids: tele-callers X and Y of company 1 in one team. Customer K
// is X's in company 1, with a lead of Y's there. Customer N is related only to company 2.

afterAll(closeDb);

const SIGNATURE = 'app.customer_search_ids(text, text, integer)';
/** A word no earlier run used, in every name here, so other suites' rows never match. */
const WORD = `Qv${newId()
  .slice(-6)
  .replace(/[^a-z]/g, 'q')}`;
const k = { account: newId(), contact: newId(), phone: `+9160${String(Date.now()).slice(-8)}` };
const n = { account: newId(), contact: newId() };
let x: Principal;
let y: Principal;

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

const call = (text: string | null, phoneReversed: string | null = null) =>
  sql`select id from app.customer_search_ids(${text}::text, ${phoneReversed}::text, 200) as id`;

async function found(who: Principal, text: string | null, phoneReversed: string | null = null) {
  return asPrincipal(who, async ({ tx }) => {
    const rows = (await tx.execute(call(text, phoneReversed))) as unknown as { id: string }[];
    return rows.map((r) => r.id).filter((id) => id === k.account || id === n.account);
  });
}

beforeAll(async () => {
  const team = await createTestTeam(1, 'customer search team');
  x = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  y = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by) values
        (${k.account}, 'farm', ${`${WORD} Kesar farm`}, ${x.id}),
        (${n.account}, 'farm', ${`${WORD} Naval farm`}, ${x.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${newId()}, ${k.account}, 1, ${x.id}, ${team}, ${x.id}),
        (${newId()}, ${n.account}, 2, ${x.id}, null, ${x.id})`;
      await tx`insert into contacts (id, name, created_by) values
        (${k.contact}, ${`${WORD} Kesar`}, ${x.id}), (${n.contact}, ${`${WORD} Naval`}, ${x.id})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by) values
        (${k.account}, ${k.contact}, 'owner', ${x.id}), (${n.account}, ${n.contact}, 'owner', ${x.id})`;
      await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
        values (${newId()}, ${k.contact}, ${k.phone}, true, ${x.id})`;
      await tx`insert into customer_sites (id, account_id, type, village, created_by)
        values (${newId()}, ${k.account}, 'borewell', ${`${WORD}pura`}, ${x.id})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${newId()}, 1, ${k.account}, ${PIPELINE_SEED[0]?.id ?? ''}, ${stageId(1, 1)}, ${y.id}, ${team}, ${x.id})`;
    }),
  );
});

describe('app.customer_search_ids(): who may call it', () => {
  it('only the application role may call it, a definer with an empty search path', async () => {
    const [row] = await withoutContext<Record<string, unknown>>(sql`
      select has_function_privilege('app_user', ${SIGNATURE}, 'execute') as app,
             has_function_privilege('auth_service', ${SIGNATURE}, 'execute') as auth,
             has_function_privilege('outbox_publisher', ${SIGNATURE}, 'execute') as outbox,
             has_function_privilege('readonly_reporter', ${SIGNATURE}, 'execute') as reporter,
             has_function_privilege('public', ${SIGNATURE}, 'execute') as pub,
             p.prosecdef as definer, p.proconfig as config
        from pg_proc p where p.oid = ${SIGNATURE}::regprocedure`);
    expect(row).toMatchObject({
      app: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
      definer: true,
    });
    expect(row?.config).toContain('search_path=""');
  });

  it('refuses a caller who reads neither customers nor leads, and a connection with no request', async () => {
    expect(await failure(found(principalFor('agent:sizing', [1]), WORD))).toMatch(
      /permission crm.account.read or crm.lead.read required/,
    );
    expect(await failure(withoutContext(call(WORD)))).toMatch(/permission/);
  });
});

describe('app.customer_search_ids(): only customers the caller may read', () => {
  it('finds a customer by name, contact, village or phone for the person who looks after them', async () => {
    expect(await found(x, `${WORD} Kesar farm`)).toEqual([k.account]);
    expect(await found(x, `${WORD} Kesar`)).toEqual([k.account]);
    expect(await found(x, `${WORD}pura`)).toEqual([k.account]);
    const digits = k.phone.slice(-6);
    expect(await found(x, digits, [...digits].reverse().join(''))).toEqual([k.account]);
  });

  it('finds a customer through a lead of a person, never of an agent (0057)', async () => {
    expect(await found(y, WORD)).toEqual([k.account]);
    const triage = principalFor('agent:triage', [1], {
      id: AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage')?.id ?? newId(),
    });
    expect(await found(triage, WORD)).toEqual([]);
    const other = await createTestPrincipal('tele_caller_cc', [1]);
    expect(await found(other, WORD)).toEqual([]);
  });

  it('keeps to the companies of the request', async () => {
    expect((await found(principalFor('executive', [1]), WORD)).sort()).toEqual([k.account]);
    expect((await found(principalFor('executive', [2]), WORD)).sort()).toEqual([n.account]);
    expect((await found(principalFor('executive', [1, 2]), WORD)).sort()).toEqual(
      [k.account, n.account].sort(),
    );
  });
});
