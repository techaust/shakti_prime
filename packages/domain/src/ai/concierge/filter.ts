import {
  CONCIERGE_REPLY_MAX,
  LeadQualificationFactsSchema,
  type AgentFilterReason,
  type AgentProposal,
} from '@shakti/contracts';
import { z } from 'zod';
import { filterOutbound } from '../../messaging/output-filter';
import { IST_OFFSET_MS } from '../../numbering/financial-year';
import { asciiDigits } from '../../privacy/model-text';
import { withinCallingHours } from '../../telecom/dial-policy';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { AGENT_DEFAULTS } from '../agent-defaults';

// The WhatsApp Concierge's deterministic output filter (docs/03-roadmap-appendix/phase2.md §7.2,
// SECURITY §7, PRD AI-05). The model's answer is untrusted: it must be one JSON object of a fixed
// shape, and each part is then held to what the run read. A reply is at most 600 characters; links
// only to the companies' own sites; no phone number but the company's; no identity or bank number;
// no rupee amount, percentage, kW, HP or date that neither a cited `customer` directive nor the
// thread's own facts give; no promise word (`WORKSHOP_DEFAULTS.whatsapp.promiseWords`); no
// instruction, code or bracket; and a reply that cites no directive is one of the fixed forms (a
// greeting, a qualification question, a booking confirmation, a handoff). Qualification facts keep
// to their bounds and to numbers the customer wrote; a callback is for the lead's owner, inside
// calling hours. What passes becomes the input of the action type's command; what fails is recorded
// with its reason and nothing else. A handoff is not filtered: any wish of the model to hand the
// thread over is honoured, since stopping the agent needs no approval.

/** What one kind of proposal comes to: a proposal, nothing, or the filter's reason. */
export type ConciergeDecision = AgentProposal | null | { filtered: AgentFilterReason };

/** Why the worker hands the thread to people, when the model asks to or says it is unsure. */
export const CONCIERGE_HANDOFF_CAUSES = [
  'asked_for_person',
  'complaint',
  'legal',
  'price',
  'subsidy',
  'out_of_scope',
  'low_confidence',
  'other',
] as const;
export type ConciergeHandoffCause = (typeof CONCIERGE_HANDOFF_CAUSES)[number];

export interface ConciergeVerdicts {
  reply: ConciergeDecision;
  qualification: ConciergeDecision;
  callback: ConciergeDecision;
  /** The model's handoff, or its low confidence: the worker hands the thread to people. */
  handoff: ConciergeHandoffCause | null;
}

/** The forms a reply that cites no directive must take. */
export const CONCIERGE_REPLY_FORMS = [
  'greeting',
  'qualification_question',
  'booking_confirmation',
  'handoff',
] as const;

/** What the filter holds an answer to: the run's own facts, never anything the model wrote. */
export interface ConciergeFilterFacts {
  entityId: number;
  threadId: string;
  accountId: string;
  /** The thread's lead; without one, no qualification or callback is proposed. */
  opportunityId: string | null;
  /** The lead's owner: the person a callback is for and whose inbox a suggestion goes to. */
  ownerId: string | null;
  /** The approved `customer` directives the run offered, by the label the prompt gave each. */
  directives: readonly { label: string; text: string }[];
  /** The thread's own facts as the run read them: the customer's messages and the lead's facts. */
  groundTexts: readonly string[];
  /** The company's own numbers, in E.164: the only phone numbers a reply may name. */
  companyNumbers: readonly string[];
  now: Date;
}

export interface ConciergeFilterRules {
  linkHosts: readonly string[];
  promiseWords: readonly string[];
  callbackDaysAhead: number;
}

export const DEFAULT_CONCIERGE_RULES: ConciergeFilterRules = {
  linkHosts: WORKSHOP_DEFAULTS.whatsapp.linkHosts,
  promiseWords: WORKSHOP_DEFAULTS.whatsapp.promiseWords,
  callbackDaysAhead: AGENT_DEFAULTS.concierge.callbackDaysAhead,
};

/** The answer's shape: strict, so a key the prompt does not ask for (a tool, a recipient) refuses it. */
const Answer = z
  .object({
    reply: z
      .object({
        text: z.string().max(20_000),
        form: z.enum(CONCIERGE_REPLY_FORMS).nullable(),
        directives: z.array(z.string().max(10)).max(10),
      })
      .strict()
      .nullable(),
    qualification: z.record(z.string().max(40), z.unknown()).nullable(),
    callback: z
      .object({ at: z.string().max(40) })
      .strict()
      .nullable(),
    handoff: z
      .object({ reason: z.string().max(40) })
      .strict()
      .nullable(),
    confidence: z.enum(['high', 'low']),
  })
  .strict();
type Answer = z.infer<typeof Answer>;

/**
 * The one JSON object of the answer, allowing for a code fence around it; undefined when the
 * answer is anything else (text around it, two objects, an array, another shape).
 */
export function parseConciergeAnswer(text: string): Answer | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = Answer.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// --- What a reply may not hold -----------------------------------------------------------------

/**
 * Words that speak to a model or its rules, a label of the prompt, a command's name, and code or
 * brackets of any kind: a reply to a customer never holds them. Kept wide, since a refused draft
 * costs only the draft (three in a row hand the thread to people).
 */
const INSTRUCTION = new RegExp(
  [
    String.raw`\b(?:ignore|disregard|forget)\s+(?:all|any|the|your|my|previous|prior|earlier|above)\b`,
    String.raw`\b(?:system|developer)\s*(?:prompt|message|mode|note)\b`,
    String.raw`\b(?:previous|prior|new|your|my|hidden)\s+instructions?\b`,
    String.raw`\b(?:jailbreak|override|bypass|pretend|untrusted(?:_data)?)\b`,
    String.raw`\bact\s+as\b`,
    String.raw`\b(?:system|assistant|user|tool)\s*:`,
    // A command or action type's name (`messaging.reply.send`).
    String.raw`\b(?:crm|sales|messaging|agents|admin|knowledge|finance|procurement|files|imports|pricing|catalogue|inventory|projects|calls|voice|audit|integrations|documents)\.[a-z_]+\.[a-z_]+`,
    // Brackets, braces, angle brackets, backticks, slashes of code, pipes and arrows.
    String.raw`[()[\]{}<>` + '`' + String.raw`\\|]`,
    String.raw`=>|&&|\$\{`,
  ].join('|'),
  'i',
);

/** A bank's branch code (IFSC) or a UPI or email address: bank and contact details. */
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/i;
const ADDRESS_AT = /[\w.+-]+@[\w-]+/;

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;

type FigureKind = 'rupees' | 'percent' | 'kw' | 'hp' | 'date';

/** Each kind of figure a reply may give only when the run read it, with how to read its value. */
const FIGURES: readonly {
  kind: FigureKind;
  pattern: RegExp;
  value: (m: RegExpMatchArray) => string;
}[] = [
  {
    kind: 'rupees',
    pattern: new RegExp(
      String.raw`(?:₹|\brs\.?|\binr\b|\brupees?\b|\brupaye\b|\brupaiye\b)\s*${NUM}(?:\s*(lakhs?|lacs?|crores?|cr|k)\b)?` +
        String.raw`|${NUM}\s*(lakhs?|lacs?|crores?|cr|k)?\s*(?:\/-|\brupees?\b|\brs\b|\binr\b|\brupaye\b)` +
        String.raw`|${NUM}\s*(lakhs?|lacs?|crores?)\b`,
      'gi',
    ),
    value: (m) => {
      const [, a, aUnit, b, bUnit, c, cUnit] = m;
      return String(amount(a ?? b ?? c ?? '', aUnit ?? bUnit ?? cUnit));
    },
  },
  {
    kind: 'percent',
    pattern: new RegExp(String.raw`${NUM}\s*(?:%|\bper\s*cent\b|\bpercent\b|\bpratishat\b)`, 'gi'),
    value: (m) => String(number(m[1] ?? '')),
  },
  {
    kind: 'kw',
    pattern: new RegExp(String.raw`${NUM}\s*(?:kwp?|kilo\s*watts?|kilowatts?)\b`, 'gi'),
    value: (m) => String(number(m[1] ?? '')),
  },
  {
    kind: 'hp',
    pattern: new RegExp(String.raw`${NUM}\s*(?:hp|horse\s*power)\b`, 'gi'),
    value: (m) => String(number(m[1] ?? '')),
  },
  {
    kind: 'date',
    pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    value: (m) => dayMonth(m[3], m[2]),
  },
  {
    kind: 'date',
    pattern: /\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b|\b(\d{1,2})\.(\d{1,2})\.\d{2,4}\b/g,
    value: (m) => dayMonth(m[1] ?? m[3], m[2] ?? m[4]),
  },
  {
    kind: 'date',
    pattern: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?${MONTH}\b`, 'gi'),
    value: (m) => dayMonth(m[1], monthIndex(m[2])),
  },
  {
    kind: 'date',
    pattern: new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'gi'),
    value: (m) => dayMonth(m[2], monthIndex(m[1])),
  },
];

function number(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

function amount(raw: string, unit: string | undefined): number {
  const u = (unit ?? '').toLowerCase();
  const times = u.startsWith('cr') ? 1e7 : u.startsWith('la') ? 1e5 : u === 'k' ? 1e3 : 1;
  return Math.round(number(raw) * times * 100) / 100;
}

function monthIndex(name: string | undefined): string {
  const i = MONTHS.findIndex((m) => (name ?? '').toLowerCase().startsWith(m));
  return String(i + 1);
}

function dayMonth(day: string | undefined, month: string | undefined): string {
  return `${String(Number(day))}/${String(Number(month))}`;
}

/** Text as figures are read in it: any script's digits as ASCII, full-width forms folded. */
const readable = (text: string): string => asciiDigits(text.normalize('NFKC'));

/** Every figure in `text`, as `kind:value`. */
export function figuresIn(text: string): string[] {
  const read = readable(text);
  return FIGURES.flatMap((f) =>
    [...read.matchAll(f.pattern)].map((m) => `${f.kind}:${f.value(m)}`),
  );
}

/** The promise words as one pattern: whole words, any case, plural and past forms too. */
function promisePattern(words: readonly string[]): RegExp | undefined {
  if (words.length === 0) return undefined;
  const escaped = words.map((w) =>
    w
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, String.raw`\s+`),
  );
  return new RegExp(String.raw`\b(?:${escaped.join('|')})(?:s|es|d|ed)?\b`, 'i');
}

/** The callback's day in India, as a date in a reply would give it. */
function istDayMonth(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCDate())}/${String(ist.getUTCMonth() + 1)}`;
}

/** Why a reply's words may not be sent, if they may not. */
export function replyProblem(
  text: string,
  allowedFigures: ReadonlySet<string>,
  facts: Pick<ConciergeFilterFacts, 'companyNumbers'>,
  rules: Pick<ConciergeFilterRules, 'linkHosts' | 'promiseWords'>,
): AgentFilterReason | undefined {
  if (text.length > CONCIERGE_REPLY_MAX) return 'reply_too_long';
  const outbound = filterOutbound([text], {
    linkHosts: rules.linkHosts,
    companyNumbers: facts.companyNumbers,
  });
  if (!outbound.ok) {
    if (outbound.rule === 'link') return 'link_not_allowed';
    if (outbound.rule === 'identity_number') return 'text_has_identity_number';
    if (outbound.rule === 'phone') return 'text_has_phone';
    return 'reply_too_long';
  }
  const read = readable(text);
  if (IFSC.test(read)) return 'text_has_identity_number';
  if (ADDRESS_AT.test(read)) return 'text_has_phone';
  if (INSTRUCTION.test(read)) return 'text_has_instruction';
  const promise = promisePattern(rules.promiseWords);
  if (promise?.test(read) === true) return 'text_has_promise';
  if (figuresIn(text).some((f) => !allowedFigures.has(f))) return 'fact_not_grounded';
  return undefined;
}

// --- Each kind of proposal ---------------------------------------------------------------------

const lead = (facts: ConciergeFilterFacts) =>
  ({
    subjectType: 'opportunity',
    subjectId: facts.opportunityId ?? '',
    ...(facts.ownerId === null ? {} : { assigneeId: facts.ownerId }),
  }) as const;

/** A callback that passes: for the lead's owner, in the future, in calling hours, soon enough. */
function callbackAt(
  answer: Answer,
  facts: ConciergeFilterFacts,
  rules: ConciergeFilterRules,
): Date | { filtered: AgentFilterReason } | null {
  const c = answer.callback;
  if (c === null || facts.opportunityId === null || facts.ownerId === null) return null;
  const offset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  const at = new Date(c.at);
  if (!offset.test(c.at) || Number.isNaN(at.getTime())) return { filtered: 'unreadable_answer' };
  const latest = facts.now.getTime() + rules.callbackDaysAhead * 86_400_000;
  if (at <= facts.now || at.getTime() > latest || !withinCallingHours(at)) {
    return { filtered: 'callback_outside_hours' };
  }
  return at;
}

function callback(
  at: Date | { filtered: AgentFilterReason } | null,
  facts: ConciergeFilterFacts,
): ConciergeDecision {
  if (at === null || !(at instanceof Date)) return at;
  return {
    input: {
      entityId: facts.entityId,
      opportunityId: facts.opportunityId,
      kind: 'callback',
      dueAt: at.toISOString(),
      assigneeId: facts.ownerId,
    },
    ...lead(facts),
  };
}

/** Facts within their bounds, each number one the customer's own words or the lead's facts give. */
function qualification(answer: Answer, facts: ConciergeFilterFacts): ConciergeDecision {
  const q = answer.qualification;
  if (q === null || facts.opportunityId === null) return null;
  const given = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== null));
  if (Object.keys(given).length === 0) return null;
  const parsed = LeadQualificationFactsSchema.safeParse(given);
  if (!parsed.success) return { filtered: 'fact_out_of_bounds' };
  const ground = facts.groundTexts.map(readable).join('\n');
  const numbersGiven = new Set(
    [...ground.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => String(number(m[0]))),
  );
  for (const value of Object.values(parsed.data)) {
    const ok =
      typeof value === 'number'
        ? numbersGiven.has(String(value))
        : ground.toLowerCase().includes(String(value).toLowerCase());
    if (!ok) return { filtered: 'fact_not_grounded' };
  }
  return {
    input: { entityId: facts.entityId, opportunityId: facts.opportunityId, facts: parsed.data },
    ...lead(facts),
  };
}

function reply(
  answer: Answer,
  facts: ConciergeFilterFacts,
  rules: ConciergeFilterRules,
  passedCallback: Date | null,
): ConciergeDecision {
  const r = answer.reply;
  if (r === null) return null;
  const text = r.text.trim();
  if (text === '') return null;
  const cited = [...new Set(r.directives)];
  const offered = new Map(facts.directives.map((d) => [d.label, d.text]));
  if (cited.some((label) => !offered.has(label))) return { filtered: 'unknown_directive' };

  const allowed = new Set([
    ...facts.groundTexts.flatMap(figuresIn),
    ...cited.flatMap((label) => figuresIn(offered.get(label) ?? '')),
    ...(passedCallback === null ? [] : [`date:${istDayMonth(passedCallback)}`]),
  ]);
  const problem = replyProblem(text, allowed, facts, rules);
  if (problem !== undefined) return { filtered: problem };

  if (cited.length === 0) {
    const fits =
      (r.form === 'greeting' && !text.includes('?')) ||
      (r.form === 'qualification_question' && text.includes('?')) ||
      (r.form === 'booking_confirmation' && passedCallback !== null) ||
      (r.form === 'handoff' && answer.handoff !== null);
    if (!fits) return { filtered: 'reply_not_fixed_form' };
  }
  return {
    input: {
      entityId: facts.entityId,
      threadId: facts.threadId,
      accountId: facts.accountId,
      body: text,
    },
    subjectType: 'account',
    subjectId: facts.accountId,
    ...(facts.ownerId === null ? {} : { assigneeId: facts.ownerId }),
  };
}

function handoff(answer: Answer): ConciergeHandoffCause | null {
  if (answer.handoff !== null) {
    const reason = answer.handoff.reason as ConciergeHandoffCause;
    return CONCIERGE_HANDOFF_CAUSES.includes(reason) && reason !== 'low_confidence'
      ? reason
      : 'other';
  }
  return answer.confidence === 'low' ? 'low_confidence' : null;
}

/**
 * Each kind's verdict on the model's answer, and whether to hand the thread to people. An answer
 * that is not one JSON object of the shape refuses all three kinds and hands nothing over (the
 * worker counts it among the answers it could not use).
 */
export function filterConciergeAnswer(
  text: string,
  facts: ConciergeFilterFacts,
  rules: ConciergeFilterRules = DEFAULT_CONCIERGE_RULES,
): ConciergeVerdicts {
  const answer = parseConciergeAnswer(text);
  if (answer === undefined) {
    const unreadable = { filtered: 'unreadable_answer' } as const;
    return { reply: unreadable, qualification: unreadable, callback: unreadable, handoff: null };
  }
  const at = callbackAt(answer, facts, rules);
  return {
    reply: reply(answer, facts, rules, at instanceof Date ? at : null),
    qualification: qualification(answer, facts),
    callback: callback(at, facts),
    handoff: handoff(answer),
  };
}
