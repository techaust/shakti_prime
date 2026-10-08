import { z } from 'zod';

/**
 * Duplicate customers and leads (PRD CRM-03, docs/03-roadmap-appendix/phase1.md §7.4). A candidate pairs two
 * customers, or two leads of one company, that look like the same one; a person merges them or
 * says they are not the same.
 */
export const DuplicateKindSchema = z.enum(['customer', 'lead']);
export type DuplicateKind = z.infer<typeof DuplicateKindSchema>;

/**
 * Why a pair was put forward: a phone number they share (two leads of one customer share every
 * number), or the same name in the same village.
 */
export const DuplicateReasonSchema = z.enum(['phone', 'name_village']);
export type DuplicateReason = z.infer<typeof DuplicateReasonSchema>;

/** The facts a candidate's confidence is made from, each named on its card. */
export const DuplicateSignalSchema = z.enum([
  'same_phone',
  'same_name',
  'same_village',
  'same_customer',
]);
export type DuplicateSignal = z.infer<typeof DuplicateSignalSchema>;

/** Where a candidate stands (`duplicate_candidates.state`), written only by its machine. */
export const DuplicateStateSchema = z.enum(['open', 'merged', 'dismissed']);
export type DuplicateState = z.infer<typeof DuplicateStateSchema>;

/**
 * A repeat enquiry for the same segment attaches to the customer's open lead when that lead had
 * activity within this many days (PRD CRM-03's own figure, not a workshop input).
 */
export const REPEAT_ENQUIRY_DAYS = 30;

/** What `crm.lead.create` did: made a lead, or added the enquiry to an open one (CRM-03). */
export const CreateLeadOutcomeSchema = z.enum(['created', 'attached']);
export type CreateLeadOutcome = z.infer<typeof CreateLeadOutcomeSchema>;
