import { newId, type Principal, type ShadowReportDto } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiProvider } from '../../src/ai/provider';
import { agentPrincipal } from '../../src/ai/runtime';
import { fakeModelTransport, fakeReply } from '../../src/ai/transport';
import { runTriage } from '../../src/ai/triage/run-triage';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { loseOpportunity } from '../../src/commands/crm/lose-opportunity';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import { loadShadowReport } from '../../src/queries/agents/shadow-report';
import { readAgentSpend } from '../../src/queries/agents/spend';

// The shadow report and the AI spend per agent (A1) on Postgres, company 4: the Triage agent
// records its proposals for two leads in Shadow; people then lose one; the report sets each
// proposal beside what became of its lead. Other suites' runs of the same day may be in the
// period too, so the tests look for their own rows.

const ENTITY = 4;
const madeConfigs: string[] = [];
let caller: Principal;
let executive: Principal;
let gm: Principal;
let kept: string;
let lost: string;

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from agent_configs where id = any(${madeConfigs})`;
  });
  await closeDb();
});

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function newLead(): Promise<string> {
  const made = (await asPrincipal(caller, (context) =>
    runCommand(
      createLead,
      { context, audit, outbox },
      {
        entityId: ENTITY,
        pipelineKey: 'farmer_pumps',
        contact: {
          name: 'Report customer',
          phone: `92${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        },
        account: { type: 'farm' },
      },
    ),
  )) as unknown as { id: string };
  return made.id;
}

const report = (who: Principal, input: Record<string, unknown>, entityIds = [ENTITY]) =>
  asPrincipal({ ...who, entityIds }, (context) =>
    loadShadowReport(context, { entityId: ENTITY, from: today, to: today, limit: 100, ...input }),
  );

async function allItems(who: Principal): Promise<ShadowReportDto['items']> {
  const items: ShadowReportDto['items'] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await report(who, cursor === undefined ? { limit: 7 } : { limit: 7, cursor });
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    cursor = page.nextCursor;
  }
}

beforeAll(async () => {
  const user = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc' }]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id });
  executive = await createTestPrincipal('executive', [1, 2, 3, 4]);
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  const cap = newId();
  madeConfigs.push(cap);
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:triage' and action_type is null and entity_id = ${ENTITY}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, daily_spend_cap_paise, created_by)
             values (${cap}, 'agent:triage', null, ${ENTITY}, 100000, ${executive.id})`;
  });
  kept = await newLead();
  lost = await newLead();
  const answer = JSON.stringify({
    pipeline: { key: 'farmer_pumps' },
    score: { change: 6, note: 'Pump enquiry from a farm.' },
    assignee: { person: 'P1' },
  });
  for (const lead of [kept, lost]) {
    const provider = createAiProvider({
      claude: fakeModelTransport([fakeReply(answer)]),
      voyage: undefined,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    });
    await runTriage(
      { eventId: newId(), entityId: ENTITY, opportunityId: lead, existingCustomer: false },
      { provider, logger: memoryLogger() },
    );
  }
  // A filtered run, for the summary's refused count.
  const provider = createAiProvider({
    claude: fakeModelTransport([fakeReply(JSON.stringify({ assignee: { person: 'P999' } }))]),
    voyage: undefined,
    keyValue: memoryKeyValue(),
    logger: memoryLogger(),
  });
  await runTriage(
    { eventId: newId(), entityId: ENTITY, opportunityId: await newLead(), existingCustomer: false },
    { provider, logger: memoryLogger() },
  );
  await asPrincipal(caller, (context) =>
    runCommand(
      loseOpportunity,
      { context, audit, outbox },
      { entityId: ENTITY, opportunityId: lost, reasonCode: 'price_too_high' },
    ),
  );
});

describe('shadowReport', () => {
  it('sets each proposal beside what became of its lead', async () => {
    const items = await allItems(executive);
    const of = (lead: string, kind: string) =>
      items.find((i) => i.opportunityId === lead && i.kind === kind);

    expect(of(kept, 'pipeline')).toMatchObject({
      proposedPipelineKey: 'farmer_pumps',
      pipelineKey: 'farmer_pumps',
      agreement: 'agree',
      customerName: 'Report customer',
    });
    expect(of(kept, 'score')).toMatchObject({
      proposedScoreChange: 6,
      note: 'Pump enquiry from a farm.',
      leadState: 'open',
      reachedQualified: false,
      agreement: 'pending',
    });
    // A raise for a lead people lost: they did not bear it out.
    expect(of(lost, 'score')).toMatchObject({ leadState: 'lost', agreement: 'disagree' });
    const assignee = of(kept, 'assignee');
    expect(assignee?.proposedOwnerId).not.toBeNull();
    expect(assignee?.agreement).toBe(
      assignee?.ownerId === assignee?.proposedOwnerId ? 'agree' : 'disagree',
    );
    expect(of(kept, 'duplicate')).toBeUndefined();
    // Newest first, each once.
    const times = items.map((i) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(new Set(items.map((i) => i.actionId)).size).toBe(items.length);
  });

  it('counts agreement and the refused runs kind by kind', async () => {
    const { summary } = await report(executive, {});
    const score = summary.find((s) => s.kind === 'score');
    expect(score?.disagreed).toBeGreaterThanOrEqual(1);
    expect(score?.pending).toBeGreaterThanOrEqual(1);
    const assignee = summary.find((s) => s.kind === 'assignee');
    expect(assignee?.filtered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'unknown_person' }) as unknown,
      ]) as unknown,
    );
    expect(summary.map((s) => s.kind)).toEqual(['pipeline', 'score', 'duplicate', 'assignee']);
  });

  it('is read by an Executive and a General Manager, in a request for the company only', async () => {
    expect((await report(gm, {})).items.length).toBeGreaterThan(0);
    await expect(report(executive, {}, [1])).rejects.toMatchObject({ code: 'forbidden' });
    await expect(report(principalFor('general_manager', [1]), {}, [1])).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('is refused to a person without the agent controls and to an agent', async () => {
    await expect(report(caller, {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(report(agentPrincipal('agent:triage', ENTITY), {})).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('checks the period and the cursor', async () => {
    await expect(report(executive, { from: '2026-10-10', to: '2026-10-01' })).rejects.toMatchObject(
      { code: 'validation_failed' },
    );
    await expect(report(executive, { from: '2026-01-01', to: '2026-10-01' })).rejects.toMatchObject(
      { code: 'validation_failed' },
    );
    await expect(report(executive, { cursor: 'bad' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('readAgentSpend', () => {
  it('gives the Triage agent’s spend and runs in the company beside its limit', async () => {
    const spend = await asPrincipal(executive, (context) => readAgentSpend(context));
    const triage = spend.byAgent.find((s) => s.agent === 'triage' && s.entityId === ENTITY);
    expect(triage).toMatchObject({ dailyCap: '1000.00' });
    expect(triage?.runsToday).toBeGreaterThanOrEqual(12);
    expect(Number(triage?.today)).toBeGreaterThan(0);
    expect(Number(spend.today)).toBeGreaterThanOrEqual(Number(triage?.today));
  });

  it('shows nothing of the runs to a person without the agent controls', async () => {
    const spend = await asPrincipal(caller, (context) => readAgentSpend(context));
    expect(spend.byAgent.filter((s) => s.runsToday > 0)).toEqual([]);
  });
});
