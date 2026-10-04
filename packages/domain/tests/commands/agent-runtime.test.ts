import { newId, type AgentProposal, type Principal } from '@shakti/contracts';
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
// follow-up task on the lead. No real agent ships in AI0 and nothing reaches a vendor. The tests use
// company 4 and remove their settings.

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
  await asMigrator(
    (
      m,
    ) => m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, 'agent:copilot', ${row.actionType ?? null}, ${ENTITY}, ${row.autonomy ?? null},
                     ${row.cap ?? null}, ${row.enabled ?? true}, ${owner.id})`,
  );
  return id;
}

const drop = (id: string) => asMigrator((m) => m`delete from agent_configs where id = ${id}`);

let owner: Principal;
let lead: string;

beforeAll(async () => {
  owner = await createTestPrincipal('general_manager', [ENTITY]);
  const made = (await asPrincipal(owner, (context) =>
    runCommand(
      createLead,
      { context, audit, outbox },
      {
        entityId: ENTITY,
        pipelineKey: 'farmer_pumps',
        contact: {
          name: 'Runtime customer',
          phone: `94${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        },
        account: { type: 'farm' },
      },
    ),
  )) as { id: string };
  lead = made.id;
});

/** The stand-in agent: one model call, then a follow-up on the lead in the days it answered. */
function standIn(opportunityId: string): AgentStep {
  return {
    agent: 'agent:copilot',
    entityId: ENTITY,
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
      expect(await runRow(answer.runId)).toMatchObject({
        outcome: 'proposed',
        cost_paise: '19',
        model: 'claude-haiku-4-5-20251001',
      });
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
    const cap = await setting({ cap: 1 });
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

  it('acts when Automatic, and records a refused action as a failed run', async () => {
    const cap = await setting({ cap: 100_000 });
    const automatic = await setting({ actionType: 'crm.task.create', autonomy: 'automatic' });
    try {
      const { deps } = provider([fakeReply('3')]);
      const acted = await runAgentStep(standIn(lead), deps);
      expect(acted).toMatchObject({ outcome: 'acted', inboxItemId: null });
      // A lead the agent cannot see: the task is refused, and the run is kept as failed.
      const missing = await runAgentStep(standIn(newId()), deps);
      expect(missing).toMatchObject({ outcome: 'failed', actionId: null });
    } finally {
      await drop(automatic);
      await drop(cap);
    }
  });
});
