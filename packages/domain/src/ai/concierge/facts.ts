import { COPILOT_FACTS, type CopilotFact } from '@shakti/contracts';
import { istCalendarDate } from '../../numbering/financial-year';
import { istMinuteOfDay } from '../../telecom/dial-policy';
import type { ConciergeFilterFacts } from './filter';

// What one run of the WhatsApp Concierge reads (docs/03-roadmap-appendix/phase2.md §7.2), read as
// the agent itself in a run bound to the one chat (`readConciergeFacts`): the chat's last messages,
// the lead's segment, stage and recorded facts, its open callbacks and the approved `customer`
// directives; no other customer, no note, no price list, no cost. The prompt is built from these
// alone, and the output filter holds the answer to the same facts (`conciergeFilterFacts`).

/** One message of the chat, oldest first; the last inbound one is the message the run answers. */
export interface ConciergeMessageLine {
  direction: 'inbound' | 'outbound';
  /** Minutes before the run, never below zero. */
  minutesAgo: number;
  /**
   * The customer's text as stored (masked, Devanagari kept as received), a business text with its
   * amounts masked, or a word for a template or a file.
   */
  text: string;
}

/** An approved `customer` directive the run offers, with the label the prompt gives it. */
export interface ConciergeDirective {
  label: string;
  type: string;
  title: string;
  text: string;
}

export interface ConciergeRunFacts {
  entityId: number;
  threadId: string;
  /** The chat's customer: the subject of a reply. */
  accountId: string;
  /** The customer's name as recorded, which may come from their WhatsApp profile: untrusted. */
  customerName: string | null;
  /** The chat's open lead, if any: the subject of qualification facts and a callback. */
  opportunityId: string | null;
  /** The lead's owner, whom a callback is for; never shown to the model. */
  ownerId: string | null;
  now: Date;
  lead: { segment: string; pipelineName: string; stageName: string } | null;
  /** The qualification facts the lead already records. */
  current: Partial<Record<CopilotFact, number | null>>;
  /** The lead's open callbacks, soonest first. */
  callbacks: readonly { dueAt: Date }[];
  directives: readonly ConciergeDirective[];
  messages: readonly ConciergeMessageLine[];
  /** The company's own numbers, in E.164: the only phone numbers a reply may name. */
  companyNumbers: readonly string[];
}

/** A time in India as the prompt and the ground facts write it: `2026-11-19 11:00`. */
export function istDateTime(at: Date): string {
  const minute = istMinuteOfDay(at);
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return `${istCalendarDate(at)} ${hh}:${mm}`;
}

/** What each recorded fact is called, as the prompt and the ground facts write it. */
export const FACT_NAMES: Readonly<Record<CopilotFact, string>> = {
  pumpDepthFt: 'depth of the bore (feet)',
  requiredHp: 'power needed (HP)',
  monthlyBillRupees: 'monthly electricity bill (rupees)',
  roofAreaSqFt: 'roof area (square feet)',
  sanctionedLoadKw: 'sanctioned load (kW)',
};

/** The lead's recorded facts and open callbacks, as lines of the thread's own facts. */
export function leadFactLines(facts: ConciergeRunFacts): string[] {
  const recorded = COPILOT_FACTS.flatMap((fact) => {
    const value = facts.current[fact];
    return value === null || value === undefined ? [] : [`${FACT_NAMES[fact]} ${String(value)}`];
  });
  return [
    ...recorded,
    ...facts.callbacks.map((c) => `callback on ${istDateTime(c.dueAt)} in India`),
  ];
}

/** What the output filter holds an answer to, from the run's facts. */
export function conciergeFilterFacts(facts: ConciergeRunFacts): ConciergeFilterFacts {
  return {
    entityId: facts.entityId,
    threadId: facts.threadId,
    accountId: facts.accountId,
    opportunityId: facts.opportunityId,
    ownerId: facts.ownerId,
    directives: facts.directives.map((d) => ({ label: d.label, text: d.text })),
    // The customer's own words and the lead's facts; never the business's texts, which a person
    // may have typed a price into.
    groundTexts: [
      ...facts.messages.filter((m) => m.direction === 'inbound').map((m) => m.text),
      ...leadFactLines(facts),
    ],
    companyNumbers: facts.companyNumbers,
    customerName: facts.customerName,
    now: facts.now,
  };
}
