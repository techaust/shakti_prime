import { defineMachine } from '../define-machine';

export const DUPLICATE_CANDIDATE_STATES = ['open', 'merged', 'dismissed'] as const;
export type DuplicateCandidateMachineState = (typeof DUPLICATE_CANDIDATE_STATES)[number];
export type DuplicateCandidateEvent = 'merge' | 'dismiss' | 'unmerge';

/** What the duplicate commands preload for the machine. */
export interface DuplicateCandidateRecord {
  state: DuplicateCandidateMachineState | null;
}

/**
 * A pair of customers, or of leads of one company, that may be one (PRD CRM-03,
 * docs/03-roadmap-appendix/phase1.md §7.4). Candidates are found by lead creation, the nightly search and an
 * agent's suggestion, always open; a person merges the pair or says it is not the same, and undoing
 * a customer merge opens its card again.
 */
export const duplicateCandidateMachine = defineMachine<
  DuplicateCandidateMachineState,
  DuplicateCandidateEvent,
  DuplicateCandidateRecord,
  undefined
>({
  name: 'duplicate_candidate',
  title: 'Duplicate candidate',
  summary:
    '`duplicate_candidates.state`. Two customers, or two leads of one company, that look like one, with the reason and how sure the match is. Found open by `crm.lead.create`, the nightly `crm.duplicate.scan` and `crm.duplicate.suggest`; decided by a person holding `crm.lead.merge`.',
  sources: ['docs/03-roadmap-appendix/phase1.md §7.4', 'PRD CRM-03', 'DATABASE §6.2 `duplicate_candidates`'],
  states: DUPLICATE_CANDIDATE_STATES,
  initial: 'open',
  terminal: ['dismissed'],
  stored: { table: 'duplicate_candidates', stateColumn: 'state' },
  transitions: [
    {
      from: ['open'],
      event: 'merge',
      to: 'merged',
      permission: 'crm.lead.merge',
      note: 'By `crm.customer.merge` or `crm.lead.merge`, for people only; the merge records who decided and when.',
    },
    {
      from: ['open'],
      event: 'dismiss',
      to: 'dismissed',
      permission: 'crm.lead.merge',
      note: 'The pair is not the same (`crm.duplicate.dismiss`, people only).',
    },
    {
      from: ['merged'],
      event: 'unmerge',
      to: 'open',
      permission: 'crm.lead.merge',
      note: 'Undoing the customer merge made from the card (`crm.customer.unmerge`) opens the card again.',
    },
  ],
});
