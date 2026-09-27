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

  it('a shared customer is seen by each entity through its own relationship (ADR 0008)', async () => {
    // account 0 belongs to A in entity 1 and to D in entity 2; B and the entity-2 Executive differ.
    expect(await visibleIds(fx.principals.d, 'accounts')).toEqual(
      sorted([...fx.accounts.d, fx.accounts.a[0] ?? '']),
    );
    expect(await visibleIds(fx.principals.d, 'contacts')).toEqual(
      sorted([...fx.contacts.d, fx.contacts.a[0] ?? '']),
    );
    expect(await visibleIds(fx.principals.b, 'accounts')).toEqual(sorted(fx.accounts.b));
    expect(await visibleIds(principalFor('executive', [2]), 'accounts')).toEqual(
      sorted([...fx.accounts.d, fx.accounts.a[0] ?? '']),
    );
    // D updates the shared account through the entity-2 relationship; B cannot touch it at all.
    const rename = (p: Principal) =>
      asPrincipal(p, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`update accounts set name = name where id = ${fx.accounts.a[0] ?? ''} returning id`,
        )) as unknown as { id: string }[];
        return rows.length;
      });
    expect(await rename(fx.principals.d)).toBe(1);
    expect(await rename(fx.principals.b)).toBe(0);
  });

  it('a contact with no account link and an account with no relationship are visible to nobody', async () => {
    const orphanContact = '01990000-0000-7000-8000-0000000fee01';
    const orphanAccount = '01990000-0000-7000-8000-0000000fee02';
    await asMigrator(
      (
        m,
      ) => m`insert into contacts (id, name, created_by) values (${orphanContact}, 'orphan', ${fx.principals.a.id})
        on conflict (id) do nothing`,
    );
    await asMigrator(
      (
        m,
      ) => m`insert into accounts (id, type, name, created_by) values (${orphanAccount}, 'farm', 'orphan', ${fx.principals.a.id})
        on conflict (id) do nothing`,
    );
    for (const p of [fx.principals.a, fx.principals.gm, principalFor('executive')]) {
      expect(await visibleIds(p, 'contacts')).not.toContain(orphanContact);
      expect(await visibleIds(p, 'accounts')).not.toContain(orphanAccount);
    }
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
        tx.execute(sql`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
          values (${`01990000-0000-7000-8000-0000000ff0${suffix}`}, ${contactId}, ${`+9198111${suffix}0000`.slice(0, 13)}, false, ${reader.id})`),
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

describe('the link tables cannot widen scope by a direct write (review 3)', () => {
  const rlsRefused = (e: unknown) =>
    e instanceof Error &&
    e.cause instanceof Error &&
    e.cause.message.includes('row-level security');

  it('a relationship row for an account the caller does not see is refused', async () => {
    // C (entity 1, own scope) does not see D's customer in entity 2; naming its id is not enough.
    const target = fx.accounts.d[0] ?? '';
    expect(await visibleIds(fx.principals.c, 'accounts')).not.toContain(target);
    await expect(
      asPrincipal(fx.principals.c, ({ tx }) =>
        tx.execute(sql`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values ('01990000-0000-7000-8000-0000000fe001', ${target}, 1, ${fx.principals.c.id}, ${fx.teams.t2}, ${fx.principals.c.id})`),
      ),
    ).rejects.toSatisfy(rlsRefused);
    expect(await visibleIds(fx.principals.c, 'accounts')).not.toContain(target);
  });

  it('a first relationship for a new account and a second for a visible account are allowed', async () => {
    const fresh = '01990000-0000-7000-8000-0000000fe010';
    await asPrincipal(fx.principals.c, async ({ tx }) => {
      await tx.execute(sql`insert into accounts (id, type, name, created_by)
        values (${fresh}, 'farm', 'fixture fresh account', ${fx.principals.c.id})`);
      await tx.execute(sql`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values ('01990000-0000-7000-8000-0000000fe011', ${fresh}, 1, ${fx.principals.c.id}, ${fx.teams.t2}, ${fx.principals.c.id})`);
    });
    expect(await visibleIds(fx.principals.c, 'accounts')).toContain(fresh);
    // An Executive who sees the account may relate it to a second entity under another owner.
    await expect(
      asPrincipal(principalFor('executive', [1, 2]), ({ tx }) =>
        tx.execute(sql`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values ('01990000-0000-7000-8000-0000000fe012', ${fresh}, 2, ${fx.principals.d.id}, ${fx.teams.t3}, ${fx.principals.d.id})`),
      ),
    ).resolves.toBeDefined();
    await asMigrator(async (m) => {
      await m`delete from account_entities where account_id = ${fresh}`;
      await m`delete from accounts where id = ${fresh}`;
    });
  });

  it("a contact of another entity's customer cannot be linked to the caller's own account", async () => {
    const foreignContact = fx.contacts.d[0] ?? '';
    expect(await visibleIds(fx.principals.a, 'contacts')).not.toContain(foreignContact);
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${fx.accounts.a[1] ?? ''}, ${foreignContact}, 'family', ${fx.principals.a.id})`),
      ),
    ).rejects.toSatisfy(rlsRefused);
    expect(await visibleIds(fx.principals.a, 'contacts')).not.toContain(foreignContact);
    expect(await visibleIds(fx.principals.a, 'contact_phones')).not.toContain(
      '01990000-0000-7000-8000-0000000f1042',
    );
  });

  it('a contact the caller may write, or a brand-new contact, can be linked', async () => {
    const newContact = '01990000-0000-7000-8000-0000000fe020';
    await asPrincipal(fx.principals.a, async ({ tx }) => {
      await tx.execute(sql`insert into contacts (id, name, created_by)
        values (${newContact}, 'fixture new contact', ${fx.principals.a.id})`);
      await tx.execute(sql`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${fx.accounts.a[1] ?? ''}, ${newContact}, 'family', ${fx.principals.a.id})`);
      // A's own contact 0 may also be linked to A's second account.
      await tx.execute(sql`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${fx.accounts.a[1] ?? ''}, ${fx.contacts.a[0] ?? ''}, 'manager', ${fx.principals.a.id})`);
    });
    expect(await visibleIds(fx.principals.a, 'contacts')).toContain(newContact);
    await asMigrator(async (m) => {
      await m`delete from account_contacts where contact_id = ${newContact} or (account_id = ${fx.accounts.a[1] ?? ''} and role = 'manager')`;
      await m`delete from contacts where id = ${newContact}`;
    });
  });

  it("a site or a consent cannot be added to another entity's customer", async () => {
    const hiddenAccount = fx.accounts.d[0] ?? '';
    const hiddenContact = fx.contacts.d[0] ?? '';
    await expect(
      asPrincipal(fx.principals.c, ({ tx }) =>
        tx.execute(sql`insert into customer_sites (id, account_id, type, village, created_by)
          values ('01990000-0000-7000-8000-0000000fe030', ${hiddenAccount}, 'borewell', 'Probe', ${fx.principals.c.id})`),
      ),
    ).rejects.toSatisfy(rlsRefused);
    await expect(
      asPrincipal(fx.principals.c, ({ tx }) =>
        tx.execute(sql`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
          values ('01990000-0000-7000-8000-0000000fe031', ${hiddenContact}, 'call', 'service', 'walk_in_form', 'v1', now(), ${fx.principals.c.id})`),
      ),
    ).rejects.toSatisfy(rlsRefused);
  });

  // The update policies carry the same account and contact clauses as the inserts (AUDIT M40).
  it('an existing relationship cannot be re-pointed at an account the caller does not see', async () => {
    const hidden = fx.accounts.d[0] ?? '';
    expect(await visibleIds(fx.principals.c, 'accounts')).not.toContain(hidden);
    await expect(
      asPrincipal(fx.principals.c, ({ tx }) =>
        tx.execute(sql`update account_entities set account_id = ${hidden}
          where account_id = ${fx.accounts.c[0] ?? ''} and entity_id = 1`),
      ),
    ).rejects.toSatisfy(rlsRefused);
    expect(await visibleIds(fx.principals.c, 'accounts')).not.toContain(hidden);
  });

  it("an existing contact link cannot be re-pointed at another entity's contact", async () => {
    const foreignContact = fx.contacts.d[0] ?? '';
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`update account_contacts set contact_id = ${foreignContact}
          where account_id = ${fx.accounts.a[0] ?? ''} and contact_id = ${fx.contacts.a[0] ?? ''}`),
      ),
    ).rejects.toSatisfy(rlsRefused);
    expect(await visibleIds(fx.principals.a, 'contacts')).not.toContain(foreignContact);
  });

  it('a contact has one primary phone', async () => {
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
          values ('01990000-0000-7000-8000-0000000fe030', ${fx.contacts.a[0] ?? ''}, '+919811100999', true, ${fx.principals.a.id})`),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('contact_phones_primary_unique'),
    );
  });
});

describe('an opportunity sits only in an entity its account deals with', () => {
  const insertOpp = (id: string, entityId: number, accountId: string, siteId: string | null) =>
    asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, created_by)
        values (${id}, ${entityId}, ${accountId}, ${siteId},
                (select id from pipelines limit 1), (select id from pipeline_stages limit 1),
                ${fx.principals.a.id}, ${fx.principals.a.id})`,
    );

  it('the trigger refuses a missing relationship and a site of another account, even for the table owner', async () => {
    // account 1 deals with entity 1 only
    await expect(
      insertOpp('01990000-0000-7000-8000-0000000ffe02', 2, fx.accounts.a[1] ?? '', null),
    ).rejects.toThrow(/no relationship with entity 2/);
    // account 0 deals with entity 2 as well, so this one is accepted
    await insertOpp('01990000-0000-7000-8000-0000000ffe03', 2, fx.accounts.a[0] ?? '', null);
    await asMigrator(
      (m) => m`delete from opportunities where id = ${'01990000-0000-7000-8000-0000000ffe03'}`,
    );
    // a site of account B on an opportunity of account A
    const [siteB] = await asMigrator(
      (m) =>
        m<
          { id: string }[]
        >`select id from customer_sites where account_id = ${fx.accounts.b[0] ?? ''}`,
    );
    await expect(
      insertOpp(
        '01990000-0000-7000-8000-0000000ffe04',
        1,
        fx.accounts.a[0] ?? '',
        siteB?.id ?? null,
      ),
    ).rejects.toThrow(/does not belong to account/);
  });

  it('attach_account_entity adds the caller entity to a customer they cannot see yet', async () => {
    // C (entity 1, own scope) cannot see account D's customer; attaching needs crm.lead.write in scope
    const target = fx.accounts.d[0] ?? '';
    expect(await visibleIds(fx.principals.c, 'accounts')).not.toContain(target);
    const attach = (p: Principal, account: string, entityId: number) =>
      asPrincipal(p, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select app.attach_account_entity(${account}::uuid, ${entityId}::smallint) as status`,
        )) as unknown as { status: string }[];
        return rows[0]?.status;
      });
    expect(await attach(fx.principals.c, target, 1)).toBe('attached');
    // asking again reports the relationship the caller now holds (AUDIT M25)
    expect(await attach(fx.principals.c, target, 1)).toBe('already_yours');
    // a colleague on another team is told it is held, and learns nothing more; the GM sees it
    expect(await attach(fx.principals.a, target, 1)).toBe('held_by_other');
    expect(await visibleIds(fx.principals.a, 'accounts')).not.toContain(target);
    expect(await attach(fx.principals.gm, target, 1)).toBe('already_yours');
    expect(await visibleIds(fx.principals.c, 'accounts')).toContain(target);
    expect(await attach(fx.principals.c, '01990000-0000-7000-8000-0000000fee99', 1)).toBe(
      'missing',
    );
    const causeIncludes = (text: string) => (e: unknown) =>
      e instanceof Error && e.cause instanceof Error && e.cause.message.includes(text);
    await expect(attach(fx.principals.c, target, 2)).rejects.toSatisfy(
      causeIncludes('outside the request scope'),
    );
    await expect(attach(principalFor('hr_admin', [1]), target, 1)).rejects.toSatisfy(
      causeIncludes('crm.lead.write'),
    );
    await asMigrator(
      (m) => m`delete from account_entities where account_id = ${target} and entity_id = 1`,
    );
  });
});

describe('shared reference tables', () => {
  // users is shared but personal: a caller reads only their own row (AUDIT M3, identity-scope).
  const REFERENCE_TABLES = SHARED_TABLES.filter((t) => t !== 'users');

  it.each(REFERENCE_TABLES)('%s is readable by any caller with a context', async (table) => {
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

describe('consent evidence is fixed once written (AUDIT M17)', () => {
  const refused = (e: unknown) =>
    e instanceof Error &&
    e.cause instanceof Error &&
    /permission denied|consents_(evidence|withdrawal)_fixed/.test(e.cause.message);

  async function consentOf(contactId: string) {
    const [row] = await asMigrator(
      (m) => m<{ id: string; purpose: string; withdrawn_at: Date | null }[]>`
        select id, purpose, withdrawn_at from consents where contact_id = ${contactId} limit 1`,
    );
    if (!row) throw new Error('the fixture gives every contact a consent');
    return row;
  }

  it('a customer writer cannot change purpose, source or date, only record a withdrawal', async () => {
    const consent = await consentOf(fx.contacts.a[0] ?? '');
    for (const change of [
      sql`purpose = 'promotional'`,
      sql`source = 'web_form'`,
      sql`given_at = given_at - interval '30 days'`,
    ]) {
      await expect(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(sql`update consents set ${change} where id = ${consent.id}`),
        ),
      ).rejects.toSatisfy(refused);
    }
    await asPrincipal(fx.principals.a, ({ tx }) =>
      tx.execute(sql`update consents set withdrawn_at = now() where id = ${consent.id}`),
    );
    const after = await consentOf(fx.contacts.a[0] ?? '');
    expect(after.purpose).toBe(consent.purpose);
    expect(after.withdrawn_at).not.toBeNull();
  });

  it('a withdrawal stands, even for the table owner', async () => {
    const consent = await consentOf(fx.contacts.b[0] ?? '');
    await asMigrator((m) => m`update consents set withdrawn_at = now() where id = ${consent.id}`);
    await expect(
      asMigrator((m) => m`update consents set withdrawn_at = null where id = ${consent.id}`),
    ).rejects.toMatchObject({ constraint_name: 'consents_withdrawal_fixed' });
    await expect(
      asMigrator((m) => m`update consents set purpose = 'promotional' where id = ${consent.id}`),
    ).rejects.toMatchObject({ constraint_name: 'consents_evidence_fixed' });
  });
});

describe('the customer scope helpers answer only for their own permissions (AUDIT L1)', () => {
  it.each(['account_in_scope', 'contact_in_scope'] as const)(
    '%s refuses any other permission name',
    async (fn) => {
      await expect(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(
            sql`select ${sql.raw(`app.${fn}`)}(${fx.accounts.a[0] ?? ''}::uuid, 'finance.cost.read')`,
          ),
        ),
      ).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof Error &&
          e.cause instanceof Error &&
          e.cause.message.includes('answers only'),
      );
    },
  );
});
