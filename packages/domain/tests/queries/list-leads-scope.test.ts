import { asPrincipal, closeDb, createTestPrincipal, createTestTeam } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { countLeads, listLeads } from '../../src/queries/crm/list-leads';

afterAll(closeDb);

const phone = () => `97${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const lead = (entityId: number) => ({
  entityId,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Scope list customer', phone: phone() },
  account: { type: 'farm' as const },
});

let ids: { mine: string; teammate: string; otherTeam: string };
let people: Record<
  'caller' | 'teammate' | 'lead' | 'outsider' | 'gm',
  Awaited<ReturnType<typeof createTestPrincipal>>
>;

beforeAll(async () => {
  const team = await createTestTeam(4, 'scope list team');
  const otherTeam = await createTestTeam(4, 'scope list other team');
  people = {
    caller: await createTestPrincipal('tele_caller_cc', [4], { teamId: team }),
    teammate: await createTestPrincipal('tele_caller_cc', [4], { teamId: team }),
    lead: await createTestPrincipal('sales_team_lead', [4], { teamId: team }),
    outsider: await createTestPrincipal('tele_caller_cc', [4], { teamId: otherTeam }),
    gm: await createTestPrincipal('general_manager', [4]),
  };
  const create = async (who: keyof typeof people) =>
    (
      await asPrincipal(people[who], (context) =>
        runCommand(createLead, { context, audit }, lead(4)),
      )
    ).id;
  ids = {
    mine: await create('caller'),
    teammate: await create('teammate'),
    otherTeam: await create('outsider'),
  };
});

const listed = async (who: keyof typeof people) => {
  const { page, count } = await asPrincipal(people[who], async (ctx) => ({
    page: (await listLeads(ctx, { limit: 200 })).items.map((l) => l.id),
    count: await countLeads(ctx),
  }));
  return { page, count };
};

describe('the lead list pages by the caller scope (AUDIT M31, M33)', () => {
  it('a caller with own scope lists their own leads only', async () => {
    const { page } = await listed('caller');
    expect(page).toContain(ids.mine);
    expect(page).not.toContain(ids.teammate);
    expect(page).not.toContain(ids.otherTeam);
  });

  it('a team lead lists the team, not the other team', async () => {
    const { page } = await listed('lead');
    expect(page).toEqual(expect.arrayContaining([ids.mine, ids.teammate]));
    expect(page).not.toContain(ids.otherTeam);
  });

  it('a General Manager lists the whole company, and the count agrees with the list', async () => {
    const { page, count } = await listed('gm');
    expect(page).toEqual(expect.arrayContaining([ids.mine, ids.teammate, ids.otherTeam]));
    expect(count).toBeGreaterThanOrEqual(3);
    for (const who of ['caller', 'lead'] as const) {
      const own = await listed(who);
      expect(own.count).toBe(own.page.length);
    }
  });

  it('every listed lead comes with its customer and owner contact', async () => {
    const items = await asPrincipal(people.lead, async (ctx) => (await listLeads(ctx)).items);
    for (const item of items) {
      expect(item.account.name).not.toBe('');
      expect(item.contact?.phone).toMatch(/^\+91/);
    }
  });
});
