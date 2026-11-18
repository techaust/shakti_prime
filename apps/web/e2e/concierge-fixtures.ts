// What the WhatsApp Concierge journey (`e2e/concierge.spec.ts`) and its seed
// (`e2e/setup/concierge.ts`) agree on. No database code here, so the journey runs inside the Linux
// snapshot container too.
import type { ProjectName } from './support/users';

/** What the tele-caller does with the assistant's draft on each chat. */
export const CONCIERGE_DECISIONS = ['send', 'edit', 'discard'] as const;
export type ConciergeDecision = (typeof CONCIERGE_DECISIONS)[number];

/**
 * The customers of the tele-caller in company 1 whose chats the assistant answers, one per project
 * and decision so the runs never share, made afresh on every run with a new number: each wrote on
 * WhatsApp, and the assistant's reply waits for the tele-caller under Needs approval. Synthetic
 * names for the journeys alone.
 */
export const CONCIERGE_CUSTOMERS: Record<ProjectName, Record<ConciergeDecision, string>> = {
  'desktop-light': {
    send: 'Bholaram Khatik',
    edit: 'Prakash Chand Regar',
    discard: 'Santosh Kanwar',
  },
  'desktop-dark': {
    send: 'Chhotu Ram Bhil',
    edit: 'Laxman Singh Shekhawat',
    discard: 'Pushpa Devi Mali',
  },
  phone: {
    send: 'Govind Ram Jangid',
    edit: 'Ratan Lal Bairwa',
    discard: 'Manju Kanwar',
  },
};

export const CONCIERGE_JOURNEY = {
  /** What each customer wrote. */
  message: 'I need a solar pump for my farm. Can someone guide me?',
  /** The assistant's draft on each chat. */
  draft: 'Thank you for writing to us. How deep is the bore on your farm, in feet?',
  /** The tele-caller's own words on the chat they edit. */
  edited: 'Thank you. How deep is your bore, and how much water do you need each day?',
  /**
   * The snapshot company's chat (the messages journey's), where the seed keeps one draft the
   * assistant recorded in Shadow, refreshed on every run: the report pictures it alone.
   */
  shadowDraft:
    'Thank you for asking. Our engineer will tell you the visit day when the team calls.',
} as const;
