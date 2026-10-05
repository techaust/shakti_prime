import {
  AGENT_MATRIX,
  AGENT_PRINCIPAL_IDS,
  AgentRunDto,
  DomainError,
  newId,
  type AgentProposal,
  type AgentRoleKey,
  type AgentRunEnding,
  type Principal,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { executeCommand, executeQuery } from '../command/execute';
import { recordAgentRun } from '../commands/agents/record-run';
import { jsonLogger, type Logger } from '../ports/logger';
import { loadAgentConfig } from './config';
import type { AiProvider, CompleteCall, CompleteResult } from './provider';

// The agent runtime's own path (docs/design/phase1.md §7.1, ARCHITECTURE §11): what an agent's
// worker calls for one step of work. It reads the agent's settings as the agent, lets the agent's
// code ask the model through the provider wrapper bound to this run, and records the run with what
// it proposes; `agents.run.record` then files the suggestion. The agent's own code decides only
// what to propose: it never writes. A step is keyed by the event that started it, its agent and
// its action type, so a redelivered event is answered from the run already recorded, before any
// model call.

/** The seeded service principal of an agent, scoped to the one company it works for. */
export function agentPrincipal(agent: AgentRoleKey, entityId: number): Principal {
  return {
    id: AGENT_PRINCIPAL_IDS[agent],
    kind: 'agent',
    roleKey: agent,
    entityIds: [entityId],
    permissions: [...AGENT_MATRIX[agent]],
  };
}

/** The model as one run sees it: its agent, purpose, company and spend caps are filled in. */
export interface RunModel {
  complete(
    call: Omit<CompleteCall, 'agent' | 'purpose' | 'entityId' | 'caps'>,
  ): Promise<CompleteResult>;
}

export interface AgentStep {
  agent: AgentRoleKey;
  entityId: number;
  /** The outbox event that started the step: one step per event, agent and action type. */
  eventId: string;
  /** What the run is for, as a code (`lead_triage`). */
  purpose: string;
  /** The action type the run may propose or take (`AGENT_ACTION_TYPES`). */
  actionType: string;
  /** The agent's own work: the action it proposes, or null for nothing to do. */
  decide: (model: RunModel) => Promise<AgentProposal | null>;
}

export interface AgentStepDeps {
  provider: AiProvider;
  logger?: Logger;
  now?: () => Date;
}

/** The idempotency key of one step: its event, agent and action type, as 64 hex characters. */
export function agentStepKey(eventId: string, agent: AgentRoleKey, actionType: string): string {
  return createHash('sha256').update(`${eventId}\n${agent}\n${actionType}`).digest('hex');
}

/** How the model work ended, from the error it stopped with. */
function endingOf(error: unknown): AgentRunEnding {
  if (error instanceof DomainError) {
    if (error.code === 'rate_limited' && error.details?.reason === 'agent_spend_cap_reached') {
      return 'cap_reached';
    }
    if (error.code === 'integration_unavailable') return 'unavailable';
  }
  return 'failed';
}

/** The run an earlier delivery of the same step recorded under `key`, if any. */
function recordedRun(principal: Principal, entityId: number, key: string) {
  return executeQuery(
    principal,
    { entityIds: [entityId] },
    async ({ tx }) => {
      const k = schema.idempotencyKeys;
      const [row] = await tx
        .select({ command: k.command, response: k.responseJson })
        .from(k)
        .where(and(eq(k.principalId, principal.id), eq(k.key, key)))
        .limit(1);
      if (row?.command !== recordAgentRun.name) return undefined;
      const answer = AgentRunDto.safeParse(row.response);
      return answer.success ? answer.data : undefined;
    },
    // The keys are the caller's own and only `app_user` reads them (0037).
    { name: 'agents.run.recorded', pool: 'app_user' },
  );
}

/** The refusals a proposal can meet: kept as a failed run, never retried. */
const REFUSALS: ReadonlySet<string> = new Set(['validation_failed', 'forbidden', 'not_found']);
const refusal = (error: unknown): boolean =>
  error instanceof DomainError && REFUSALS.has(error.code);

/** Whether an error is a repeat of a key another delivery used with other numbers. */
const usedKey = (error: unknown): boolean =>
  error instanceof DomainError && error.details?.reason === 'idempotency_mismatch';

/** Runs one step of an agent's work and records it (`agents.run.record`). */
export async function runAgentStep(step: AgentStep, deps: AgentStepDeps): Promise<AgentRunDto> {
  const logger = deps.logger ?? jsonLogger();
  const now = deps.now ?? (() => new Date());
  const principal = agentPrincipal(step.agent, step.entityId);
  const key = agentStepKey(step.eventId, step.agent, step.actionType);
  const earlier = await recordedRun(principal, step.entityId, key);
  if (earlier !== undefined) return earlier;

  const requestId = newId();
  const scope = { entityIds: [step.entityId], requestId };
  const started = now().getTime();

  const config = await executeQuery(
    principal,
    scope,
    ({ tx }) => loadAgentConfig(tx, step.agent, step.actionType, step.entityId),
    { name: 'agents.config.resolve' },
  );

  let model: string | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let costPaise = 0;
  let ended: AgentRunEnding = 'completed';
  let proposal: AgentProposal | null = null;

  if (!config.enabled) ended = 'switched_off';
  else if (config.caps.length === 0 || config.caps.some((c) => c.paise === 0)) {
    ended = 'cap_reached';
  } else {
    const caps = config.caps;
    const runModel: RunModel = {
      async complete(call) {
        const result = await deps.provider.complete({
          ...call,
          agent: step.agent,
          purpose: step.purpose,
          entityId: step.entityId,
          caps,
        });
        model = result.model;
        tokensIn +=
          result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens;
        tokensOut += result.usage.outputTokens;
        costPaise += result.costPaise;
        return result;
      },
    };
    try {
      proposal = await step.decide(runModel);
    } catch (error) {
      ended = endingOf(error);
      if (ended === 'failed') {
        logger.log('error', 'agent.step_failed', { agent: step.agent, requestId, error });
      }
    }
  }

  const base = {
    entityId: step.entityId,
    agent: step.agent,
    purpose: step.purpose,
    actionType: step.actionType,
    model,
    tokensIn,
    tokensOut,
    costPaise,
    durationMs: Math.max(0, now().getTime() - started),
  };
  const record = async (input: object, requestScope: typeof scope): Promise<AgentRunDto> => {
    try {
      return await executeCommand(principal, requestScope, recordAgentRun, input, {
        idempotencyKey: key,
      });
    } catch (error) {
      // Another delivery of this step recorded its run while this one asked the model.
      if (usedKey(error)) {
        const recorded = await recordedRun(principal, step.entityId, key);
        if (recorded !== undefined) return recorded;
      }
      throw error;
    }
  };
  if (proposal === null) return record({ ...base, ended }, scope);
  try {
    return await record({ ...base, ended, proposal }, scope);
  } catch (error) {
    // Anything but a refusal (the database, a lost connection) fails the delivery, which is
    // retried: nothing was written, so the retry finds no run recorded under the step's key.
    if (!refusal(error)) throw error;
    // The proposal was refused, or acting on it was: the run is still kept, as failed.
    logger.log('warn', 'agent.action_refused', { agent: step.agent, requestId, error });
    return record({ ...base, ended: 'failed' }, { ...scope, requestId: newId() });
  }
}
