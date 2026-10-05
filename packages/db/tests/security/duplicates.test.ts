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
  principalFor,
  stageId,
} from '../../src/testing/index';

// Duplicates (docs/DATABASE.md §6.2, §4.1; SECURITY §3.3): a candidate is read only by someone
// who sees both of its customers or both of its leads; a request inserts only a lead pair and only
// with crm.lead.merge; merges are written by their definers alone, for people; the timeline stays
// append-only outside a merge; the facts definer answers a person only about a customer they may
// change.

afterAll(closeDb);

let teamOne: string;
let teamTwo: string;
let ccOne: Principal;
let ccTwo: Principal;
let gm: Principal;
let teamLead: Principal;
let accountOne: string;
let accountTwo: string;
let leadOne: string;
let leadTwo: string;
let customerPair: string;
let leadPair: string;

async function customer(
  owner: Principal,
  team: string,
): Promise<{ account: string; lead: string }> {
  const account = newId();
  const lead = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', 'duplicates security customer', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${account}, 1, ${owner.id}, ${team}, ${owner.id})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        select ${lead}, 1, ${account}, p.id, ${stageId(1, 1)}, ${owner.id}, ${team}, ${owner.id}
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
    }),
  );
  return { account, lead };
}

beforeAll(async () => {
  teamOne = await createTestTeam(1, 'duplicates security one');
  teamTwo = await createTestTeam(1, 'duplicates security two');
  ccOne = await createTestPrincipal('tele_caller_cc', [1], { teamId: teamOne });
  ccTwo = await createTestPrincipal('tele_caller_cc', [1], { teamId: teamTwo });
  gm = await createTestPrincipal('general_manager', [1]);
  teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId: teamOne });
  const one = await customer(ccOne, teamOne);
  const two = await customer(ccTwo, teamTwo);
  accountOne = one.account;
  accountTwo = two.account;
  leadOne = one.lead;
  leadTwo = two.lead;
  customerPair = newId();
  leadPair = newId();
  const [lowAccount, highAccount] = [accountOne, accountTwo].sort();
  const [lowLead, highLead] = [leadOne, leadTwo].sort();
  await asMigrator(
    (m) => m`insert into duplicate_candidates
      (id, entity_id, kind, account_id, other_account_id, reason, confidence, created_by) values
      (${customerPair}, 1, 'customer', ${lowAccount}, ${highAccount}, 'phone', 70, ${gm.id})`,
  );
  await asMigrator(
    (m) => m`insert into duplicate_candidates
      (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, confidence, created_by) values
      (${leadPair}, 1, 'lead', ${lowLead}, ${highLead}, 'phone', 95, ${gm.id})`,
  );
});

async function visible(principal: Principal, ids: readonly string[]): Promise<string[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select id from duplicate_candidates where id = any(${`{${ids.join(',')}}`}::uuid[]) order by id`,
    )) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  });
}

function fails(work: Promise<unknown>): Promise<boolean> {
  return work.then(
    () => false,
    () => true,
  );
}

describe('duplicate_candidates', () => {
  it('shows a pair only to someone who sees both of its customers, or both of its leads', async () => {
    const both = [customerPair, leadPair].sort();
    expect(await visible(gm, both)).toEqual(both);
    expect(await visible(ccOne, both)).toEqual([]);
    expect(await visible(ccTwo, both)).toEqual([]);
    expect(await visible(teamLead, both)).toEqual([]);
    expect(await visible({ ...gm, entityIds: [2] }, both)).toEqual([]);
  });

  it('takes a lead pair from a holder of crm.lead.merge who sees both leads, and never a customer pair', async () => {
    const [lowAccount, highAccount] = [accountOne, accountTwo].sort();
    const insertCustomerPair = (p: Principal) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into duplicate_candidates
          (id, entity_id, kind, account_id, other_account_id, reason, confidence, created_by)
          values (${newId()}, 1, 'customer', ${lowAccount}, ${highAccount}, 'phone', 70, ${p.id})`),
      );
    expect(await fails(insertCustomerPair(gm))).toBe(true);
    // A lead pair by a tele-caller, who holds no crm.lead.merge, is refused too.
    const own = await customer(ccOne, teamOne);
    const [low, high] = [leadOne, own.lead].sort();
    const insertLeadPair = (p: Principal) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into duplicate_candidates
          (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, confidence, created_by)
          values (${newId()}, 1, 'lead', ${low}, ${high}, 'phone', 95, ${p.id})`),
      );
    expect(await fails(insertLeadPair(ccOne))).toBe(true);
    expect(await fails(insertLeadPair(teamLead))).toBe(false);
  });

  it('lets an agent change no candidate, whatever it holds', async () => {
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    if (seed === undefined) throw new Error('no triage agent');
    const triage = principalFor('agent:triage', [1], { id: seed.id });
    const updated = await asPrincipal(triage, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update duplicate_candidates set state = 'dismissed', decided_by = ${triage.id},
                   decided_at = now() where id = ${leadPair} returning id`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(updated).toBe(0);
  });
});

describe('customer merges', () => {
  it('are written by their definers only', async () => {
    expect(
      await fails(
        asPrincipal(gm, ({ tx }) =>
          tx.execute(sql`insert into customer_merges
            (id, entity_id, kept_account_id, merged_account_id, moved_json, created_by)
            values (${newId()}, 1, ${accountOne}, ${accountTwo}, '{}'::jsonb, ${gm.id})`),
        ),
      ),
    ).toBe(true);
  });

  it('refuse an agent and the system principal at the definer, even holding crm.lead.merge', async () => {
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    if (seed === undefined) throw new Error('no triage agent');
    const triage = principalFor('agent:triage', [1], { id: seed.id });
    const calls = [
      sql`select app.merge_customers(${newId()}::uuid, ${accountOne}::uuid, ${accountTwo}::uuid, 1::smallint, null::uuid)`,
      sql`select app.unmerge_customers(${newId()}::uuid)`,
      sql`select app.merge_leads(${leadOne}::uuid, ${leadTwo}::uuid, 1::smallint)`,
    ];
    for (const call of calls) {
      expect(await fails(asPrincipal(triage, ({ tx }) => tx.execute(call)))).toBe(true);
      // A person without crm.lead.merge is refused as well.
      expect(await fails(asPrincipal(ccOne, ({ tx }) => tx.execute(call)))).toBe(true);
    }
  });
});

describe('the duplicate definers', () => {
  it('answer a person facts only about a customer they may change', async () => {
    const ask = (p: Principal, account: string) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(
          sql`select * from app.duplicate_facts(1::smallint, null::uuid, 1, ${account}::uuid)`,
        ),
      );
    expect(await fails(ask(ccOne, accountOne))).toBe(false);
    expect(await fails(ask(ccOne, accountTwo))).toBe(true);
    // The nightly form, with no customer named, needs the platform-only permission.
    expect(
      await fails(
        asPrincipal(gm, ({ tx }) =>
          tx.execute(
            sql`select * from app.duplicate_facts(1::smallint, null::uuid, 10, null::uuid)`,
          ),
        ),
      ),
    ).toBe(true);
  });

  it('record no pair that does not match, nor one outside the caller scope', async () => {
    const [low, high] = [accountOne, accountTwo].sort();
    const rows = JSON.stringify([
      {
        kind: 'customer',
        firstId: low,
        secondId: high,
        reason: 'phone',
        confidence: 70,
        signals: [],
      },
    ]);
    const written = await asPrincipal(ccOne, async ({ tx }) => {
      const r = (await tx.execute(
        sql`select * from app.record_duplicates(1::smallint, ${rows}::jsonb)`,
      )) as unknown as unknown[];
      return r.length;
    });
    // The two customers share no number, so nothing is written.
    expect(written).toBe(0);
  });
});

describe('the timeline outside a merge', () => {
  it('stays append-only for its owner, and a merge changes only the customer a row names', async () => {
    const row = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id)
        values (${row}, 1, ${leadOne}, ${accountOne}, 'lead_created', ${ccOne.id})`,
    );
    expect(
      await fails(
        asMigrator((m) => m`update activities set account_id = ${accountTwo} where id = ${row}`),
      ),
    ).toBe(true);
    expect(
      await fails(
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.customer_merge', ${newId()}, true)`;
            await tx`update activities set type = 'note', body = 'changed' where id = ${row}`;
          }),
        ),
      ),
    ).toBe(true);
    expect(
      await fails(
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.customer_merge', ${newId()}, true)`;
            await tx`update activities set account_id = ${accountTwo} where id = ${row}`;
          }),
        ),
      ),
    ).toBe(false);
    // A request may not update the timeline at all, setting or not.
    expect(
      await fails(
        asPrincipal(gm, async ({ tx }) => {
          await tx.execute(sql`select set_config('app.customer_merge', 'x', true)`);
          await tx.execute(sql`update activities set account_id = ${accountOne} where id = ${row}`);
        }),
      ),
    ).toBe(true);
  });
});
