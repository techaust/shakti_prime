import { AGENT_PRINCIPAL_IDS, newId, type AgentProposal, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiProvider } from '../../src/ai/provider';
import { runAgentStep, type AgentStep, type RunModel } from '../../src/ai/runtime';
import {
  fakeModelTransport,
  fakeReply,
  ModelCallError,
  type FakeModelTransport,
  type FakeStep,
} from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';

// The runtime's own path (docs/design/phase1.md §7.1) with a stand-in agent defined here only: it
// asks the model, through the fake transport, how many days until a follow-up, and proposes a
// follow-up task on the lead for its owner. No real agent ships in AI0 and nothing reaches a
// vendor. The tests use company 4; each writes its own settings, replacing any row a run left with
// the same key, and removes them.

const ENTITY = 4;
const madeConfigs: string[] = [];
afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from agent_configs where id = any(${madeConfigs})`;
  });
  await closeDb();
});

async function setting(row: {
  actionType?: string | null;
  autonomy?: string | null;
  cap?: number | null;
  enabled?: boolean;
}): Promise<string> {
  const id = newId();
  madeConfigs.push(id);
  await asMigrator(async (m) => {
    // A row another suite or run left for the same agent, action type and company (the journeys'
    // seed keeps the Caller Co-pilot's) gives way to this test's own.
    await m`delete from agent_configs where agent is not distinct from 'agent:copilot'
                     and action_type is not distinct from ${row.actionType ?? null} and entity_id is not distinct from ${ENTITY}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, 'agent:copilot', ${row.actionType ?? null}, ${ENTITY}, ${row.autonomy ?? null},
                     ${row.cap ?? null}, ${row.enabled ?? true}, ${owner.id})`;
  });
  return id;
}

const drop = (id: string) => asMigrator((m) => m`delete from agent_configs where id = ${id}`);

let owner: Principal;
let lead: string;
let otherCompanyLead: string;

async function leadIn(principal: Principal, entityId: number): Promise<string> {
  const made = (await asPrincipal(principal, (context) =>
    runCommand(
      createLead,
      { context, audit, outbox },
      {
        entityId,
        pipelineKey: 'farmer_pumps',
        contact: {
          name: 'Runtime customer',
          phone: `94${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        },
        account: { type: 'farm' },
      },
    ),
  )) as { id: string };
  return made.id;
}

beforeAll(async () => {
  owner = await createTestPrincipal('general_manager', [ENTITY]);
  lead = await leadIn(owner, ENTITY);
  otherCompanyLead = await leadIn(await createTestPrincipal('general_manager', [1]), 1);
});

/**
 * The stand-in agent: one model call, then a follow-up on the lead in the days it answered, for
 * the person `assigneeId` names (the lead's owner by default; null for nobody).
 */
function standIn(
  opportunityId: string,
  options: { eventId?: string; assigneeId?: string | null } = {},
): AgentStep {
  const assigneeId = options.assigneeId === undefined ? owner.id : options.assigneeId;
  return {
    agent: 'agent:copilot',
    entityId: ENTITY,
    eventId: options.eventId ?? newId(),
    purpose: 'follow_up',
    actionType: 'crm.task.create',
    async decide(model: RunModel): Promise<AgentProposal | null> {
      const answer = await model.complete({
        system: 'You decide when a farmer should be called again.',
        untrusted: [{ source: 'call_notes', text: 'Farmer said call me on 98765 43210 next week' }],
        question: 'Answer with the number of days until the next call, or 0 for none.',
        maxTokens: 10,
      });
      const days = Number.parseInt(answer.text, 10);
      if (!Number.isFinite(days) || days <= 0) return null;
      return {
        input: {
          entityId: ENTITY,
          opportunityId,
          kind: 'follow_up',
          dueAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        },
        subjectType: 'opportunity',
        subjectId: opportunityId,
        ...(assigneeId === null ? {} : { assigneeId }),
      };
    },
  };
}

function provider(script: readonly FakeStep[], available = true) {
  const transport: FakeModelTransport = fakeModelTransport(script);
  return {
    transport,
    deps: {
      provider: createAiProvider({
        claude: available ? transport : undefined,
        voyage: undefined,
        keyValue: memoryKeyValue(),
        logger: memoryLogger(),
        sleep: () => Promise.resolve(),
        timeoutMs: 20,
      }),
      logger: memoryLogger(),
    },
  };
}

async function runRow(runId: string) {
  const [row] = await asMigrator(
    (m) => m<{ outcome: string; cost_paise: string; tokens_in: number; model: string | null }[]>`
      select outcome, cost_paise, tokens_in, model from agent_runs where id = ${runId}`,
  );
  return row;
}

describe('runAgentStep with a stand-in agent', () => {
  it('makes no call with no spend cap set, and records the run as capped', async () => {
    const { transport, deps } = provider([fakeReply('2')]);
    const answer = await runAgentStep(standIn(lead), deps);
    expect(answer).toMatchObject({ outcome: 'cap_reached', inboxItemId: null });
    expect(transport.requests).toEqual([]);
  });

  it('proposes through the inbox, with the masked model call and its cost recorded', async () => {
    const cap = await setting({ cap: 100_000 });
    try {
      const { transport, deps } = provider([fakeReply('2', { inputTokens: 2_000 })]);
      const answer = await runAgentStep(standIn(lead), deps);
      expect(answer).toMatchObject({ outcome: 'proposed' });
      expect(answer.inboxItemId).not.toBeNull();
      expect(transport.requests[0]?.user).not.toContain('98765');
      expect(transport.requests[0]?.user).toContain('call me on [phone] next week');
      // 2,000 input and 20 output tokens of Haiku 4.5 at ₹104 a dollar: 21.84 paise, rounded up.
      expect(await runRow(answer.runId)).toMatchObject({
        outcome: 'proposed',
        cost_paise: '22',
        model: 'claude-haiku-4-5-20251001',
      });
      const [item] = await asMigrator(
        (m) => m<{ assignee_id: string; input: { assigneeId: string } }[]>`
          select i.assignee_id, a.input_json as input from inbox_items i
            join agent_actions a on a.id = i.agent_action_id where i.id = ${answer.inboxItemId}`,
      );
      expect(item).toEqual({
        assignee_id: owner.id,
        input: expect.objectContaining({ assigneeId: owner.id }) as unknown,
      });
    } finally {
      await drop(cap);
    }
  });

  it('answers a redelivered event from the run it recorded, with no second model call', async () => {
    const cap = await setting({ cap: 100_000 });
    try {
      const { transport, deps } = provider([fakeReply('2')]);
      const eventId = newId();
      const first = await runAgentStep(standIn(lead, { eventId }), deps);
      const again = await runAgentStep(standIn(lead, { eventId }), deps);
      expect(again).toEqual(first);
      expect(transport.requests).toHaveLength(1);
      const [count] = await asMigrator(
        (m) => m<{ n: number }[]>`
          select count(*)::int as n from inbox_items where agent_action_id = ${first.actionId}`,
      );
      expect(count?.n).toBe(1);
      // Another event is another step.
      const next = await runAgentStep(standIn(lead), deps);
      expect(next.runId).not.toBe(first.runId);
    } finally {
      await drop(cap);
    }
  });

  it('records nothing to do when the agent proposes nothing', async () => {
    const cap = await setting({ cap: 100_000 });
    try {
      const { deps } = provider([fakeReply('0')]);
      expect(await runAgentStep(standIn(lead), deps)).toMatchObject({
        outcome: 'nothing_to_do',
        actionId: null,
      });
    } finally {
      await drop(cap);
    }
  });

  it('stops at the daily cap', async () => {
    const cap = await setting({ cap: 100 });
    try {
      const { transport, deps } = provider([fakeReply('2', { inputTokens: 200_000 })]);
      expect((await runAgentStep(standIn(lead), deps)).outcome).toBe('proposed');
      expect((await runAgentStep(standIn(lead), deps)).outcome).toBe('cap_reached');
      expect(transport.requests).toHaveLength(1);
    } finally {
      await drop(cap);
    }
  });

  it('records the model as unavailable without a key, or when it keeps failing', async () => {
    const cap = await setting({ cap: 100_000 });
    try {
      const none = provider([fakeReply('2')], false);
      expect((await runAgentStep(standIn(lead), none.deps)).outcome).toBe('unavailable');
      const failing = provider([new ModelCallError('http', { status: 503 })]);
      expect((await runAgentStep(standIn(lead), failing.deps)).outcome).toBe('unavailable');
      expect(failing.transport.requests).toHaveLength(3);
    } finally {
      await drop(cap);
    }
  });

  it('makes no call while a kill switch is off', async () => {
    const cap = await setting({ cap: 100_000, enabled: false });
    try {
      const { transport, deps } = provider([fakeReply('2')]);
      expect((await runAgentStep(standIn(lead), deps)).outcome).toBe('switched_off');
      expect(transport.requests).toEqual([]);
    } finally {
      await drop(cap);
    }
  });

  it('files a stored Automatic as Needs approval in Phase 1, and never acts', async () => {
    const cap = await setting({ cap: 100_000 });
    const automatic = await setting({ actionType: 'crm.task.create', autonomy: 'automatic' });
    try {
      const { deps } = provider([fakeReply('3')]);
      const answer = await runAgentStep(standIn(lead), deps);
      expect(answer).toMatchObject({ outcome: 'proposed' });
      expect(answer.inboxItemId).not.toBeNull();
      const [action] = await asMigrator(
        (m) => m<{ autonomy: string; state: string }[]>`
          select autonomy, state from agent_actions where id = ${answer.actionId}`,
      );
      expect(action).toEqual({ autonomy: 'needs_approval', state: 'proposed' });
    } finally {
      await drop(automatic);
      await drop(cap);
    }
  });

  it('keeps a refused proposal as a failed run: an unreadable lead, no one or an agent to do it', async () => {
    const cap = await setting({ cap: 100_000 });
    try {
      const { deps } = provider([fakeReply('3')]);
      for (const step of [
        // A lead the agent cannot see, and one of another company.
        standIn(newId()),
        standIn(otherCompanyLead),
        // A task for no one, and one for an agent.
        standIn(lead, { assigneeId: null }),
        standIn(lead, { assigneeId: AGENT_PRINCIPAL_IDS['agent:copilot'] }),
      ]) {
        expect(await runAgentStep(step, deps)).toMatchObject({
          outcome: 'failed',
          actionId: null,
          inboxItemId: null,
        });
      }
    } finally {
      await drop(cap);
    }
  });
});
