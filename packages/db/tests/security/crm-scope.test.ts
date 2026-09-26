import type { Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  countAs,
  principalFor,
  SHARED_TABLES,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

let fx: CrmFixture;

beforeAll(async () => {
  fx = await crmFixture();
});
afterAll(closeDb);

async function visibleIds(principal: Principal, table: string, where = ''): Promise<string[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select id from ${sql.identifier(table)} where id::text like '01990000-0000-7000-8000-0000000f%' ${sql.raw(where)} order by id`,
    )) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  });
}

const sorted = (ids: readonly string[]) => [...ids].sort();

describe('ownership scope on opportunities (crm.lead.read)', () => {
  it('a caller with own scope sees only the leads they own', async () => {
    expect(await visibleIds(fx.principals.a, 'opportunities')).toEqual(sorted(fx.leads.a));
    expect(await visibleIds(fx.principals.b, 'opportunities')).toEqual(sorted(fx.leads.b));
  });

  it('a team lead with team scope sees the team and not another team', async () => {
    expect(await visibleIds(fx.principals.l, 'opportunities')).toEqual(
      sorted([...fx.leads.a, ...fx.leads.b]),
    );
  });

  it('a GM with entity scope sees every lead of the entity', async () => {
    expect(await visibleIds(fx.principals.gm, 'opportunities')).toEqual(
      sorted([...fx.leads.a, ...fx.leads.b, ...fx.leads.c]),
    );
  });

  it('a caller in another entity sees only that entity', async () => {
    expect(await visibleIds(fx.principals.d, 'opportunities')).toEqual(sorted(fx.leads.d));
  });

  it('an Executive scoped to entity 2 does not see entity 1', async () => {
    expect(await visibleIds(principalFor('executive', [2]), 'opportunities')).toEqual(
      sorted(fx.leads.d),
    );
  });
});

describe('ownership scope on accounts and contacts (crm.account.read)', () => {
  it('own, team and entity scopes apply the same way', async () => {
    expect(await visibleIds(fx.principals.a, 'accounts')).toEqual(sorted(fx.accounts.a));
    expect(await visibleIds(fx.principals.a, 'contacts')).toEqual(sorted(fx.contacts.a));
    expect(await visibleIds(fx.principals.l, 'accounts')).toEqual(
      sorted([...fx.accounts.a, ...fx.accounts.b]),
    );
    expect(await visibleIds(fx.principals.gm, 'contacts')).toEqual(
      sorted([...fx.contacts.a, ...fx.contacts.b, ...fx.contacts.c]),
    );
  });

  it('a role without crm.account.read sees no accounts even inside the entity', async () => {
    expect(await countAs(principalFor('hr_admin', [1]), 'accounts')).toBe(0);
    expect(await countAs(principalFor('hr_admin', [1]), 'opportunities')).toBe(0);
  });
});

describe('child tables follow their parent', () => {
  it.each(['contact_phones', 'consents'] as const)('%s follows the contact', async (table) => {
    const own = await visibleIds(fx.principals.a, table);
    expect(own).toHaveLength(fx.contacts.a.length);
    const asB = await visibleIds(fx.principals.b, table);
    expect(asB).toHaveLength(fx.contacts.b.length);
    expect(own.some((x) => asB.includes(x))).toBe(false);
    expect(await visibleIds(fx.principals.gm, table)).toHaveLength(4);
  });

  it('customer_sites follows the account', async () => {
    expect(await visibleIds(fx.principals.a, 'customer_sites')).toHaveLength(2);
    expect(await visibleIds(fx.principals.c, 'customer_sites')).toHaveLength(1);
    expect(await visibleIds(fx.principals.l, 'customer_sites')).toHaveLength(3);
  });

  it('account_contacts follows the account', async () => {
    const n = await asPrincipal(fx.principals.a, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select count(*)::int as n from account_contacts where account_id::text like '01990000-0000-7000-8000-0000000f%'`,
      )) as unknown as { n: number }[];
      return rows[0]?.n;
    });
    expect(n).toBe(2);
  });
});

describe('child writes follow the parent write scope, not its read scope', () => {
  it("a caller who can read a colleague's contact but not update it cannot add a phone to it", async () => {
    const reader = principalFor('tele_caller_cc', [1], {
      teamId: fx.teams.t1,
      permissions: [
        { key: 'crm.account.read', scope: 'entity' },
        { key: 'crm.account.write', scope: 'own' },
      ],
    });
    await asMigrator(
      (m) =>
        m`insert into principals (id, kind, display_name) values (${reader.id}, 'user', 'reader') on conflict do nothing`,
    );
    const insertPhone = (contactId: string, suffix: string) =>
      asPrincipal(reader, ({ tx }) =>
        tx.execute(sql`insert into contact_phones (id, entity_id, contact_id, e164, is_primary, created_by)
          values (${`01990000-0000-7000-8000-0000000ff0${suffix}`}, 1, ${contactId}, ${`+9198111${suffix}0000`.slice(0, 13)}, false, ${reader.id})`),
      );
    expect(await countAs(reader, 'contacts')).toBeGreaterThan(0);
    await expect(insertPhone(fx.contacts.b[0] ?? '', '01')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('row-level security'),
    );
    await expect(
      asPrincipal(reader, ({ tx }) =>
        tx.execute(
          sql`update customer_sites set village = village where account_id = ${fx.accounts.b[0] ?? ''} returning id`,
        ),
      ),
    ).resolves.toHaveLength(0);
  });
});

describe('shared reference tables', () => {
  it.each(SHARED_TABLES)('%s is readable by any caller with a context', async (table) => {
    expect(await countAs(fx.principals.d, table)).toBeGreaterThan(0);
  });

  it('teams of another entity are hidden', async () => {
    const teams = await visibleIds(fx.principals.d, 'teams');
    expect(teams).toEqual([fx.teams.t3]);
  });
});

describe('write policies', () => {
  async function updateScore(principal: Principal, oppId: string): Promise<number> {
    return asPrincipal(principal, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update opportunities set score = score where id = ${oppId} returning id`,
      )) as unknown as { id: string }[];
      return rows.length;
    });
  }

  it("a caller updates their own lead and not a colleague's", async () => {
    expect(await updateScore(fx.principals.a, fx.leads.a[0] ?? '')).toBe(1);
    expect(await updateScore(fx.principals.a, fx.leads.b[0] ?? '')).toBe(0);
  });

  it("a team lead updates a team member's lead; a GM updates any lead in the entity", async () => {
    expect(await updateScore(fx.principals.l, fx.leads.b[0] ?? '')).toBe(1);
    expect(await updateScore(fx.principals.l, fx.leads.c[0] ?? '')).toBe(0);
    expect(await updateScore(fx.principals.gm, fx.leads.c[0] ?? '')).toBe(1);
  });

  it('a caller cannot hand their lead to someone else by changing owner_id', async () => {
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(
          sql`update opportunities set owner_id = ${fx.principals.b.id} where id = ${fx.leads.a[0] ?? ''}`,
        ),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('row-level security'),
    );
  });

  it('a caller cannot insert a lead into another entity or for another owner', async () => {
    const insert = (entityId: number, ownerId: string) =>
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`
          insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${'01990000-0000-7000-8000-0000000fffff'}, ${entityId}, ${fx.accounts.a[0] ?? ''},
                  (select id from pipelines limit 1), (select id from pipeline_stages limit 1),
                  ${ownerId}, ${fx.teams.t1}, ${fx.principals.a.id})
        `),
      );
    const rls = (e: unknown) =>
      e instanceof Error &&
      e.cause instanceof Error &&
      e.cause.message.includes('row-level security');
    await expect(insert(2, fx.principals.a.id)).rejects.toSatisfy(rls);
    await expect(insert(1, fx.principals.b.id)).rejects.toSatisfy(rls);
  });
});
