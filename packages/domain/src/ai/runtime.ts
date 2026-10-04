import {
  AGENT_MATRIX,
  AGENT_PRINCIPAL_IDS,
  DomainError,
  newId,
  type AgentProposal,
  type AgentRoleKey,
  type AgentRunDto,
  type AgentRunEnding,
  type Principal,
} from '@shakti/contracts';
import { executeCommand, executeQuery } from '../command/execute';
import { recordAgentRun } from '../commands/agents/record-run';
import { jsonLogger, type Logger } from '../ports/logger';
import { loadAgentConfig } from './config';
import type { AiProvider, CompleteCall, CompleteResult } from './provider';

// The agent runtime's own path (docs/design/phase1.md §7.1, ARCHITECTURE §11): what an agent's
// worker calls for one step of work. It reads the agent's settings as the agent, lets the agent's
// code ask the model through the provider wrapper bound to this run, and records the run with what
// it proposes; `agents.run.record` then files the suggestion or, when the settings say Automatic,
// acts. The agent's own code decides only what to propose: it never writes.

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

/** The model as one run sees it: its agent, purpose, company and spend cap are filled in. */
export interface RunModel {
  complete(
    call: Omit<CompleteCall, 'agent' | 'purpose' | 'entityId' | 'cap'>,
  ): Promise<CompleteResult>;
}

export interface AgentStep {
  agent: AgentRoleKey;
  entityId: number;
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

/** Runs one step of an agent's work and records it (`agents.run.record`). */
export async function runAgentStep(step: AgentStep, deps: AgentStepDeps): Promise<AgentRunDto> {
  const logger = deps.logger ?? jsonLogger();
  const now = deps.now ?? (() => new Date());
  const principal = agentPrincipal(step.agent, step.entityId);
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
  else if (config.cap === null || config.cap.paise === 0) ended = 'cap_reached';
  else {
    const cap = config.cap;
    const runModel: RunModel = {
      async complete(call) {
        const result = await deps.provider.complete({
          ...call,
          agent: step.agent,
          purpose: step.purpose,
          entityId: step.entityId,
          cap,
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
  if (proposal === null) {
    return executeCommand(principal, scope, recordAgentRun, { ...base, ended });
  }
  try {
    return await executeCommand(principal, scope, recordAgentRun, { ...base, ended, proposal });
  } catch (error) {
    // The proposal was refused, or acting on it failed: the run is still kept, as failed.
    logger.log('warn', 'agent.action_refused', { agent: step.agent, requestId, error });
    return executeCommand(principal, { ...scope, requestId: newId() }, recordAgentRun, {
      ...base,
      ended: 'failed',
    });
  }
}
