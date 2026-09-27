import { newId, type Principal } from '@shakti/contracts';
import {
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  stageId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { loseOpportunity } from '../../src/commands/crm/lose-opportunity';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listBoardLeads } from '../../src/queries/crm/list-board-leads';
import { listLeadAssignees } from '../../src/queries/crm/list-lead-assignees';

afterAll(closeDb);

const ENTITY = 1;
const tag = newId().slice(-8);
// The assignee list is bounded and by name: names that sort before every earlier run's keep this
// run's people on it however many people the suites have added.
const first = `0 ${String(1e13 - Date.now()).padStart(13, '0')}`;
const phone = () => `96${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

let team: string;
let otherTeam: string;
let caller: Principal;
let teammate: Principal;
let teamLead: Principal;
let gm: Principal;
let ids: { a: string; b: string; c: string; teammate: string };

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

async function newLead(owner: Principal, name: string): Promise<string> {
  const lead = await run(owner, createLead, {
    entityId: ENTITY,
    pipelineKey: 'farmer_pumps',
    contact: { name, phone: phone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: `Board village ${tag}`, pin: '422001' },
  });
  return (lead as { id: string }).id;
}

const board = (who: Principal, input: object = {}) =>
  asPrincipal(who, (ctx) => listBoardLeads(ctx, { pipelineKey: 'farmer_pumps', ...input }));

beforeAll(async () => {
  team = await createTestTeam(ENTITY, 'board team');
  otherTeam = await createTestTeam(ENTITY, 'board other team');
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { teamId: team });
  teammate = await createTestPrincipal('tele_caller_cc', [ENTITY], { teamId: team });
  teamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { teamId: team });
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  const a = await newLead(caller, `Board a ${tag}`);
  const b = await newLead(caller, `Board b ${tag}`);
  const c = await newLead(caller, `Board c ${tag}`);
  ids = { a, b, c, teammate: await newLead(teammate, `Board teammate ${tag}`) };
  // `a` moves on to Contacted; `b` is lost, so it leaves the open board.
  await run(caller, moveOpportunityStage, {
    entityId: ENTITY,
    opportunityId: a,
    stageId: stageId(1, 2),
  });
  await run(caller, loseOpportunity, {
    entityId: ENTITY,
    opportunityId: b,
    reasonCode: 'not_interested',
  });
});

describe('listBoardLeads (DESIGN.md §6, Kanban board)', () => {
  it('is refused without crm.lead.read', async () => {
    const hr = await createTestPrincipal('hr_admin', [ENTITY]);
    await expect(board(hr)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a company outside the request, and a pipeline that is not there', async () => {
    await expect(board(caller, { entityId: 2 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(board(caller, { pipelineKey: `none_${tag}` })).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'lead_pipeline_missing' },
    });
    await expect(board(caller, { states: [] })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('shows an own-scope caller only their own open leads, newest change first by stage', async () => {
    const shown = await board(caller, { entityId: ENTITY });
    const mine = shown.items.map((l) => l.id);
    expect(mine).not.toContain(ids.teammate);
    expect(mine).not.toContain(ids.b);
    // The caller is fresh, so everything on the board is theirs and in these three stages.
    expect(mine).toEqual([ids.a, ids.c]);
    expect(shown.items.every((l) => l.state === 'open')).toBe(true);
    expect(shown.counts).toEqual(
      expect.arrayContaining([
        { stageId: stageId(1, 1), count: 1 },
        { stageId: stageId(1, 2), count: 1 },
      ]),
    );
    const card = shown.items.find((l) => l.id === ids.a);
    expect(card).toMatchObject({
      entityId: ENTITY,
      stageId: stageId(1, 2),
      customerName: `Board a ${tag}`,
      village: `Board village ${tag}`,
      ownerId: caller.id,
      ownerName: 'test tele_caller_cc',
      sla: null,
    });
    // Only what a card shows: never a phone number, a price or a cost.
    expect(Object.keys(card ?? {}).sort()).toEqual([
      'customerName',
      'entityId',
      'id',
      'ownerId',
      'ownerName',
      'sla',
      'stageId',
      'state',
      'stateChangedAt',
      'updatedAt',
      'village',
    ]);
  });

  it('orders the cards of a stage by their latest change', async () => {
    const d = await newLead(caller, `Board d ${tag}`);
    const shown = await board(caller);
    const firstStage = shown.items.filter((l) => l.stageId === stageId(1, 1)).map((l) => l.id);
    expect(firstStage).toEqual([d, ids.c]);
    const times = shown.items.map((l) => Date.parse(l.updatedAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('shows closed leads only when asked, at the stage they closed in', async () => {
    const lost = await board(caller, { states: ['lost'] });
    expect(lost.items.map((l) => l.id)).toEqual([ids.b]);
    expect(lost.items[0]).toMatchObject({ state: 'lost', stageId: stageId(1, 6) });
    const both = await board(caller, { states: ['open', 'lost'] });
    expect(both.items.map((l) => l.id)).toEqual(expect.arrayContaining([ids.a, ids.b, ids.c]));
  });

  it('shows a team lead the team, and a General Manager the company', async () => {
    const forLead = (await board(teamLead)).items.map((l) => l.id);
    expect(forLead).toEqual(expect.arrayContaining([ids.a, ids.c, ids.teammate]));
    const forGm = (await board(gm, { entityId: ENTITY })).items.map((l) => l.id);
    expect(forGm).toEqual(expect.arrayContaining([ids.a, ids.c, ids.teammate]));
  });
});

describe('listLeadAssignees', () => {
  let converter: string;
  let otherConverter: string;
  let hrPerson: string;

  beforeAll(async () => {
    converter = (
      await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_lc', teamId: team }], {
        name: `${first} board converter ${tag}`,
      })
    ).id;
    otherConverter = (
      await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_lc', teamId: otherTeam }], {
        name: `${first} board other converter ${tag}`,
      })
    ).id;
    hrPerson = (
      await createTestUser([{ entityId: ENTITY, roleKey: 'hr_admin', teamId: team }], {
        name: `${first} board hr ${tag}`,
      })
    ).id;
  });

  const assignees = (who: Principal, entityId = ENTITY) =>
    asPrincipal(who, (ctx) => listLeadAssignees(ctx, { entityId }));

  it('is refused without crm.lead.assign, and for a company outside the request', async () => {
    await expect(assignees(caller)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(assignees(gm, 2)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('offers a team lead the people of their team who work on leads', async () => {
    const people = await assignees(teamLead);
    const found = people.map((p) => p.id);
    expect(found).toContain(converter);
    expect(found).not.toContain(otherConverter);
    expect(found).not.toContain(hrPerson);
    expect(people.find((p) => p.id === converter)).toEqual({
      id: converter,
      name: `${first} board converter ${tag}`,
      teamId: team,
    });
  });

  it('offers a General Manager everyone in the company who works on leads, by name', async () => {
    const people = await assignees(gm);
    const found = people.map((p) => p.id);
    expect(found).toEqual(expect.arrayContaining([converter, otherConverter]));
    expect(found).not.toContain(hrPerson);
    expect(found.indexOf(converter)).toBeLessThan(found.indexOf(otherConverter));
  });
});
