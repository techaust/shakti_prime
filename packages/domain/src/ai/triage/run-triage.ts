import {
  TRIAGE_ACTION_TYPES,
  TRIAGE_PROPOSAL_KINDS,
  type AgentRunDto,
  type TriageProposalKind,
} from '@shakti/contracts';
import { createHash } from 'node:crypto';
import { executeQuery } from '../../command/execute';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { loadAgentConfig } from '../config';
import type { KeyValue } from '../../ports/key-value';
import { agentPrincipal, runAgentStep, type AgentStepDeps, type RunModel } from '../runtime';
import { filterTriageAnswer, type TriageVerdicts } from './filter';
import { buildTriagePrompt, type TriagePrompt } from './prompt';
import { readTriageFacts } from './read-facts';

// The Triage agent (docs/03-roadmap-appendix/phase1.md §9, A1; BLUEPRINT §9.3 "Intake & Triage"):
// one run per new lead, started by `crm.lead.created`. It reads the lead as itself, asks the model
// once, holds the answer to the output filter, and records each kind of proposal as one step of
// the agent runtime (`runAgentStep()`), keyed by the event and the kind's action type, so a
// redelivered event records nothing twice. Every step records through `agents.run.record`, which
// decides by the settings: in Shadow (where the agent starts) a proposal is recorded shadowed and
// nothing acts; the agent never writes anything itself.

export const TRIAGE_PURPOSE = 'lead_triage';

/**
 * How long the model's answer for one event is kept for a redelivery (`triage:answer:{eventId}`):
 * the shortest time over which the outbox still redelivers an event (its last attempt comes three
 * and a quarter to four and a quarter hours after the first, outbox/backoff.ts), so the answer
 * never outlives the deliveries that may need it.
 */
export const TRIAGE_ANSWER_TTL_SECONDS = 3 * 60 * 60;

/** The key of the model's answer for one `crm.lead.created` event. */
export const triageAnswerKey = (eventId: string): string => `triage:answer:${eventId}`;

export interface TriageDeps extends AgentStepDeps {
  /**
   * Where the model's answer is kept under the event id, so a delivery that runs again after a
   * partial run asks the model nothing for the kinds left (the store idempotency keys use).
   */
  keyValue?: KeyValue;
}

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

/**
 * Runs the Triage agent on one new lead and records what it proposes, kind by kind. A kind an
 * earlier delivery recorded is answered from its run; for the kinds left, the answer that delivery
 * kept (`keyValue`) is read before the model is asked, and an answer from the model is kept for
 * the next one. A store that cannot be read or written only costs a model call.
 */
export async function runTriage(lead: TriageLead, deps: TriageDeps): Promise<TriageResult> {
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
  let answer: Promise<string> | undefined;
  let verdicts: TriageVerdicts | undefined;
  // The people and duplicate cards are labelled by position (P1, D1, …), so a kept answer is used
  // only for the same prompt: when the order or a count moved since it was kept, its labels may
  // name someone else, and the model is asked again.
  const promptHash = hashPrompt(prompt);
  const verdictsOf = async (model: RunModel): Promise<TriageVerdicts> => {
    answer ??= keptAnswer(lead.eventId, promptHash, deps).then(
      (kept) =>
        kept ??
        model
          .complete({
            system: prompt.system,
            question: prompt.question,
            untrusted: prompt.untrusted,
            maxTokens: prompt.maxTokens,
            totalTimeoutMs: AGENT_DEFAULTS.triage.totalTimeoutMs,
          })
          .then(async (reply) => {
            await keepAnswer(lead.eventId, { prompt: promptHash, text: reply.text }, deps);
            return reply.text;
          }),
    );
    const text = await answer;
    verdicts ??= filterTriageAnswer(text, facts);
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

/** What is kept for one event: the model's text and the hash of the prompt it answered. */
interface KeptAnswer {
  prompt: string;
  text: string;
}

/** The hash of everything the model is sent; the question carries the positional labels. */
function hashPrompt(prompt: TriagePrompt): string {
  return createHash('sha256')
    .update(JSON.stringify([prompt.system, prompt.question, prompt.untrusted]))
    .digest('hex');
}

/**
 * The answer an earlier delivery of the event kept for the same prompt, or null when none is, the
 * one kept answered another prompt, or the store is away.
 */
async function keptAnswer(
  eventId: string,
  promptHash: string,
  deps: TriageDeps,
): Promise<string | null> {
  if (deps.keyValue === undefined) return null;
  let raw: string | null;
  try {
    raw = await deps.keyValue.get(triageAnswerKey(eventId));
  } catch (error) {
    deps.logger?.log('warn', 'agent.triage_answer_not_read', { eventId, error });
    return null;
  }
  if (raw === null) return null;
  try {
    const kept = JSON.parse(raw) as Partial<KeptAnswer> | null;
    return kept?.prompt === promptHash && typeof kept.text === 'string' ? kept.text : null;
  } catch {
    return null;
  }
}

/** Keeps the model's answer for a redelivery of the event; a store that is away is only logged. */
async function keepAnswer(eventId: string, kept: KeptAnswer, deps: TriageDeps): Promise<void> {
  if (deps.keyValue === undefined) return;
  try {
    await deps.keyValue.set(
      triageAnswerKey(eventId),
      JSON.stringify(kept),
      TRIAGE_ANSWER_TTL_SECONDS,
    );
  } catch (error) {
    deps.logger?.log('warn', 'agent.triage_answer_not_kept', { eventId, error });
  }
}
