import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// `calls` (docs/05-database.md §6.2, docs/03-roadmap-appendix/phase1.md §7.2): a child of the lead, read with it,
// logged by a person whose `calls.log` scope covers the lead, with an outcome in use of the group
// or the lead's company, and never changed afterwards.

/** The database's message for a refused statement (drizzle wraps it as the cause). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

let fx: CrmFixture;
/** An outcome of the group's list, which the seed always writes. */
let groupOutcome: string;
/** An outcome only company 2 uses, and an archived one of the group. */
const otherCompanyOutcome = newId();
const archivedOutcome = newId();

beforeAll(async () => {
  fx = await crmFixture();
  const [row] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select id from call_dispositions
       where entity_id is null and segment is null and archived_at is null
       order by position limit 1`,
  );
  if (!row) throw new Error('the seed wrote no call outcomes');
  groupOutcome = row.id;
  await asMigrator(
    (m) => m`
      insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position, archived_at)
      values (${otherCompanyOutcome}, 2, 'dealer_wholesale', 9, 'calls_suite_outcome', 'calls suite outcome', 'retry', 9, null),
             (${archivedOutcome}, null, 'dealer_wholesale', 9, 'calls_suite_old', 'calls suite old', 'retry', 9, now())`,
  );
});
afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table calls disable trigger calls_append_only`;
      await tx`delete from calls where disposition_id in (${otherCompanyOutcome}, ${archivedOutcome})`;
      await tx`alter table calls enable trigger calls_append_only`;
      await tx`delete from call_dispositions where id in (${otherCompanyOutcome}, ${archivedOutcome})`;
    }),
  );
  await closeDb();
});

function lead(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

interface CallRow {
  entityId?: number;
  opportunityId: string;
  callerId?: string;
  dispositionId?: string;
}

function insertAs(principal: Principal, row: CallRow) {
  const id = newId();
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`
      insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                         disposition_id, attempt_no, started_at, duration_s)
      values (${id}, ${row.entityId ?? 1}, ${row.opportunityId}, ${row.callerId ?? principal.id},
              'outbound', 'manual', ${row.dispositionId ?? groupOutcome}, 1, now(), 60)`),
  ).then(() => id);
}

async function visible(principal: Principal, id: string): Promise<boolean> {
  const rows = await asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`select id from calls where id = ${id}`),
  );
  return (rows as unknown as unknown[]).length === 1;
}

describe('logging a call', () => {
  it('the lead’s owner logs one on their lead', async () => {
    const id = await insertAs(fx.principals.a, { opportunityId: lead('a') });
    expect(await visible(fx.principals.a, id)).toBe(true);
  });

  it('a team lead logs one on a lead of the team, a GM on any lead of the company', async () => {
    await expect(insertAs(fx.principals.l, { opportunityId: lead('a') })).resolves.toBeTruthy();
    await expect(insertAs(fx.principals.gm, { opportunityId: lead('c') })).resolves.toBeTruthy();
  });

  it('a colleague with own scope cannot log one on another person’s lead', async () => {
    expect(await failure(insertAs(fx.principals.b, { opportunityId: lead('a') }))).toMatch(
      /row-level security/,
    );
  });

  it('someone who reads leads but may not log calls cannot log one', async () => {
    // Accounts read every lead of the company and hold no `calls.log` (SECURITY §3.2).
    const accounts = await createTestPrincipal('accounts', [1]);
    expect(await failure(insertAs(accounts, { opportunityId: lead('a') }))).toMatch(
      /row-level security/,
    );
  });

  it('a principal that is not a person cannot log one, even with the grant', async () => {
    const [system] = await asMigrator(
      (m) =>
        m<{ id: string }[]>`select id from principals where kind = 'system' order by id limit 1`,
    );
    if (!system) throw new Error('no seeded system principal');
    const service = principalFor('system:workers', [1], {
      id: system.id,
      permissions: [
        { key: 'crm.lead.read', scope: 'entity' },
        { key: 'calls.log', scope: 'entity' },
      ],
    });
    expect(await failure(insertAs(service, { opportunityId: lead('a') }))).toMatch(
      /row-level security/,
    );
  });

  it('is refused in another person’s name', async () => {
    expect(
      await failure(
        insertAs(fx.principals.a, { opportunityId: lead('a'), callerId: fx.principals.b.id }),
      ),
    ).toMatch(/row-level security/);
  });

  it('is refused with an outcome no longer in use or of another company', async () => {
    expect(
      await failure(
        insertAs(fx.principals.a, { opportunityId: lead('a'), dispositionId: archivedOutcome }),
      ),
    ).toMatch(/row-level security/);
    const executive = await createTestPrincipal('executive', [1, 2]);
    expect(
      await failure(
        insertAs(executive, { opportunityId: lead('a'), dispositionId: otherCompanyOutcome }),
      ),
    ).toMatch(/row-level security/);
  });

  it('is refused in a company the request does not act in', async () => {
    expect(
      await failure(insertAs(fx.principals.d, { opportunityId: lead('a'), entityId: 1 })),
    ).toMatch(/row-level security/);
  });

  it('is refused under another company than the lead’s', async () => {
    const executive = await createTestPrincipal('executive', [1, 2]);
    expect(await failure(insertAs(executive, { opportunityId: lead('d'), entityId: 1 }))).toMatch(
      /calls_opportunity_entity_fk/,
    );
  });

  it('keeps its value lists', async () => {
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`
          insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                             disposition_id, attempt_no, started_at)
          values (${newId()}, 1, ${lead('a')}, ${fx.principals.a.id}, 'outbound', '150',
                  ${groupOutcome}, 1, now())`),
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'calls_number_series_check' } });
  });
});

describe('reading a call', () => {
  let callId: string;
  beforeAll(async () => {
    callId = await insertAs(fx.principals.a, { opportunityId: lead('a') });
  });

  it('is seen with the lead: its owner, the team lead and the company’s GM', async () => {
    expect(await visible(fx.principals.a, callId)).toBe(true);
    expect(await visible(fx.principals.l, callId)).toBe(true);
    expect(await visible(fx.principals.gm, callId)).toBe(true);
  });

  it('is hidden from a colleague who cannot read the lead and from another company', async () => {
    expect(await visible(fx.principals.b, callId)).toBe(false);
    expect(await visible(fx.principals.c, callId)).toBe(false);
    expect(await visible(fx.principals.d, callId)).toBe(false);
  });

  it('is hidden with no request context at all', async () => {
    expect(await withoutContext(sql`select id from calls where id = ${callId}`)).toEqual([]);
  });
});

describe('calls are append-only', () => {
  let callId: string;
  beforeAll(async () => {
    callId = await insertAs(fx.principals.a, { opportunityId: lead('a') });
  });

  it('the application can neither change nor remove one', async () => {
    expect(
      await failure(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(sql`update calls set attempt_no = 2 where id = ${callId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(sql`delete from calls where id = ${callId}`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('not even the table owner can change one', async () => {
    await expect(
      asMigrator((m) => m`update calls set attempt_no = 2 where id = ${callId}`),
    ).rejects.toThrow(/append-only/);
  });
});
