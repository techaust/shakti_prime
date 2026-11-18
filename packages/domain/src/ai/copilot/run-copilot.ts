import {
  DomainError,
  type AgentFilterReason,
  type AgentRunDto,
  type CopilotNoteDto,
  type CopilotNoteKind,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, gt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { executeCommand, executeQuery } from '../../command/execute';
import { recordCopilotNote } from '../../commands/agents/notes';
import type { KeyValue } from '../../ports/key-value';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { loadAgentConfig, type ResolvedAgentConfig } from '../config';
import type { SpendCap } from '../provider';
import { agentPrincipal, runAgentStep, type AgentStepDeps, type RunModel } from '../runtime';
import { copilotContext } from './facts';
import { COPILOT_PART_ACTION_TYPES, filterCopilotOutput, type CopilotVerdicts } from './filter';
import { buildCopilotPrompt, type CopilotPrompt } from './prompt';
import { readCopilotFacts } from './read-facts';

// The Caller Co-pilot's runs (docs/03-roadmap-appendix/phase2.md §7.3, PRD AI-04 and TEL-03): a
// brief before a call (on `crm.opportunity.assigned` and on demand) and the summary of a recorded
// call (on `calls.dial.completed`, after its transcript is made). One run reads the lead as the
// agent, asks the model once, holds the answer to the output filter, records each of its proposals
// as one step of the agent runtime (`runAgentStep()`, keyed by the event and the action type, so a
// redelivered event records nothing twice) and then records the brief or summary itself with
// `agents.note.record`. Under Shadow, where the Co-pilot starts, a proposal is recorded shadowed
// and nothing acts; under Needs approval it waits in the inbox for a person. The agent never logs
// a call: a summary's outcome is only pre-selected in the person's call log.

export const COPILOT_BRIEF_PURPOSE = 'copilot_brief';
export const COPILOT_SUMMARY_PURPOSE = 'copilot_call_summary';

/** The proposal parts of each kind, in order; the first carries a stop when nothing may run. */
const PARTS = {
  brief: ['followUp', 'template'],
  call_summary: ['qualification', 'followUp', 'template'],
} as const satisfies Record<CopilotNoteKind, readonly (keyof typeof COPILOT_PART_ACTION_TYPES)[]>;
type Part = keyof typeof COPILOT_PART_ACTION_TYPES;

export interface CopilotDeps extends AgentStepDeps {
  /**
   * Where the model's answer for one event is kept (`copilot:answer:{eventId}`), so a delivery
   * that runs again after a partial run asks the model nothing for the parts left.
   */
  keyValue?: KeyValue;
}

export interface CopilotRunInput {
  /** The outbox event that started the run: one run per event. */
  eventId: string;
  kind: CopilotNoteKind;
  entityId: number;
  opportunityId: string;
  /** A summary's call and its masked transcript. */
  providerCallId?: string;
  transcript?: string;
}

export type CopilotRunOutcome =
  /** Switched off or without a spending limit: one stopped run is recorded, nothing read. */
  | 'stopped'
  /** A brief was written within the hour (or the call has its summary): nothing ran. */
  | 'recent'
  /** The agent cannot read the lead, or a brief's lead is closed: nothing ran. */
  | 'no_lead'
  /** The runs were recorded; `note` says whether the brief or summary was kept. */
  | 'ran';

export interface CopilotRunResult {
  outcome: CopilotRunOutcome;
  runs: Partial<Record<Part, AgentRunDto>>;
  /** The brief or summary recorded by this delivery. */
  note?: CopilotNoteDto;
  /** Why the output filter refused the brief or summary, when it did. */
  noteRefused?: AgentFilterReason;
}

/** The Co-pilot's own cap for a company (`AGENT_DEFAULTS.copilot.companyDailyCapPaise`). */
export function copilotCeilings(entityId: number): SpendCap[] {
  return [{ paise: AGENT_DEFAULTS.copilot.companyDailyCapPaise, entityId }];
}

/** Whether settings let the agent call the model at all: switched on with every cap above zero. */
export function copilotMayRun(config: ResolvedAgentConfig): boolean {
  return config.enabled && config.caps.length > 0 && config.caps.every((c) => c.paise > 0);
}

/** The Co-pilot's settings for the first part of a kind, read as the agent. */
export async function copilotSettings(
  entityId: number,
  kind: CopilotNoteKind,
): Promise<ResolvedAgentConfig> {
  const principal = agentPrincipal('agent:copilot', entityId);
  return executeQuery(
    principal,
    { entityIds: [entityId] },
    ({ tx }) =>
      loadAgentConfig(tx, 'agent:copilot', COPILOT_PART_ACTION_TYPES[PARTS[kind][0]], entityId),
    { name: 'agents.copilot.settings' },
  );
}

/** The step that records a stop: the first part's, which never asks for a decision. */
export function recordCopilotStop(
  input: Pick<CopilotRunInput, 'eventId' | 'kind' | 'entityId'>,
  deps: AgentStepDeps,
): Promise<AgentRunDto> {
  return runAgentStep(
    {
      agent: 'agent:copilot',
      entityId: input.entityId,
      eventId: input.eventId,
      purpose: input.kind === 'brief' ? COPILOT_BRIEF_PURPOSE : COPILOT_SUMMARY_PURPOSE,
      actionType: COPILOT_PART_ACTION_TYPES[PARTS[input.kind][0]],
      decide: () => Promise.resolve(null),
      ceilings: copilotCeilings(input.entityId),
    },
    deps,
  );
}

/** Whether the lead had a brief within the hour, read as the agent. */
async function briefedRecently(entityId: number, opportunityId: string, now: Date) {
  const principal = agentPrincipal('agent:copilot', entityId);
  const since = new Date(now.getTime() - AGENT_DEFAULTS.copilot.briefIntervalMinutes * 60_000);
  return executeQuery(
    principal,
    { entityIds: [entityId] },
    async ({ tx }) => {
      const n = schema.copilotNotes;
      const [row] = await tx
        .select({ id: n.id })
        .from(n)
        .where(and(eq(n.opportunityId, opportunityId), eq(n.kind, 'brief'), gt(n.createdAt, since)))
        .limit(1);
      return row !== undefined;
    },
    { name: 'agents.copilot.recent_brief' },
  );
}

/** The key of the model's answer for one event. */
export const copilotAnswerKey = (eventId: string): string => `copilot:answer:${eventId}`;

interface KeptAnswer {
  prompt: string;
  text: string;
}

function hashPrompt(prompt: CopilotPrompt): string {
  return createHash('sha256')
    .update(JSON.stringify([prompt.model, prompt.system, prompt.question, prompt.untrusted]))
    .digest('hex');
}

async function keptAnswer(
  eventId: string,
  promptHash: string,
  deps: CopilotDeps,
): Promise<string | null> {
  if (deps.keyValue === undefined) return null;
  try {
    const raw = await deps.keyValue.get(copilotAnswerKey(eventId));
    if (raw === null) return null;
    const kept = JSON.parse(raw) as Partial<KeptAnswer> | null;
    return kept?.prompt === promptHash && typeof kept.text === 'string' ? kept.text : null;
  } catch (error) {
    deps.logger?.log('warn', 'agent.copilot_answer_not_read', { eventId, error });
    return null;
  }
}

async function keepAnswer(eventId: string, kept: KeptAnswer, deps: CopilotDeps): Promise<void> {
  if (deps.keyValue === undefined) return;
  try {
    await deps.keyValue.set(
      copilotAnswerKey(eventId),
      JSON.stringify(kept),
      AGENT_DEFAULTS.copilot.answerTtlSeconds,
    );
  } catch (error) {
    deps.logger?.log('warn', 'agent.copilot_answer_not_kept', { eventId, error });
  }
}

/** The idempotency key of a run's note: its event and kind, as 64 hex characters. */
const noteKey = (eventId: string, kind: CopilotNoteKind): string =>
  createHash('sha256').update(`${eventId}\nagents.note.record\n${kind}`).digest('hex');

/** A refusal that means the note is already there, or may not be written now: not retried. */
function noteRefusal(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    (error.code === 'conflict' || error.code === 'not_found' || error.code === 'validation_failed')
  );
}

/**
 * Runs the Caller Co-pilot once for one event: a brief, or the summary of a call whose transcript
 * the caller of this function made (`summariseCall`). Switched off or without a spending limit, one
 * stopped run is recorded and the lead is not read. A brief within the hour stops a brief before
 * anything is read or asked.
 */
export async function runCopilot(
  input: CopilotRunInput,
  deps: CopilotDeps,
): Promise<CopilotRunResult> {
  const now = deps.now ?? (() => new Date());
  const principal = agentPrincipal('agent:copilot', input.entityId);
  const config = await copilotSettings(input.entityId, input.kind);
  if (!copilotMayRun(config)) {
    const stopped = await recordCopilotStop(input, deps);
    return { outcome: 'stopped', runs: { [PARTS[input.kind][0]]: stopped } };
  }
  if (
    input.kind === 'brief' &&
    (await briefedRecently(input.entityId, input.opportunityId, now()))
  ) {
    return { outcome: 'recent', runs: {} };
  }

  const facts = await executeQuery(
    principal,
    { entityIds: [input.entityId] },
    (ctx) =>
      readCopilotFacts(ctx, {
        kind: input.kind,
        entityId: input.entityId,
        opportunityId: input.opportunityId,
        now: now(),
        ...(input.transcript === undefined ? {} : { transcript: input.transcript }),
      }),
    // The Co-pilot's chat definers are granted to `app_user` alone.
    { name: 'agents.copilot.facts', pool: 'app_user' },
  );
  if (facts === undefined) return { outcome: 'no_lead', runs: {} };

  const prompt = buildCopilotPrompt(facts);
  const promptHash = hashPrompt(prompt);
  const context = copilotContext(facts);
  let answer: Promise<string> | undefined;
  let verdicts: CopilotVerdicts | undefined;
  const verdictsOf = async (model: RunModel): Promise<CopilotVerdicts> => {
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
            totalTimeoutMs: AGENT_DEFAULTS.copilot.totalTimeoutMs,
          })
          .then(async (reply) => {
            await keepAnswer(input.eventId, { prompt: promptHash, text: reply.text }, deps);
            return reply.text;
          }),
    );
    const text = await answer;
    verdicts ??= filterCopilotOutput(text, context);
    return verdicts;
  };

  const purpose = input.kind === 'brief' ? COPILOT_BRIEF_PURPOSE : COPILOT_SUMMARY_PURPOSE;
  const runs: CopilotRunResult['runs'] = {};
  for (const part of PARTS[input.kind]) {
    runs[part] = await runAgentStep(
      {
        agent: 'agent:copilot',
        entityId: input.entityId,
        eventId: input.eventId,
        purpose,
        actionType: COPILOT_PART_ACTION_TYPES[part],
        decide: async (model) => (await verdictsOf(model))[part],
        ceilings: copilotCeilings(input.entityId),
      },
      deps,
    );
  }

  // Every step already recorded by an earlier delivery: the answer it kept, if any, gives the note.
  if (verdicts === undefined) {
    const kept = await keptAnswer(input.eventId, promptHash, deps);
    if (kept !== null) verdicts = filterCopilotOutput(kept, context);
  }
  if (verdicts === undefined) return { outcome: 'ran', runs };
  if ('filtered' in verdicts.note) {
    return { outcome: 'ran', runs, noteRefused: verdicts.note.filtered };
  }
  const { body, fields, suggestedDispositionId } = verdicts.note;
  const factsAction = runs.qualification?.actionId ?? null;
  try {
    const note = await executeCommand(
      principal,
      { entityIds: [input.entityId] },
      recordCopilotNote,
      {
        entityId: input.entityId,
        opportunityId: input.opportunityId,
        kind: input.kind,
        ...(input.providerCallId === undefined ? {} : { providerCallId: input.providerCallId }),
        body,
        fields,
        ...(suggestedDispositionId === null ? {} : { suggestedDispositionId }),
        ...(factsAction === null ? {} : { agentActionId: factsAction }),
      },
      { idempotencyKey: noteKey(input.eventId, input.kind) },
    );
    return { outcome: 'ran', runs, note };
  } catch (error) {
    // Another delivery or a brief written meanwhile; a call already summarised.
    if (!noteRefusal(error)) throw error;
    deps.logger?.log('warn', 'agent.copilot_note_refused', {
      entityId: input.entityId,
      opportunityId: input.opportunityId,
      error,
    });
    return { outcome: 'ran', runs };
  }
}
