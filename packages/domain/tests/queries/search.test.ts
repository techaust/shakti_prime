import { newId, type Principal } from '@shakti/contracts';
import {
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { searchPeople } from '../../src/queries/admin/search-people';
import { searchLeads } from '../../src/queries/crm/search-leads';

afterAll(closeDb);

// Every name and village carries this run's tag, so earlier runs never answer these searches.
const tag = `srch${newId().slice(-8)}`;
const phone = () => `95${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

let people: Record<'caller' | 'teammate' | 'teamLead' | 'gm' | 'other', Principal>;
let ids: { mine: string; teammate: string; otherCompany: string };
let myPhone: string;

async function newLead(owner: Principal, entityId: number, name: string, tel: string) {
  const lead = await asPrincipal(owner, (context) =>
    runCommand(
      createLead,
      { context, audit, outbox },
      {
        entityId,
        pipelineKey: 'farmer_pumps',
        contact: { name, phone: tel },
        account: { type: 'farm' },
        site: { type: 'borewell', village: `Village ${tag}`, pin: '422001' },
      },
    ),
  );
  return lead.id;
}

const search = (who: Principal, q: string, limit?: number) =>
  asPrincipal(who, (ctx) => searchLeads(ctx, limit === undefined ? { q } : { q, limit }));
const found = async (who: Principal, q: string) => (await search(who, q)).map((l) => l.id);

beforeAll(async () => {
  const team = await createTestTeam(1, 'search team');
  people = {
    caller: await createTestPrincipal('tele_caller_cc', [1], { teamId: team }),
    teammate: await createTestPrincipal('tele_caller_cc', [1], { teamId: team }),
    teamLead: await createTestPrincipal('sales_team_lead', [1], { teamId: team }),
    gm: await createTestPrincipal('general_manager', [1]),
    other: await createTestPrincipal('general_manager', [2]),
  };
  myPhone = phone();
  ids = {
    mine: await newLead(people.caller, 1, `Ramesh ${tag}`, myPhone),
    teammate: await newLead(people.teammate, 1, `Suresh ${tag}`, phone()),
    otherCompany: await newLead(people.other, 2, `Ramesh ${tag} two`, phone()),
  };
});

describe('searchLeads (DESIGN.md §6, Command palette)', () => {
  it('is refused without crm.lead.read', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    await expect(search(hr, tag)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a text shorter than two characters and more than twenty hits', async () => {
    await expect(search(people.caller, 'R')).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(search(people.caller, ' R ')).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(search(people.caller, tag, 21)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('finds a lead by the customer name, in any case, with what the palette shows', async () => {
    const hits = await search(people.caller, `ramesh ${tag.toUpperCase()}`);
    expect(hits.map((h) => h.id)).toEqual([ids.mine]);
    expect(hits[0]).toEqual({
      id: ids.mine,
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      state: 'open',
      customerName: `Ramesh ${tag}`,
      village: `Village ${tag}`,
    });
  });

  it('finds a lead by its village', async () => {
    expect(await found(people.caller, `Village ${tag}`)).toEqual([ids.mine]);
  });

  it('finds a lead by the last digits of the phone, however they are written', async () => {
    const last = myPhone.slice(-6);
    expect(await found(people.caller, last)).toContain(ids.mine);
    expect(await found(people.caller, `${last.slice(0, 3)} ${last.slice(3)}`)).toContain(ids.mine);
    expect(await found(people.caller, `+91 ${myPhone}`)).toEqual([ids.mine]);
    // Digits from the middle of the number are not its last digits.
    expect(await found(people.caller, myPhone.slice(0, 6))).not.toContain(ids.mine);
  });

  it('keeps an own-scope caller to their own leads, a team lead to the team', async () => {
    expect(await found(people.caller, tag)).toEqual([ids.mine]);
    expect(await found(people.teammate, tag)).toEqual([ids.teammate]);
    const forLead = await found(people.teamLead, tag);
    expect(forLead).toEqual(expect.arrayContaining([ids.mine, ids.teammate]));
    expect(forLead).not.toContain(ids.otherCompany);
  });

  it('keeps a company to its own leads, newest change first', async () => {
    const forGm = await found(people.gm, tag);
    expect(forGm).toEqual([ids.teammate, ids.mine]);
    expect(await found(people.other, tag)).toEqual([ids.otherCompany]);
    // A principal whose request is narrowed to another company finds none of company 1's leads.
    const narrowed = await asPrincipal(principalFor('general_manager', [2]), (ctx) =>
      searchLeads(ctx, { q: `Ramesh ${tag}` }),
    );
    expect(narrowed.map((h) => h.id)).toEqual([ids.otherCompany]);
  });

  it('treats typed wildcards as the characters themselves, and keeps to the limit', async () => {
    expect(await found(people.gm, `${tag}%`)).toEqual([]);
    expect(await found(people.gm, `_${tag}`)).toEqual([]);
    expect(await search(people.gm, tag, 1)).toHaveLength(1);
  });
});

describe('searchPeople', () => {
  let person: string;
  let elsewhere: string;

  beforeAll(async () => {
    person = (await createTestUser([{ entityId: 1, roleKey: 'accounts' }], { name: `Asha ${tag}` }))
      .id;
    elsewhere = (
      await createTestUser([{ entityId: 2, roleKey: 'accounts' }], { name: `Asha ${tag} two` })
    ).id;
  });

  const findPeople = (who: Principal, q: string) =>
    asPrincipal(who, (ctx) => searchPeople(ctx, { q }));

  it('is for a user administrator only', async () => {
    await expect(
      findPeople(await createTestPrincipal('general_manager', [1]), tag),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('finds staff of the companies being viewed by name', async () => {
    const hits = await findPeople(principalFor('executive', [1]), `asha ${tag}`);
    expect(hits.map((h) => h.id)).toEqual([person]);
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(['displayName', 'email', 'id']);
    const all = await findPeople(principalFor('executive', [1, 2]), tag);
    expect(all.map((h) => h.id)).toEqual([person, elsewhere]);
  });
});
