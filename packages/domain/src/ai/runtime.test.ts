import { DomainError, newId, type AgentProposal } from '@shakti/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, executeQuery } from '../command/execute';
import { memoryKeyValue } from '../ports/key-value';
import { memoryLogger } from '../ports/logger';
import type { ResolvedAgentConfig } from './config';
import { createAiProvider } from './provider';
import { runAgentStep, type AgentStep } from './runtime';
import { fakeModelTransport, fakeReply } from './transport';

// What the runtime does when recording a proposal fails (runtime.ts): a refusal of the proposal is
// kept as a failed run, and anything else fails the delivery so it is retried. The database is
// stood in for; the security suite's `agent-runtime.test.ts` runs the same path on Postgres.

vi.mock('../command/execute', () => ({ executeCommand: vi.fn(), executeQuery: vi.fn() }));

const config: ResolvedAgentConfig = {
  enabled: true,
  autonomy: 'needs_approval',
  autonomySource: 'action_company',
  caps: [{ paise: 100_000, entityId: null }],
};

const proposal: AgentProposal = {
  input: { entityId: 1, opportunityId: newId(), kind: 'follow_up', dueAt: '2026-10-06T04:30:00Z' },
  subjectType: 'opportunity',
  subjectId: newId(),
};

const step: AgentStep = {
  agent: 'agent:copilot',
  entityId: 1,
  eventId: newId(),
  purpose: 'follow_up',
  actionType: 'crm.task.create',
  async decide(model) {
    await model.complete({ system: 'Decide.', question: 'When?', maxTokens: 5 });
    return proposal;
  },
};

const deps = () => ({
  provider: createAiProvider({
    claude: fakeModelTransport([fakeReply('1')]),
    voyage: undefined,
    keyValue: memoryKeyValue(),
    logger: memoryLogger(),
    sleep: () => Promise.resolve(),
  }),
  logger: memoryLogger(),
});

const recorded = { runId: newId(), outcome: 'failed', actionId: null, inboxItemId: null };

beforeEach(() => {
  vi.mocked(executeQuery).mockReset();
  vi.mocked(executeCommand).mockReset();
  // No run recorded under the step's key yet; the settings allow a call.
  vi.mocked(executeQuery).mockImplementation((_principal, _scope, _fn, options) =>
    Promise.resolve(options?.name === 'agents.config.resolve' ? config : undefined),
  );
});

describe('runAgentStep when recording the proposal fails', () => {
  it.each([
    ['validation_failed', new DomainError('validation_failed', 'bad input')],
    ['forbidden', new DomainError('forbidden', 'not the agent’s')],
    ['not_found', new DomainError('not_found', 'no such lead')],
  ])('keeps a refusal (%s) as a failed run', async (_, refusal) => {
    vi.mocked(executeCommand).mockRejectedValueOnce(refusal).mockResolvedValueOnce(recorded);
    await expect(runAgentStep(step, deps())).resolves.toEqual(recorded);
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(vi.mocked(executeCommand).mock.calls[1]?.[3]).toMatchObject({ ended: 'failed' });
  });

  it.each([
    ['a conflict', new DomainError('conflict', 'hit database error 40001')],
    ['an internal error', new DomainError('internal', 'hit database error 57P01')],
    ['a lost connection', new Error('connection terminated')],
  ])('fails the delivery on %s, so it is retried', async (_, failure) => {
    vi.mocked(executeCommand).mockRejectedValueOnce(failure);
    await expect(runAgentStep(step, deps())).rejects.toBe(failure);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });
});
