import type { Segment } from '@shakti/contracts';

// What the Triage agent knows of one new lead (docs/03-roadmap-appendix/phase1.md §9, A1; SECURITY
// §3.3 and §6). Read as the agent itself, under its own policies, and never a customer's name,
// phone number, address or identity number: the agent reads no customer (0057), and the lead's
// own rows carry none. Ids reach the model only as labels (P1, D1), so the model cannot name a
// person or a lead the run did not offer; the filter maps a label back to its id.

/** A pipeline of the company the lead could belong to. */
export interface TriagePipeline {
  key: string;
  segment: Segment;
}

/** A duplicate card D1 put forward for the lead: another open lead of the customer and segment. */
export interface TriageCandidate {
  /** `D1`, `D2`, … in the order shown. */
  label: string;
  /** The card's id, for the report. */
  candidateId: string;
  otherOpportunityId: string;
  confidence: number;
  /** The other lead's age in whole days. */
  otherAgeDays: number;
}

/** A person of the company who works on leads and could take this one. */
export interface TriagePerson {
  /** `P1`, `P2`, … in the order shown. */
  label: string;
  personId: string;
  /** The role key that lets them work on leads in the company (`tele_caller_cc`). */
  roleKey: string;
  openLeads: number;
  /** From their caller profile, when the agent may read it. */
  converter: boolean | null;
  present: boolean | null;
  /** The most open leads they take; null for no cap or no profile. */
  maxOpen: number | null;
  /** The business lines they take; empty for all. */
  segments: readonly Segment[];
}

export interface TriageFacts {
  entityId: number;
  opportunityId: string;
  /** The lead's pipeline and its segment, as the person who made the lead chose. */
  pipelineKey: string;
  segment: Segment;
  stageKey: string;
  /** The rules-based score and the factors that gave it. */
  score: number;
  scoreFactors: readonly { factor: string; points: number }[];
  sourceCode: string | null;
  sourceChannel: string | null;
  referred: boolean;
  /** Whether the lead is for a customer the business already had. */
  existingCustomer: boolean;
  /** The customer's other leads in the company, by segment and state. */
  otherLeads: readonly { segment: Segment; state: string }[];
  /** The hour of day and weekday in India the lead came in (0 to 23; Monday is 1). */
  createdHourIst: number;
  createdWeekdayIst: number;
  pipelines: readonly TriagePipeline[];
  candidates: readonly TriageCandidate[];
  people: readonly TriagePerson[];
  /**
   * Fields the customer or an outside source wrote (the campaign's source fields), each labelled
   * as untrusted data in the prompt and masked before it is sent. Never names or addresses.
   */
  untrusted: readonly { field: string; text: string }[];
}
