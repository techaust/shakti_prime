import {
  TRIAGE_ACTION_TYPES,
  TRIAGE_PROPOSAL_KINDS,
  type AgentFilterReason,
  type AgentProposal,
  type TriageProposalKind,
} from '@shakti/contracts';
import { z } from 'zod';
import { asciiDigits, maskForModel } from '../../privacy/model-text';
import { AGENT_DEFAULTS } from '../agent-defaults';
import type { TriageFacts } from './facts';

// The Triage agent's deterministic output filter (A1, SECURITY §6, PRD AI-05). The model's answer
// is untrusted: it is read against a loose shape, and each kind of proposal is then held to what
// the run offered (a pipeline listed, a duplicate card shown, a person shown), to the score's
// bounds, and to a note with no phone number, identity number or instruction. What passes becomes
// the input of the action type's command (or shadow-only kind); what fails is recorded with its
// reason and nothing else.

/** What one kind of proposal comes to: a proposal, nothing, or the filter's reason. */
export type TriageDecision = AgentProposal | null | { filtered: AgentFilterReason };

export type TriageVerdicts = Record<TriageProposalKind, TriageDecision>;

const Note = z.string().max(2_000).nullish();
/** Loose on purpose: anything the model may write; the checks below decide. */
const Answer = z.object({
  pipeline: z.object({ key: z.unknown(), note: Note }).nullish(),
  score: z.object({ change: z.unknown(), note: Note }).nullish(),
  duplicate: z.object({ card: z.unknown() }).nullish(),
  assignee: z.object({ person: z.unknown() }).nullish(),
});
type Answer = z.infer<typeof Answer>;

/** The JSON object in the answer, allowing for a fence around it; undefined when there is none. */
export function readTriageAnswer(text: string): Answer | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed = Answer.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A placeholder the masking leaves for a contact detail, and the ones for an identity number. */
const CONTACT_PLACEHOLDERS = ['[phone]', '[email]', '[upi]', '[address]', '[pin]'];
const IDENTITY_PLACEHOLDERS = ['[number]', '[pan]', '[gstin]'];

/**
 * Words that speak to the model or its rules, or ask for an action the agent may only propose, and
 * links and brackets: a note describes the lead and never asks for anything. Kept wide, since a
 * wrongly refused note costs only the shadowed proposal it came with.
 */
const INSTRUCTION =
  /\b(ignore|disregard|forget|override|bypass|jailbreak|pretend|instructions?|prompt|system\s*(?:prompt|message|note)|assistant|developer|act as|you are|you must|you should|approve|assign|merge|transfer|delete|pay|send|click|execute)\b|\bsystem\s*:|https?:|www\.|[<>{}`[\]]/i;

/** Why a note may not be kept, if it may not. */
export function noteProblem(note: string): AgentFilterReason | undefined {
  const masked = maskForModel(note);
  const lower = masked.toLowerCase();
  if (IDENTITY_PLACEHOLDERS.some((p) => lower.includes(p))) return 'text_has_identity_number';
  if (CONTACT_PLACEHOLDERS.some((p) => lower.includes(p))) return 'text_has_phone';
  // Six or more digits in a row, spaces and dashes aside, read as part of a number.
  if (/\d{6,}/.test(asciiDigits(note).replace(/[\s\-–—.()]/g, ''))) return 'text_has_phone';
  if (INSTRUCTION.test(note)) return 'text_has_instruction';
  return undefined;
}

/** The note as kept: trimmed, or left out when empty. */
function keptNote(
  raw: string | null | undefined,
): { ok: true; note: string | undefined } | { ok: false; problem: AgentFilterReason } {
  const note = raw?.trim() ?? '';
  if (note === '') return { ok: true, note: undefined };
  if (note.length > 160) return { ok: false, problem: 'text_has_instruction' };
  const problem = noteProblem(note);
  return problem === undefined ? { ok: true, note } : { ok: false, problem };
}

const about = (facts: TriageFacts) =>
  ({ subjectType: 'opportunity', subjectId: facts.opportunityId }) as const;

function pipeline(answer: Answer, facts: TriageFacts): TriageDecision {
  const p = answer.pipeline;
  if (p === undefined || p === null) return null;
  if (typeof p.key !== 'string' || !facts.pipelines.some((x) => x.key === p.key)) {
    return { filtered: 'unknown_pipeline' };
  }
  const note = keptNote(p.note);
  if (!note.ok) return { filtered: note.problem };
  return {
    input: {
      entityId: facts.entityId,
      opportunityId: facts.opportunityId,
      pipelineKey: p.key,
      ...(note.note === undefined ? {} : { note: note.note }),
    },
    ...about(facts),
  };
}

function score(answer: Answer, facts: TriageFacts): TriageDecision {
  const s = answer.score;
  if (s === undefined || s === null) return null;
  const max = AGENT_DEFAULTS.triage.scoreAdjustmentMax;
  const change = s.change;
  if (typeof change !== 'number' || !Number.isInteger(change) || Math.abs(change) > max) {
    return { filtered: 'score_out_of_bounds' };
  }
  if (change === 0) return null;
  const next = facts.score + change;
  if (next < 0 || next > 100) return { filtered: 'score_out_of_bounds' };
  const note = keptNote(s.note);
  if (!note.ok) return { filtered: note.problem };
  return {
    input: {
      entityId: facts.entityId,
      opportunityId: facts.opportunityId,
      adjustment: change,
      score: next,
      ...(note.note === undefined ? {} : { note: note.note }),
    },
    ...about(facts),
  };
}

function duplicate(answer: Answer, facts: TriageFacts): TriageDecision {
  const d = answer.duplicate;
  if (d === undefined || d === null) return null;
  const card = facts.candidates.find((c) => c.label === d.card);
  if (card === undefined) return { filtered: 'unknown_candidate' };
  return {
    input: {
      entityId: facts.entityId,
      opportunityId: facts.opportunityId,
      otherOpportunityId: card.otherOpportunityId,
    },
    ...about(facts),
  };
}

function assignee(answer: Answer, facts: TriageFacts): TriageDecision {
  const a = answer.assignee;
  if (a === undefined || a === null) return null;
  const person = facts.people.find((p) => p.label === a.person);
  if (person === undefined) return { filtered: 'unknown_person' };
  return {
    input: {
      entityId: facts.entityId,
      opportunityId: facts.opportunityId,
      ownerId: person.personId,
    },
    ...about(facts),
  };
}

const CHECKS: Record<TriageProposalKind, (a: Answer, f: TriageFacts) => TriageDecision> = {
  pipeline,
  score,
  duplicate,
  assignee,
};

/** Each kind's verdict on the model's answer; an answer that cannot be read refuses all four. */
export function filterTriageAnswer(text: string, facts: TriageFacts): TriageVerdicts {
  const answer = readTriageAnswer(text);
  return Object.fromEntries(
    TRIAGE_PROPOSAL_KINDS.map((kind) => [
      kind,
      answer === undefined ? { filtered: 'unreadable_answer' } : CHECKS[kind](answer, facts),
    ]),
  ) as TriageVerdicts;
}

/** The kind of proposal an action type of the Triage agent records. */
export function kindOfActionType(actionType: string): TriageProposalKind | undefined {
  return TRIAGE_PROPOSAL_KINDS.find((k) => TRIAGE_ACTION_TYPES[k] === actionType);
}
