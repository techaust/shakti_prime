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

// The customer timeline (docs/DATABASE.md §6.2): a row on a lead is read by whoever reads the lead,
// a row of no lead by whoever reads the customer in the row's company, which an agent never does
// through a lead (0057). Commands write rows as the caller, about what the caller reads.
//
// The rows, all written here with new ids: tele-callers X and Y of company 1 in one team. Customer
// K is X's in company 1 and has a lead of X's and a lead of Y's there. Customer N is related only
// to company 2, with a lead there. Each customer has a row of no lead and a row on each lead.

afterAll(closeDb);

let x: Principal;
let y: Principal;
const k = { account: newId(), leadX: newId(), leadY: newId() };
const n = { account: newId(), lead: newId() };
/** The timeline rows, by what they are about. */
const rows = {
  kAccount: newId(),
  kLeadX: newId(),
  kLeadY: newId(),
  nAccount: newId(),
  nLead: newId(),
};

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

beforeAll(async () => {
  const team = await createTestTeam(1, 'activities team');
  x = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  y = await createTestPrincipal('tele_caller_cc', [1], { teamId: team });
  const pipeline = PIPELINE_SEED[0]?.id ?? '';
  const stage = stageId(1, 1);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by) values
        (${k.account}, 'farm', 'timeline K', ${x.id}), (${n.account}, 'farm', 'timeline N', ${x.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${newId()}, ${k.account}, 1, ${x.id}, ${team}, ${x.id}),
        (${newId()}, ${n.account}, 2, ${x.id}, null, ${x.id})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by) values
        (${k.leadX}, 1, ${k.account}, ${pipeline}, ${stage}, ${x.id}, ${team}, ${x.id}),
        (${k.leadY}, 1, ${k.account}, ${pipeline}, ${stage}, ${y.id}, ${team}, ${x.id}),
        (${n.lead}, 2, ${n.account}, ${pipeline}, ${stage}, ${x.id}, null, ${x.id})`;
      await tx`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id) values
        (${rows.kAccount}, 1, null, ${k.account}, 'customer_updated', ${x.id}),
        (${rows.kLeadX}, 1, ${k.leadX}, ${k.account}, 'lead_created', ${x.id}),
        (${rows.kLeadY}, 1, ${k.leadY}, ${k.account}, 'lead_created', ${y.id}),
        (${rows.nAccount}, 2, null, ${n.account}, 'customer_updated', ${x.id}),
        (${rows.nLead}, 2, ${n.lead}, ${n.account}, 'lead_created', ${x.id})`;
    }),
  );
});

const ALL_ROWS = Object.values(rows);

/** Which of this file's rows `who` reads, by name. */
async function visible(who: Principal): Promise<string[]> {
  return asPrincipal(who, async ({ tx }) => {
    const found = (await tx.execute(
      sql`select id from activities where id = any(${`{${ALL_ROWS.join(',')}}`}::uuid[])`,
    )) as unknown as { id: string }[];
    const ids = new Set(found.map((r) => r.id));
    return Object.entries(rows)
      .filter(([, id]) => ids.has(id))
      .map(([name]) => name)
      .sort();
  });
}

const agent = (role: 'agent:triage' | 'agent:chief'): Principal => {
  const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === role);
  return principalFor(role, [1], { id: seed?.id ?? newId() });
};

describe('reading the timeline', () => {
  it('fails closed with no request', async () => {
    const found = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from activities`,
    );
    expect(found[0]?.n).toBe(0);
  });

  it('an Executive over every company reads every row, and narrowed to one only that one', async () => {
    expect(await visible(principalFor('executive'))).toEqual(Object.keys(rows).sort());
    expect(await visible(principalFor('executive', [1]))).toEqual(['kAccount', 'kLeadX', 'kLeadY']);
  });

  it('a caller reads the rows of their own leads and of their customer, never a colleague’s lead', async () => {
    expect(await visible(x)).toEqual(['kAccount', 'kLeadX']);
  });

  it('a caller reads a customer’s rows through their lead of that customer (0057)', async () => {
    expect(await visible(y)).toEqual(['kAccount', 'kLeadY']);
  });

  it('an agent reads rows on the leads it may read, never a customer’s through a lead', async () => {
    expect(await visible(agent('agent:triage'))).toEqual(['kLeadX', 'kLeadY']);
    // With crm.account.read at company scope the customer's own rows are readable too.
    expect(await visible(agent('agent:chief'))).toEqual(['kAccount', 'kLeadX', 'kLeadY']);
  });

  it('a role with no lead or customer read reads nothing', async () => {
    expect(await visible(principalFor('agent:sizing', [1, 2]))).toEqual([]);
  });
});

type Row = {
  entityId: number;
  opportunityId: string | null;
  accountId: string;
  type?: string;
  actor?: string;
  body?: string | null;
};

function insertAs(who: Principal, row: Row) {
  return asPrincipal(who, ({ tx }) =>
    tx.execute(sql`
      insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, body)
      values (${newId()}, ${row.entityId}, ${row.opportunityId}, ${row.accountId},
              ${row.type ?? 'stage_moved'}, ${row.actor ?? who.id}, ${row.body ?? null})`),
  );
}

describe('writing the timeline as the application', () => {
  const rls = /row-level security/;

  it('takes a row on a lead or a customer the caller reads', async () => {
    await insertAs(x, { entityId: 1, opportunityId: k.leadX, accountId: k.account });
    await insertAs(x, { entityId: 1, opportunityId: null, accountId: k.account });
    await insertAs(y, { entityId: 1, opportunityId: null, accountId: k.account });
  });

  it('refuses a row for another actor, another company, or a lead the caller does not read', async () => {
    expect(
      await failure(
        insertAs(x, { entityId: 1, opportunityId: k.leadX, accountId: k.account, actor: y.id }),
      ),
    ).toMatch(rls);
    expect(
      await failure(insertAs(x, { entityId: 2, opportunityId: n.lead, accountId: n.account })),
    ).toMatch(rls);
    expect(
      await failure(insertAs(x, { entityId: 1, opportunityId: k.leadY, accountId: k.account })),
    ).toMatch(rls);
  });

  it('refuses a lead under another customer or company than its own', async () => {
    const exec = principalFor('executive');
    expect(
      await failure(insertAs(exec, { entityId: 1, opportunityId: k.leadX, accountId: n.account })),
    ).toMatch(rls);
    expect(
      await failure(insertAs(exec, { entityId: 2, opportunityId: k.leadX, accountId: k.account })),
    ).toMatch(rls);
    // A customer row only in a company the customer deals with.
    expect(
      await failure(insertAs(exec, { entityId: 2, opportunityId: null, accountId: k.account })),
    ).toMatch(rls);
  });

  it('keeps free text to a note, and a note always has it', async () => {
    const exec = principalFor('executive');
    expect(
      await failure(
        insertAs(exec, {
          entityId: 1,
          opportunityId: k.leadX,
          accountId: k.account,
          body: 'free text',
        }),
      ),
    ).toMatch(/activities_body_check/);
    expect(
      await failure(
        insertAs(exec, { entityId: 1, opportunityId: k.leadX, accountId: k.account, type: 'note' }),
      ),
    ).toMatch(/activities_body_check/);
    expect(
      await failure(
        insertAs(exec, {
          entityId: 1,
          opportunityId: k.leadX,
          accountId: k.account,
          type: 'note',
          body: 'x'.repeat(2001),
        }),
      ),
    ).toMatch(/activities_body_check/);
  });

  it('never updates or deletes a row, not even as the table owner', async () => {
    const exec = principalFor('executive');
    const denied = /permission denied/;
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`update activities set type = 'won' where id = ${rows.kLeadX}`),
        ),
      ),
    ).toMatch(denied);
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`delete from activities where id = ${rows.kLeadX}`),
        ),
      ),
    ).toMatch(denied);
    expect(
      await failure(
        asMigrator((m) => m`update activities set type = 'won' where id = ${rows.kLeadX}`),
      ),
    ).toMatch(/append-only/);
    expect(
      await failure(asMigrator((m) => m`delete from activities where id = ${rows.kLeadX}`)),
    ).toMatch(/append-only/);
  });
});

describe('monthly partitions (docs/DATABASE.md §7)', () => {
  it('no request role can use the partitions schema', async () => {
    const found = await asMigrator(
      (m) => m<{ role: string; usable: boolean }[]>`
        select r as role, has_schema_privilege(r, 'crm_partitions', 'usage') as usable
          from unnest(array['app_user', 'auth_service', 'outbox_publisher', 'readonly_reporter']) as r
      `,
    );
    expect(found.every((r) => !r.usable)).toBe(true);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(sql`select count(*) from crm_partitions.activities_default`),
        ),
      ),
    ).toMatch(/permission denied for schema crm_partitions/);
  });

  it('has this month and the next three, a default, and routes a new row to its month', async () => {
    const parts = await asMigrator(
      (m) => m<{ name: string }[]>`
        select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
         where i.inhparent = 'public.activities'::regclass
      `,
    );
    const names = parts.map((p) => p.name);
    expect(names).toContain('activities_default');
    const now = new Date();
    for (let i = 0; i <= 3; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      expect(names).toContain(
        `activities_${String(d.getUTCFullYear())}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      );
    }
    const [row] = await asMigrator(
      (m) => m<{ part: string }[]>`
        select tableoid::regclass::text as part from activities where id = ${rows.kLeadX}
      `,
    );
    expect(row?.part).toMatch(/^crm_partitions\.activities_\d{4}_\d{2}$/);
  });

  it('making partitions is idempotent and only the migrator may do it', async () => {
    const [again] = await asMigrator(
      (m) => m<{ n: number }[]>`select app.ensure_activity_partitions(3) as n`,
    );
    expect(again?.n).toBe(0);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(sql`select app.ensure_activity_partitions(3)`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('keeps the partitions coming every month', async () => {
    const jobs = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'activities-partitions'
      `,
    );
    expect(jobs).toEqual([
      { schedule: '5 3 25 * *', command: 'select app.ensure_activity_partitions(3)' },
    ]);
  });
});
