import {
  CONCIERGE_ACTION_TYPES,
  CONCIERGE_PROPOSAL_KINDS,
  DomainError,
  type AgentRunDto,
  type ConciergeProposalKind,
  type WhatsAppHandoffReason,
} from '@shakti/contracts';
import { createHash } from 'node:crypto';
import { executeQuery } from '../../command/execute';
import { istCalendarDate } from '../../numbering/financial-year';
import type { KeyValue } from '../../ports/key-value';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { loadAgentConfig, type ResolvedAgentConfig } from '../config';
import { maxCostInPaise } from '../models';
import type { SpendCap } from '../provider';
import { agentPrincipal, runAgentStep, type AgentStepDeps, type RunModel } from '../runtime';
import { conciergeFilterFacts } from './facts';
import { filterConciergeAnswer, type ConciergeVerdicts } from './filter';
import { conciergeMayRun } from './availability';
import { buildConciergePrompt, type ConciergePrompt } from './prompt';
import { readConciergeChat, readConciergeFacts, type ConciergeSkip } from './read-facts';
import { handoffReasonOf, handoffRuleOf, type ConciergeHandoff } from './rules';

// The WhatsApp Concierge's run on one customer message (docs/03-roadmap-appendix/phase2.md §7.2,
// PRD AI-05 and AI-06): bound to the message's chat, the agent reads what the chat holds as itself,
// hands the chat to people at once when a rule says so, else asks the model once, holds the answer
// to the output filter and records each of its three proposals (the reply, the qualification facts,
// a callback) as one step of the agent runtime, keyed by the event and the action type, so a
// redelivered message records nothing twice. Under Shadow, where it starts, a proposal is recorded
// shadowed and nothing is sent; under Needs approval the reply waits for the lead's owner, who sends
// it as written or edited, or discards it. Automatic stays unavailable, so nothing reaches a
// customer without a person. A handoff is not a proposal: the worker hands the chat over through
// the platform's hand-off, since stopping the agent needs no approval.

export const CONCIERGE_PURPOSE = 'whatsapp_reply';

export interface ConciergeDeps extends AgentStepDeps {
  /**
   * The shared store: the model's answer kept for a redelivery (`concierge:answer:{eventId}`), the
   * chat's runs today and its refused answers in a row.
   */
  keyValue: KeyValue;
  /**
   * Hands the chat to people with the reason given (the platform's
   * `messaging.thread.record_hand_off`, which the worker runs as `system:workers`).
   */
  handOff: (reason: WhatsAppHandoffReason) => Promise<void>;
  /**
   * Milliseconds left of the delivery's time (the event route stops at 60 seconds), read before the
   * model is asked; unbounded when left out.
   */
  timeLeft?: () => number;
}

export interface ConciergeRunInput {
  /** The outbox event that started the run: one run per customer message. */
  eventId: string;
  entityId: number;
  threadId: string;
  /** The customer's message the event names. */
  messageId: string;
}

export type ConciergeRunOutcome =
  /**
   * Switched off, without a spending limit, with too little of the day's spend left, or past the
   * chat's runs for the day: one stopped run is recorded, nothing asked, and the chat goes to
   * people (`no_assistant`).
   */
  | 'stopped'
  /** Nothing to draft on the chat now (`skip` says why): nothing recorded. */
  | 'skipped'
  /** A rule handed the chat to people before the model was asked. */
  | 'handed_off'
  /** The runs were recorded; `handoff` says when the answer handed the chat over too. */
  | 'ran';

export interface ConciergeRunResult {
  outcome: ConciergeRunOutcome;
  runs: Partial<Record<ConciergeProposalKind, AgentRunDto>>;
  skip?: ConciergeSkip;
  /** Why the chat went to people in this run, when it did. */
  handoff?: ConciergeHandoff;
}

/** The Concierge's own cap for a company (`AGENT_DEFAULTS.concierge.companyDailyCapPaise`). */
export function conciergeCeilings(entityId: number): SpendCap[] {
  return [{ paise: AGENT_DEFAULTS.concierge.companyDailyCapPaise, entityId }];
}

/** The most a run's model call is reckoned to cost before anything is read. */
export function conciergeModelEstimatePaise(): number {
  const d = AGENT_DEFAULTS.concierge;
  return maxCostInPaise(d.model, d.promptBytesEstimate, d.maxTokens);
}

/** A delivery with too little time left to ask the model: delivered again, nothing spent. */
export function conciergeOutOfTime(): DomainError {
  return new DomainError('integration_unavailable', 'too little time is left to ask the model', {
    reason: 'concierge_out_of_time',
  });
}

/** The key of the model's answer for one event. */
export const conciergeAnswerKey = (eventId: string): string => `concierge:answer:${eventId}`;
/** The key of a chat's runs on one day in India. */
export const conciergeRunsKey = (entityId: number, threadId: string, day: string): string =>
  `concierge:runs:${String(entityId)}:${threadId}:${day}`;
/** The key of a chat's answers in a row the filter refused or could not read. */
export const conciergeRefusalsKey = (entityId: number, threadId: string): string =>
  `concierge:refusals:${String(entityId)}:${threadId}`;
const countedKey = (eventId: string): string => `concierge:counted:${eventId}`;

const DAY_SECONDS = 2 * 24 * 60 * 60;

/** The step that records a stop: the reply's, with `capReached` as having reached its cap. */
function recordStop(
  input: ConciergeRunInput,
  deps: AgentStepDeps,
  capReached: boolean,
): Promise<AgentRunDto> {
  return runAgentStep(
    {
      agent: 'agent:concierge',
      entityId: input.entityId,
      eventId: input.eventId,
      purpose: CONCIERGE_PURPOSE,
      actionType: CONCIERGE_ACTION_TYPES.reply,
      threadId: input.threadId,
      decide: capReached
        ? () =>
            Promise.reject(
              new DomainError('rate_limited', 'agent:concierge has no room left in its caps', {
                reason: 'agent_spend_cap_reached',
              }),
            )
        : () => Promise.resolve(null),
      ceilings: conciergeCeilings(input.entityId),
    },
    deps,
  );
}

interface KeptAnswer {
  prompt: string;
  text: string;
}

function hashPrompt(prompt: ConciergePrompt): string {
  return createHash('sha256')
    .update(JSON.stringify([prompt.model, prompt.system, prompt.question, prompt.untrusted]))
    .digest('hex');
}

async function keptAnswer(
  eventId: string,
  promptHash: string,
  deps: ConciergeDeps,
): Promise<string | null> {
  try {
    const raw = await deps.keyValue.get(conciergeAnswerKey(eventId));
    if (raw === null) return null;
    const kept = JSON.parse(raw) as Partial<KeptAnswer> | null;
    return kept?.prompt === promptHash && typeof kept.text === 'string' ? kept.text : null;
  } catch (error) {
    deps.logger?.log('warn', 'agent.concierge_answer_not_read', { eventId, error });
    return null;
  }
}

async function keepAnswer(eventId: string, kept: KeptAnswer, deps: ConciergeDeps): Promise<void> {
  try {
    await deps.keyValue.set(
      conciergeAnswerKey(eventId),
      JSON.stringify(kept),
      AGENT_DEFAULTS.concierge.answerTtlSeconds,
    );
  } catch (error) {
    deps.logger?.log('warn', 'agent.concierge_answer_not_kept', { eventId, error });
  }
}

/**
 * The chat's runs today with this event's, counted once however often the event is delivered:
 * whether the chat is still within `runsPerThreadDay`.
 */
async function withinRuns(input: ConciergeRunInput, now: Date, kv: KeyValue): Promise<boolean> {
  const key = conciergeRunsKey(input.entityId, input.threadId, istCalendarDate(now));
  const first = await kv.setIfAbsent(countedKey(input.eventId), '1', DAY_SECONDS);
  const runs = first ? await kv.incr(key, DAY_SECONDS) : Number((await kv.get(key)) ?? '0');
  return runs <= AGENT_DEFAULTS.concierge.runsPerThreadDay;
}

/** The Concierge's settings for its reply, read as the agent. */
function conciergeSettings(entityId: number): Promise<ResolvedAgentConfig> {
  return executeQuery(
    agentPrincipal('agent:concierge', entityId),
    { entityIds: [entityId] },
    ({ tx }) => loadAgentConfig(tx, 'agent:concierge', CONCIERGE_ACTION_TYPES.reply, entityId),
    { name: 'agents.concierge.settings' },
  );
}

/**
 * Runs the WhatsApp Concierge once for one customer message. It first reads, bound to the chat,
 * who answers it and the customer's newest words: a chat with nothing to draft (people answer it,
 * a person replied, a newer message came) is left alone and nothing is recorded; a rule (HUMAN, a
 * complaint or legal matter, a price or subsidy question) hands it to people before anything else.
 * Then, before the chat's history, lead or rules are read: switched off, without a spending limit,
 * with too little of the day's spend left, or past the chat's runs for the day, one stopped run is
 * recorded and the chat goes to people. Otherwise the model is asked once, each proposal recorded,
 * and the chat handed to people when the AI service could not answer, or the answer asks to, is
 * unsure, or is the third in a row the filter refused.
 */
export async function runConcierge(
  input: ConciergeRunInput,
  deps: ConciergeDeps,
): Promise<ConciergeRunResult> {
  const now = deps.now ?? (() => new Date());
  const d = AGENT_DEFAULTS.concierge;
  const principal = agentPrincipal('agent:concierge', input.entityId);
  const bound = { entityIds: [input.entityId], agentThreadId: input.threadId };
  const job = {
    entityId: input.entityId,
    threadId: input.threadId,
    messageId: input.messageId,
    now: now(),
  };
  const first = await executeQuery(principal, bound, (ctx) => readConciergeChat(ctx, job), {
    name: 'agents.concierge.chat',
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });
  if (first.kind === 'skip') return { outcome: 'skipped', runs: {}, skip: first.skip };

  const refusals = conciergeRefusalsKey(input.entityId, input.threadId);
  const handOff = async (cause: ConciergeHandoff): Promise<void> => {
    await deps.handOff(handoffReasonOf(cause));
    await deps.keyValue.del(refusals);
  };
  const rule = handoffRuleOf(first.chat.answering);
  if (rule !== null) {
    await handOff(rule);
    return { outcome: 'handed_off', runs: {}, handoff: rule };
  }

  // The assistant cannot answer the chat now: recorded once, and people answer it.
  const stop = async (capReached: boolean): Promise<ConciergeRunResult> => {
    const reply = await recordStop(input, deps, capReached);
    await handOff('unavailable');
    return { outcome: 'stopped', runs: { reply }, handoff: 'unavailable' };
  };
  const config = await conciergeSettings(input.entityId);
  if (!conciergeMayRun(config)) return stop(false);
  // The day's spend must have room for the run.
  const caps = [...config.caps, ...conciergeCeilings(input.entityId)];
  const fits = await deps.provider.fits(
    { agent: 'agent:concierge', entityId: input.entityId, caps },
    conciergeModelEstimatePaise(),
  );
  if (!fits) return stop(true);
  if (!(await withinRuns(input, now(), deps.keyValue))) return stop(true);

  const timeLeft = deps.timeLeft ?? (() => Number.POSITIVE_INFINITY);
  if (timeLeft() < d.minModelMs) throw conciergeOutOfTime();

  const read = await executeQuery(
    principal,
    bound,
    (ctx) => readConciergeFacts(ctx, job, first.chat),
    {
      name: 'agents.concierge.facts',
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    },
  );
  if (read.kind === 'skip') return { outcome: 'skipped', runs: {}, skip: read.skip };

  const prompt = buildConciergePrompt(read.facts);
  const promptHash = hashPrompt(prompt);
  const filterFacts = conciergeFilterFacts(read.facts);
  let answer: Promise<string> | undefined;
  let verdicts: ConciergeVerdicts | undefined;
  const verdictsOf = async (model: RunModel): Promise<ConciergeVerdicts> => {
    answer ??= keptAnswer(input.eventId, promptHash, deps).then(
      (kept) =>
        kept ??
        model
          .complete({
            model: prompt.model,
            effort: prompt.effort,
            system: prompt.system,
            question: prompt.question,
            untrusted: prompt.untrusted,
            maxTokens: prompt.maxTokens,
            totalTimeoutMs: Math.min(d.totalTimeoutMs, timeLeft()),
          })
          .then(async (reply) => {
            await keepAnswer(input.eventId, { prompt: promptHash, text: reply.text }, deps);
            return reply.text;
          }),
    );
    const text = await answer;
    verdicts ??= filterConciergeAnswer(text, filterFacts);
    return verdicts;
  };

  const runs: ConciergeRunResult['runs'] = {};
  // The steps this delivery decided: a step an earlier delivery recorded is not decided again.
  const decided = new Set<ConciergeProposalKind>();
  for (const kind of CONCIERGE_PROPOSAL_KINDS) {
    runs[kind] = await runAgentStep(
      {
        agent: 'agent:concierge',
        entityId: input.entityId,
        eventId: input.eventId,
        purpose: CONCIERGE_PURPOSE,
        actionType: CONCIERGE_ACTION_TYPES[kind],
        threadId: input.threadId,
        decide: async (model) => {
          decided.add(kind);
          return (await verdictsOf(model))[kind];
        },
        ceilings: conciergeCeilings(input.entityId),
      },
      deps,
    );
  }

  // The answers in a row the filter refused, counted only by the delivery that recorded the reply,
  // so a redelivery that completes a partial run counts it once.
  let refusedInARow = 0;
  if (verdicts !== undefined && decided.has('reply')) {
    if (verdicts.reply !== null && 'filtered' in verdicts.reply) {
      refusedInARow = await deps.keyValue.incr(refusals, DAY_SECONDS);
    } else {
      await deps.keyValue.del(refusals);
    }
  } else if (verdicts === undefined) {
    // Every step already recorded by an earlier delivery: the answer it kept, if any, says
    // whether the chat goes to people.
    const kept = await keptAnswer(input.eventId, promptHash, deps);
    if (kept !== null) verdicts = filterConciergeAnswer(kept, filterFacts);
  }
  // The AI service could not answer (an outage, a vendor paused after repeated failures, the spend
  // reached while asking): nothing was drafted for the customer, so people answer the chat now
  // rather than after more unanswered messages (p2-fixes, the lead's item 9). A redelivery that
  // finds the reply recorded so hands over too, in case the first stopped before it did.
  const replyEnded = runs.reply?.outcome;
  const assistantDown = replyEnded === 'unavailable' || replyEnded === 'cap_reached';
  const cause: ConciergeHandoff | null = assistantDown
    ? 'unavailable'
    : (verdicts?.handoff ?? (refusedInARow >= d.refusalsInARow ? 'refusals' : null));
  if (cause === null) return { outcome: 'ran', runs };
  await handOff(cause);
  return { outcome: 'ran', runs, handoff: cause };
}
