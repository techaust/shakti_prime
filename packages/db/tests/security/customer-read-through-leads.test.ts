import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  PIPELINE_SEED,
  principalFor,
  stageId,
  withoutContext,
} from '../../src/testing/index';

// 0057, the owner's rule: a person who may read one of a customer's leads in a company may read
// that customer, its relationship in that company, its sites, contacts, phones and consents. An
// agent never does (SECURITY §3.3). Writes are unchanged, and a customer related only to another
// company stays invisible.
//
// The rows, all written here with new ids: tele-callers X and Y of company 1 in one team. Customer
// K is X's in company 1 and Z's in company 2; it has a lead of X's and a lead of Y's in company 1
// (the two callers, two leads case) and one of Z's in company 2. Customer M is related to company 1
// and has no lead. Customer N is related only to company 2, with a lead there owned by Y.

type CustomerTable =
  | 'accounts'
  | 'account_entities'
  | 'account_contacts'
  | 'contacts'
  | 'contact_phones'
  | 'customer_sites'
  | 'consents';

interface Customer {
  account: string;
  contact: string;
  links: Record<number, string>;
}

let team: string;
let x: Principal;
let y: Principal;
let z: Principal;
let k: Customer;
let m: Customer;
let n: Customer;

/** What `who` reads of `customer`, table by table: the number of its rows, and its relationship rows. */
async function reads(who: Principal, customer: Customer) {
  return asPrincipal(who, async ({ tx }) => {
    const [row] = (await tx.execute(sql`
      select (select count(*) from accounts where id = ${customer.account})::int as accounts,
             (select count(*) from account_entities where account_id = ${customer.account})::int as account_entities,
             (select count(*) from account_contacts where account_id = ${customer.account})::int as account_contacts,
             (select count(*) from contacts where id = ${customer.contact})::int as contacts,
             (select count(*) from contact_phones where contact_id = ${customer.contact})::int as contact_phones,
             (select count(*) from customer_sites where account_id = ${customer.account})::int as customer_sites,
             (select count(*) from consents where contact_id = ${customer.contact})::int as consents,
             (select coalesce(array_agg(entity_id order by entity_id), '{}') from account_entities
               where account_id = ${customer.account}) as companies`)) as unknown as (Record<
      CustomerTable,
      number
    > & { companies: number[] })[];
    if (!row) throw new Error('no answer');
    return row;
  });
}

/** The leads of `customer` that `who` reads. */
async function leadsOf(who: Principal, customer: Customer): Promise<number> {
  return asPrincipal(who, async ({ tx }) => {
    const [row] = (await tx.execute(
      sql`select count(*)::int as n from opportunities where account_id = ${customer.account}`,
    )) as unknown as { n: number }[];
    return row?.n ?? -1;
  });
}

/** Rows of every customer table `who` reads, whoever's customer. */
async function anyCustomerRow(who: Principal): Promise<number> {
  return asPrincipal(who, async ({ tx }) => {
    const [row] = (await tx.execute(sql`
      select ((select count(*) from accounts) + (select count(*) from account_entities)
            + (select count(*) from account_contacts) + (select count(*) from contacts)
            + (select count(*) from contact_phones) + (select count(*) from customer_sites)
            + (select count(*) from consents))::int as n`)) as unknown as { n: number }[];
    return row?.n ?? -1;
  });
}

/** How a lead written by `withLeadOf` stands: open by default, or won, lost or archived. */
interface LeadShape {
  state?: 'open' | 'won' | 'lost';
  archived?: boolean;
}

/** The stage of the seeded first pipeline for each state: New, Won and Lost. */
const STAGE_POSITION = { open: 1, won: 5, lost: 6 } as const;

/**
 * Runs `read` while `who` owns a lead of `customer` in company 1, written with the migrator and
 * removed afterwards (M has no lead of its own).
 */
async function withLeadOf<T>(
  who: Principal,
  customer: Customer,
  read: () => Promise<T>,
  shape: LeadShape = {},
) {
  const lead = newId();
  const pipeline = PIPELINE_SEED[0];
  const state = shape.state ?? 'open';
  await asMigrator(
    (
      db,
    ) => db`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, state, owner_id, team_id, created_by, archived_at)
      values (${lead}, 1, ${customer.account}, ${pipeline?.id ?? ''}, ${stageId(1, STAGE_POSITION[state])}, ${state}, ${who.id}, ${who.teamId ?? null}, ${x.id},
              ${shape.archived === true ? new Date() : null})`,
  );
  try {
    return await read();
  } finally {
    await asMigrator((db) => db`delete from opportunities where id = ${lead}`);
  }
}

const ALL = { companies: [1] } as const;
const seesAll = (companies: number[]) => ({
  accounts: 1,
  account_entities: companies.length,
  account_contacts: 1,
  contacts: 1,
  contact_phones: 1,
  customer_sites: 1,
  consents: 1,
  companies,
});
const NOTHING = {
  accounts: 0,
  account_entities: 0,
  account_contacts: 0,
  contacts: 0,
  contact_phones: 0,
  customer_sites: 0,
  consents: 0,
  companies: [],
};

beforeAll(async () => {
  team = newId();
  const t2 = newId();
  x = principalFor('tele_caller_cc', [1], { id: newId(), teamId: team });
  y = principalFor('tele_caller_cc', [1], { id: newId(), teamId: team });
  z = principalFor('tele_caller_cc', [2], { id: newId(), teamId: t2 });
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');

  const customer = (): Customer => ({
    account: newId(),
    contact: newId(),
    links: { 1: newId(), 2: newId() },
  });
  k = customer();
  m = customer();
  n = customer();

  await asMigrator((db) =>
    db.begin(async (tx) => {
      for (const p of [x, y, z]) {
        await tx`insert into principals (id, kind, display_name) values (${p.id}, 'user', 'read through leads')`;
      }
      await tx`insert into teams (id, entity_id, name) values (${team}, 1, 'read through leads 1'), (${t2}, 2, 'read through leads 2')`;
      const write = async (c: Customer, label: string, links: [number, Principal][]) => {
        await tx`insert into contacts (id, name, created_by) values (${c.contact}, ${label}, ${x.id})`;
        await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
          values (${newId()}, ${c.contact}, ${`+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`}, true, ${x.id})`;
        await tx`insert into accounts (id, type, name, created_by) values (${c.account}, 'farm', ${label}, ${x.id})`;
        for (const [entityId, owner] of links) {
          await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
            values (${c.links[entityId] ?? ''}, ${c.account}, ${entityId}, ${owner.id}, ${owner.teamId ?? null}, ${x.id})`;
        }
        await tx`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${c.account}, ${c.contact}, 'owner', ${x.id})`;
        await tx`insert into customer_sites (id, account_id, type, created_by) values (${newId()}, ${c.account}, 'borewell', ${x.id})`;
        await tx`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
          values (${newId()}, ${c.contact}, 'call', 'service', 'walk_in_form', 'v1', now(), ${x.id})`;
      };
      const lead = async (c: Customer, entityId: number, owner: Principal) => {
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${newId()}, ${entityId}, ${c.account}, ${pipeline.id}, ${stageId(1, 1)}, ${owner.id}, ${owner.teamId ?? null}, ${x.id})`;
      };
      await write(k, 'read through leads K', [
        [1, x],
        [2, z],
      ]);
      await lead(k, 1, x);
      await lead(k, 1, y);
      await lead(k, 2, z);
      await write(m, 'read through leads M', [[1, x]]);
      await write(n, 'read through leads N', [[2, z]]);
      await lead(n, 2, y);
    }),
  );
});

afterAll(closeDb);

describe('a customer is readable through a lead the caller can read in that company (0057)', () => {
  it('two callers with a lead each both read the customer, in the company of their leads only', async () => {
    expect(await reads(x, k)).toEqual(seesAll([...ALL.companies]));
    // Y holds no relationship with K; Y reads it through Y's own lead.
    expect(await reads(y, k)).toEqual(seesAll([...ALL.companies]));
    // A colleague of the same team with no lead of K reads nothing of it.
    const other = principalFor('tele_caller_cc', [1], { id: newId(), teamId: team });
    expect(await reads(other, k)).toEqual(NOTHING);
  });

  it('keeps a customer related only to another company invisible, whoever owns its lead there', async () => {
    // N's only lead is Y's, in company 2; Y acts in company 1.
    expect(await reads(y, n)).toEqual(NOTHING);
    expect(await reads(principalFor('general_manager', [1]), n)).toEqual(NOTHING);
    expect(await reads(principalFor('agent:triage', [1]), n)).toEqual(NOTHING);
  });

  it('shows nothing through a lead without a request, and a customer with no lead only by scope', async () => {
    const [row] = await withoutContext<{ n: number }>(sql`
      select count(*)::int as n from account_entities where account_id = ${k.account}`);
    expect(row?.n).toBe(0);
    expect(await reads(y, m)).toEqual(NOTHING);
    expect(await reads(x, m)).toEqual(seesAll([1]));
  });

  it('gives no write: a reader through a lead changes nothing of the customer', async () => {
    const rollback = new Error('rollback');
    let changed: number[] = [];
    try {
      await asPrincipal(y, async ({ tx }) => {
        const counts: number[] = [];
        for (const statement of [
          sql`update accounts set name = 'changed' where id = ${k.account} returning id`,
          sql`update account_entities set owner_id = ${y.id} where account_id = ${k.account} returning id`,
          sql`update contacts set name = 'changed' where id = ${k.contact} returning id`,
          sql`update contact_phones set is_dnd = true where contact_id = ${k.contact} returning id`,
          sql`update customer_sites set village = 'changed' where account_id = ${k.account} returning id`,
        ]) {
          counts.push(((await tx.execute(statement)) as unknown as unknown[]).length);
        }
        changed = counts;
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
    expect(changed).toEqual([0, 0, 0, 0, 0]);
  });

  it('agents never read a customer through a lead: Triage and Co-pilot read their leads and no customer row (SECURITY §3.3)', async () => {
    const seededId = (role: string) => AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === role)?.id;
    for (const role of ['agent:triage', 'agent:copilot'] as const) {
      for (const entityIds of [[1], [2], [1, 2], [1, 2, 3, 4]]) {
        const agent = principalFor(role, entityIds, { id: seededId(role) ?? '' });
        const label = `${role} in ${entityIds.join(',')}`;
        for (const customer of [k, m, n]) {
          expect(await reads(agent, customer), label).toEqual(NOTHING);
        }
        // It still reads the leads of the companies it acts in.
        expect(await leadsOf(agent, k), label).toBe(
          entityIds.filter((e) => e === 1).length * 2 + entityIds.filter((e) => e === 2).length,
        );
        // Nor does any row of the customer tables reach it, whoever's customer.
        expect(await anyCustomerRow(agent), label).toBe(0);
      }
    }
    // Concierge reads only customers it looks after (it owns none of these); sizing reads none.
    expect(await reads(principalFor('agent:concierge', [1, 2]), k)).toEqual(NOTHING);
    expect(await reads(principalFor('agent:sizing', [1, 2]), k)).toEqual(NOTHING);
  });

  it('an agent cannot gain the path by anything it controls', async () => {
    const triageId = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage')?.id ?? '';
    // Its principal row says agent whatever role key the request carries: acting with a staff
    // role key (a request it does not make, but the check does not trust the key alone) it
    // still reads no customer through a lead of its own.
    const asStaffKey = principalFor('tele_caller_cc', [1], { id: triageId, teamId: team });
    expect(await withLeadOf(asStaffKey, m, () => reads(asStaffKey, m))).toEqual(NOTHING);
    // Its role key says agent whatever principal row it names: an agent role acting under a
    // person's id reads nothing through that person's leads.
    expect(await reads(principalFor('agent:triage', [1], { id: y.id, teamId: team }), k)).toEqual(
      NOTHING,
    );
    // The request's companies are the only other thing it chooses, and every choice was tried
    // above. A person given the same lead reads the customer, so the path itself is open.
    expect(await withLeadOf(y, m, () => reads(y, m))).toEqual(seesAll([1]));
  });
});

describe('an archived lead gives no read of its customer (0059)', () => {
  it('a person reads a customer through an open, won or lost lead, and not through an archived one', async () => {
    for (const state of ['open', 'won', 'lost'] as const) {
      expect(await withLeadOf(y, m, () => reads(y, m), { state }), state).toEqual(seesAll([1]));
    }
    for (const state of ['open', 'won', 'lost'] as const) {
      expect(
        await withLeadOf(y, m, () => reads(y, m), { state, archived: true }),
        `archived ${state}`,
      ).toEqual(NOTHING);
    }
    // The customer's holder still reads it by their own scope, archived leads or not.
    expect(await withLeadOf(y, m, () => reads(x, m), { archived: true })).toEqual(seesAll([1]));
  });
});

describe('app.attach_account_entity() pins an empty search path (0059)', () => {
  it('is a definer with an empty search path, executable by the application role only', async () => {
    const [row] = await withoutContext<{
      definer: boolean;
      config: string[];
      app: boolean;
      reporter: boolean;
      pub: boolean;
    }>(sql`
      select p.prosecdef as definer, p.proconfig as config,
             has_function_privilege('app_user', p.oid, 'execute') as app,
             has_function_privilege('readonly_reporter', p.oid, 'execute') as reporter,
             has_function_privilege('public', p.oid, 'execute') as pub
        from pg_proc p where p.oid = 'app.attach_account_entity(uuid, smallint)'::regprocedure`);
    expect(row).toEqual({
      definer: true,
      config: ['search_path=""'],
      app: true,
      reporter: false,
      pub: false,
    });
  });
});
