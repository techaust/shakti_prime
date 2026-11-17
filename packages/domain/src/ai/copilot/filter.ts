import {
  COPILOT_ACTION_TYPES,
  COPILOT_FACTS,
  COPILOT_NOTE_MAX,
  CopilotFactsSchema,
  type AgentFilterReason,
  type AgentProposal,
  type CopilotFact,
  type CopilotFacts,
  type CopilotNoteKind,
  type CopilotTemplateOccasion,
  type WhatsAppTemplateCategory,
} from '@shakti/contracts';
import { z } from 'zod';
import { istCalendarDate } from '../../numbering/financial-year';
import { asciiDigits, maskForModel } from '../../privacy/model-text';
import { withinCallingHours } from '../../telecom/dial-policy';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { AGENT_DEFAULTS } from '../agent-defaults';

// The Caller Co-pilot's deterministic output filter (docs/03-roadmap-appendix/phase2.md §7.3,
// SECURITY §6, PRD AI-05). The model's answer is untrusted, and so is everything it read (the
// transcript, the customer's messages): the answer is read against a loose shape, then each part
// is held to what the run offered and to the rules below. What passes becomes the note and the
// inputs of the action types' commands; what fails is recorded with its reason and nothing else.
//
// - the brief or summary: at most 600 characters, with no identity number, contact detail,
//   instruction or link;
// - the facts heard: only the qualification facts a call can give, each within its field's
//   bounds, and only those that differ from what the lead already records;
// - the outcome: one of the outcomes offered for the call;
// - the follow-up: a time with its offset, later than now and inside calling hours, for the
//   lead's owner;
// - the WhatsApp template: an approved utility or marketing template of the company with no blanks,
//   on its occasion's day, only when the customer has a chat that has not opted out and holds a
//   WhatsApp consent (a promotional one for a marketing template).

/** What one part of the answer comes to: a proposal, nothing, or the filter's reason. */
export type CopilotDecision = AgentProposal | null | { filtered: AgentFilterReason };

/** The note the filter passed: its text, the facts it heard and the outcome it would pre-select. */
export interface CopilotNote {
  body: string;
  fields: CopilotFacts;
  suggestedDispositionId: string | null;
}

export interface CopilotVerdicts {
  note: CopilotNote | { filtered: AgentFilterReason };
  /** `crm.lead.qualification.set` */
  qualification: CopilotDecision;
  /** `crm.task.create` */
  followUp: CopilotDecision;
  /** `messaging.template.request` */
  template: CopilotDecision;
}

/** A WhatsApp template of the company the run offered, as the filter weighs it. */
export interface OfferedTemplate {
  name: string;
  category: WhatsAppTemplateCategory;
  approved: boolean;
  /** How many blanks its body has. */
  values: number;
  /** A template the platform sends for a purpose of its own (the welcome), never proposed. */
  forPlatform: boolean;
}

/** What the run read and offered, which the answer is held to. Built by the worker. */
export interface CopilotContext {
  kind: CopilotNoteKind;
  entityId: number;
  opportunityId: string;
  now: Date;
  /** The lead's owner, whom a follow-up is for; null when the lead has none. */
  ownerId: string | null;
  /** The facts the lead already records. */
  current: Partial<Record<CopilotFact, number | null>>;
  /** The outcomes offered for a call summary, by the code the model sees. */
  outcomes: readonly { code: string; dispositionId: string }[];
  leadState: 'open' | 'nurture' | 'won' | 'lost';
  /** When the lead entered nurture, while it is in nurture. */
  nurtureSince: Date | null;
  /** The lead's sent quotes, by the label the model sees. */
  quotes: readonly { label: string; quoteId: string; validUntil: Date }[];
  templates: readonly OfferedTemplate[];
  whatsapp: {
    /** The customer has a chat with the company that has not opted out. */
    chat: boolean;
    /** The customer's WhatsApp consents in force. */
    consents: { service: boolean; promotional: boolean };
  };
}

/** Loose on purpose: anything the model may write; the checks below decide. */
const Answer = z.object({
  note: z.unknown(),
  facts: z.record(z.string(), z.unknown()).nullish(),
  outcome: z.unknown().optional(),
  followUp: z.object({ dueAt: z.unknown(), title: z.unknown().optional() }).nullish(),
  template: z
    .object({ name: z.unknown(), occasion: z.unknown(), quote: z.unknown().optional() })
    .nullish(),
});
type Answer = z.infer<typeof Answer>;

/** The JSON object in the answer, allowing for a fence around it; undefined when there is none. */
export function parseCopilotAnswer(text: string): Answer | undefined {
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

/** The placeholders the masking leaves for a contact detail, and the ones for an identity number. */
const CONTACT_PLACEHOLDERS = ['[phone]', '[email]', '[upi]', '[address]', '[pin]'];
const IDENTITY_PLACEHOLDERS = ['[number]', '[pan]', '[gstin]'];

/**
 * Words that speak to a model or its rules, and code or bracket characters: a note describes the
 * lead and the call and never asks anything of whoever reads it. Narrower than the Triage
 * agent's list, since a summary may say the customer will send or pay something.
 */
const INSTRUCTION =
  /\b(ignore|disregard|forget|override|bypass|jailbreak|pretend|instructions?|prompts?|system\s*(?:prompt|message|note)|assistant|developer|act as|you are|you must|you should|as an ai)\b|\bsystem\s*:|[<>{}`[\]\\]/i;

/** A web address in any form: a scheme, `www.`, or a name ending in a common domain. */
const LINK =
  /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|in|org|net|io|co|ai|app|xyz|info|biz|me|ly|link|site|online|gov|edu)\b/i;

/** Why a brief, summary or follow-up title may not be kept, if it may not. */
export function copilotTextProblem(text: string): AgentFilterReason | undefined {
  if (text.length > COPILOT_NOTE_MAX) return 'text_too_long';
  const lower = maskForModel(text).toLowerCase();
  if (IDENTITY_PLACEHOLDERS.some((p) => lower.includes(p))) return 'text_has_identity_number';
  if (CONTACT_PLACEHOLDERS.some((p) => lower.includes(p))) return 'text_has_phone';
  // Nine or more digits in a row, spaces and dashes aside, read as a phone or identity number.
  if (/\d{9,}/.test(asciiDigits(text).replace(/[\s\-–—.()]/g, ''))) return 'text_has_phone';
  if (LINK.test(text) || INSTRUCTION.test(text)) return 'text_has_instruction';
  return undefined;
}

const about = (context: CopilotContext) =>
  ({ subjectType: 'opportunity', subjectId: context.opportunityId }) as const;

/** The facts heard, within bounds; `undefined` for a fact out of bounds or not a call's to give. */
function heardFacts(answer: Answer, context: CopilotContext): CopilotFacts | undefined {
  if (context.kind !== 'call_summary') return {};
  const raw = answer.facts ?? {};
  const given = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== null && value !== undefined),
  );
  const parsed = CopilotFactsSchema.safeParse(given);
  return parsed.success ? parsed.data : undefined;
}

/** The facts that differ from what the lead records. */
function changedFacts(facts: CopilotFacts, context: CopilotContext): CopilotFacts {
  return Object.fromEntries(
    COPILOT_FACTS.filter((f) => facts[f] !== undefined && facts[f] !== context.current[f]).map(
      (f) => [f, facts[f]],
    ),
  );
}

function note(answer: Answer, context: CopilotContext): CopilotVerdicts['note'] {
  if (typeof answer.note !== 'string' || answer.note.trim() === '') {
    return { filtered: 'unreadable_answer' };
  }
  const body = answer.note.trim();
  const problem = copilotTextProblem(body);
  if (problem !== undefined) return { filtered: problem };
  const fields = heardFacts(answer, context);
  if (fields === undefined) return { filtered: 'fact_out_of_bounds' };
  let suggestedDispositionId: string | null = null;
  if (context.kind === 'call_summary' && answer.outcome !== undefined && answer.outcome !== null) {
    const offered = context.outcomes.find((o) => o.code === answer.outcome);
    if (offered === undefined) return { filtered: 'unknown_outcome' };
    suggestedDispositionId = offered.dispositionId;
  }
  return { body, fields, suggestedDispositionId };
}

function qualification(answer: Answer, context: CopilotContext): CopilotDecision {
  if (context.kind !== 'call_summary') return null;
  const facts = heardFacts(answer, context);
  if (facts === undefined) return { filtered: 'fact_out_of_bounds' };
  const changed = changedFacts(facts, context);
  if (Object.keys(changed).length === 0) return null;
  return {
    input: { entityId: context.entityId, opportunityId: context.opportunityId, facts: changed },
    ...about(context),
  };
}

/** A time with its date, hour and minute, and its offset from UTC (`Z` or `+05:30`). */
const TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function followUp(answer: Answer, context: CopilotContext): CopilotDecision {
  const f = answer.followUp;
  if (f === undefined || f === null) return null;
  if (context.ownerId === null) return { filtered: 'unknown_person' };
  if (typeof f.dueAt !== 'string' || !TIME_WITH_OFFSET.test(f.dueAt)) {
    return { filtered: 'task_outside_hours' };
  }
  const due = new Date(f.dueAt);
  if (Number.isNaN(due.getTime()) || due <= context.now || !withinCallingHours(due)) {
    return { filtered: 'task_outside_hours' };
  }
  let title: string | undefined;
  if (f.title !== undefined && f.title !== null) {
    if (typeof f.title !== 'string') return { filtered: 'text_has_instruction' };
    title = f.title.trim();
    if (title.length > 80) return { filtered: 'text_too_long' };
    const problem = title === '' ? undefined : copilotTextProblem(title);
    if (problem !== undefined) return { filtered: problem };
  }
  return {
    input: {
      entityId: context.entityId,
      opportunityId: context.opportunityId,
      kind: 'follow_up',
      dueAt: due.toISOString(),
      assigneeId: context.ownerId,
      ...(title === undefined || title === '' ? {} : { title }),
    },
    ...about(context),
    assigneeId: context.ownerId,
  };
}

const DAY_MS = 86_400_000;

/** Whole IST calendar days from `from` to `to`. */
function istDaysBetween(from: Date, to: Date): number {
  return Math.round((Date.parse(istCalendarDate(to)) - Date.parse(istCalendarDate(from))) / DAY_MS);
}

/** Whether the occasion falls today; the quote it is about, for a quote-expiry nudge. */
function occasionToday(
  occasion: CopilotTemplateOccasion,
  quoteLabel: unknown,
  context: CopilotContext,
): { ok: true; quoteId?: string } | { ok: false } {
  if (occasion === 'nurture') {
    if (context.leadState !== 'nurture' || context.nurtureSince === null) return { ok: false };
    const day = istDaysBetween(context.nurtureSince, context.now);
    return WORKSHOP_DEFAULTS.calling.nurtureCallDays.includes(day) ? { ok: true } : { ok: false };
  }
  const quote = context.quotes.find((q) => q.label === quoteLabel);
  if (quote === undefined) return { ok: false };
  const daysLeft = istDaysBetween(context.now, quote.validUntil);
  return daysLeft === AGENT_DEFAULTS.copilot.quoteNudgeDaysBefore
    ? { ok: true, quoteId: quote.quoteId }
    : { ok: false };
}

const OCCASIONS: readonly CopilotTemplateOccasion[] = ['nurture', 'quote_expiry'];

function template(answer: Answer, context: CopilotContext): CopilotDecision {
  const t = answer.template;
  if (t === undefined || t === null) return null;
  const refused = { filtered: 'template_not_allowed' } as const;
  const occasion = OCCASIONS.find((o) => o === t.occasion);
  if (occasion === undefined) return refused;
  const offered = context.templates.find((x) => x.name === t.name);
  if (
    offered === undefined ||
    !offered.approved ||
    offered.forPlatform ||
    offered.values !== 0 ||
    (offered.category !== 'utility' && offered.category !== 'marketing')
  ) {
    return refused;
  }
  const { chat, consents } = context.whatsapp;
  const consented =
    offered.category === 'marketing'
      ? consents.promotional
      : consents.service || consents.promotional;
  if (!chat || !consented) return refused;
  const today = occasionToday(occasion, t.quote, context);
  if (!today.ok) return refused;
  return {
    input: {
      entityId: context.entityId,
      opportunityId: context.opportunityId,
      occasion,
      ...(today.quoteId === undefined ? {} : { quoteId: today.quoteId }),
      templateName: offered.name,
    },
    ...about(context),
    ...(context.ownerId === null ? {} : { assigneeId: context.ownerId }),
  };
}

/** The verdict on each part of the model's answer; an answer that cannot be read refuses all. */
export function filterCopilotOutput(text: string, context: CopilotContext): CopilotVerdicts {
  const answer = parseCopilotAnswer(text);
  if (answer === undefined) {
    const unreadable = { filtered: 'unreadable_answer' } as const;
    return {
      note: unreadable,
      qualification: unreadable,
      followUp: unreadable,
      template: unreadable,
    };
  }
  return {
    note: note(answer, context),
    qualification: qualification(answer, context),
    followUp: followUp(answer, context),
    template: template(answer, context),
  };
}

/** The action type each proposal part runs (`AGENT_ACTION_TYPES`). */
export const COPILOT_PART_ACTION_TYPES = {
  qualification: COPILOT_ACTION_TYPES.qualification,
  followUp: COPILOT_ACTION_TYPES.followUp,
  template: COPILOT_ACTION_TYPES.template,
} as const satisfies Record<Exclude<keyof CopilotVerdicts, 'note'>, string>;
