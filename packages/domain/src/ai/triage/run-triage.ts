import {
  TRIAGE_ACTION_TYPES,
  TRIAGE_PROPOSAL_KINDS,
  type AgentRunDto,
  type TriageProposalKind,
} from '@shakti/contracts';
import { executeQuery } from '../../command/execute';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { loadAgentConfig } from '../config';
import type { CompleteResult } from '../provider';
import { agentPrincipal, runAgentStep, type AgentStepDeps, type RunModel } from '../runtime';
import { filterTriageAnswer, type TriageVerdicts } from './filter';
import { buildTriagePrompt } from './prompt';
import { readTriageFacts } from './read-facts';

// The Triage agent (docs/03-roadmap-appendix/phase1.md §9, A1; BLUEPRINT §9.3 "Intake & Triage"):
// one run per new lead, started by `crm.lead.created`. It reads the lead as itself, asks the model
// once, holds the answer to the output filter, and records each kind of proposal as one step of
// the agent runtime (`runAgentStep()`), keyed by the event and the kind's action type, so a
// redelivered event records nothing twice. Every step records through `agents.run.record`, which
// decides by the settings: in Shadow (where the agent starts) a proposal is recorded shadowed and
// nothing acts; the agent never writes anything itself.

export const TRIAGE_PURPOSE = 'lead_triage';

export interface TriageLead {
  /** The `crm.lead.created` event: one triage per event. */
  eventId: string;
  entityId: number;
  opportunityId: string;
  /** From the event: whether the lead is for a customer the business already had. */
  existingCustomer: boolean;
}

export interface TriageResult {
  /** Undefined when the lead was no longer open or the agent could not see it: nothing ran. */
  runs: Partial<Record<TriageProposalKind, AgentRunDto>>;
}

/** Runs the Triage agent on one new lead and records what it proposes, kind by kind. */
export async function runTriage(lead: TriageLead, deps: AgentStepDeps): Promise<TriageResult> {
  const now = deps.now ?? (() => new Date());
  const principal = agentPrincipal('agent:triage', lead.entityId);
  // The agent's settings first: switched off or with no spending limit, the agent cannot call the
  // model for any kind, so one stopped run is recorded (the first kind's) and the lead is not read.
  const first: TriageProposalKind = 'pipeline';
  const config = await executeQuery(
    principal,
    { entityIds: [lead.entityId] },
    ({ tx }) => loadAgentConfig(tx, 'agent:triage', TRIAGE_ACTION_TYPES[first], lead.entityId),
    { name: 'agents.triage.settings' },
  );
  if (!config.enabled || config.caps.length === 0 || config.caps.some((c) => c.paise === 0)) {
    const stopped = await runAgentStep(
      {
        agent: 'agent:triage',
        entityId: lead.entityId,
        eventId: lead.eventId,
        purpose: TRIAGE_PURPOSE,
        actionType: TRIAGE_ACTION_TYPES[first],
        // The step records the stop itself and never asks for a decision.
        decide: () => Promise.resolve(null),
      },
      deps,
    );
    return { runs: { [first]: stopped } };
  }
  const facts = await executeQuery(
    principal,
    { entityIds: [lead.entityId] },
    ({ tx }) => readTriageFacts(tx, lead, now()),
    { name: 'agents.triage.facts' },
  );
  if (facts === undefined) return { runs: {} };

  const prompt = buildTriagePrompt(facts);
  // One model call for the four kinds: the first step that may call the model asks, and its run
  // carries the cost; the others read the same answer. A step the settings stop never asks.
  let answer: Promise<CompleteResult> | undefined;
  let verdicts: TriageVerdicts | undefined;
  const verdictsOf = async (model: RunModel): Promise<TriageVerdicts> => {
    answer ??= model.complete({
      system: prompt.system,
      question: prompt.question,
      untrusted: prompt.untrusted,
      maxTokens: prompt.maxTokens,
      totalTimeoutMs: AGENT_DEFAULTS.triage.totalTimeoutMs,
    });
    const reply = await answer;
    verdicts ??= filterTriageAnswer(reply.text, facts);
    return verdicts;
  };

  const runs: TriageResult['runs'] = {};
  for (const kind of TRIAGE_PROPOSAL_KINDS) {
    runs[kind] = await runAgentStep(
      {
        agent: 'agent:triage',
        entityId: lead.entityId,
        eventId: lead.eventId,
        purpose: TRIAGE_PURPOSE,
        actionType: TRIAGE_ACTION_TYPES[kind],
        decide: async (model) => (await verdictsOf(model))[kind],
      },
      deps,
    );
  }
  return { runs };
}
