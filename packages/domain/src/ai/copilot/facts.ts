import type { CopilotFact, CopilotNoteKind } from '@shakti/contracts';
import type { CopilotContext, OfferedTemplate } from './filter';

// What one run of the Caller Co-pilot reads (docs/03-roadmap-appendix/phase2.md §7.3), read as the
// agent itself (`readCopilotFacts`). The prompt is built from these alone, and the output filter
// holds the answer to the same facts (`copilotContext`). Nothing here is a price or a cost: a quote
// is only its validity, labelled Q1, Q2, …; people are never named or given by id.

/** One logged call of the lead, as the brief reads it. */
export interface CopilotCallLine {
  daysAgo: number;
  /** The outcome's label, as the caller picked it. */
  outcomeLabel: string;
  attemptNo: number;
  durationS: number | null;
}

/** One chat message of the customer's WhatsApp chat with the company, newest last. */
export interface CopilotMessageLine {
  direction: 'inbound' | 'outbound';
  daysAgo: number;
  /** The masked text, or a template's label for a template the business sent. */
  text: string;
}

/** An approved Playbook directive for staff, which the brief follows. */
export interface CopilotDirective {
  type: string;
  title: string;
  text: string;
}

/** An outcome the caller may log, as the model sees it: its code and label. */
export interface CopilotOutcome {
  code: string;
  label: string;
  dispositionId: string;
}

/** A WhatsApp template the run offers, with its label for the model. */
export interface CopilotTemplate extends OfferedTemplate {
  label: string;
}

export interface CopilotRunFacts {
  kind: CopilotNoteKind;
  entityId: number;
  opportunityId: string;
  now: Date;
  /** The lead's owner, whom a follow-up is for; never shown to the model. */
  ownerId: string | null;
  lead: {
    segment: string;
    pipelineName: string;
    stageName: string;
    state: 'open' | 'nurture' | 'won' | 'lost';
    score: number;
    ageDays: number;
    /** Days since the lead entered nurture, while it is in nurture. */
    nurtureDay: number | null;
    nurtureSince: Date | null;
  };
  /** The qualification facts the lead already records. */
  current: Partial<Record<CopilotFact, number | null>>;
  calls: readonly CopilotCallLine[];
  outcomes: readonly CopilotOutcome[];
  messages: readonly CopilotMessageLine[];
  directives: readonly CopilotDirective[];
  templates: readonly CopilotTemplate[];
  quotes: readonly { label: string; quoteId: string; validUntil: Date }[];
  whatsapp: CopilotContext['whatsapp'];
  /** A summary's call: the masked transcript (its end, at most `transcriptCharsRead`). */
  transcript?: string;
}

/** What the output filter holds an answer to, from the run's facts. */
export function copilotContext(facts: CopilotRunFacts): CopilotContext {
  return {
    kind: facts.kind,
    entityId: facts.entityId,
    opportunityId: facts.opportunityId,
    now: facts.now,
    ownerId: facts.ownerId,
    current: facts.current,
    outcomes: facts.outcomes.map((o) => ({ code: o.code, dispositionId: o.dispositionId })),
    leadState: facts.lead.state,
    nurtureSince: facts.lead.nurtureSince,
    quotes: facts.quotes,
    templates: facts.templates,
    whatsapp: facts.whatsapp,
  };
}
