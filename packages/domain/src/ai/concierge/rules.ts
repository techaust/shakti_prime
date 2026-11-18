import type { WhatsAppHandoffReason } from '@shakti/contracts';
import { matchKeyword } from '../../messaging/keywords';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import type { ConciergeHandoffCause } from './filter';

// The rules that hand a chat from the WhatsApp Concierge to people at once (docs/03-roadmap-
// appendix/phase2.md §7.2), deterministic and read before any model is asked: the customer's
// HUMAN, a complaint or a legal matter, and a question of price or subsidy, which only a person
// answers. The model may hand the chat over too (its `handoff`, or its low confidence), and three
// answers in a row the filter refused do; each becomes one of the thread's hand-off reasons.

/** Why a rule hands the chat over, read from the customer's message. */
export type ConciergeRuleCause = 'human' | 'complaint' | 'legal' | 'price' | 'subsidy';

export type HandoffWords = Readonly<
  Record<Exclude<ConciergeRuleCause, 'human'>, readonly string[]>
>;

/** A message read for words: lower case, punctuation and emoji gone, spaces collapsed. */
function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether `read` holds `phrase` as whole words. */
function holds(read: string, phrase: string): boolean {
  const wanted = normalise(phrase);
  return wanted !== '' && ` ${read} `.includes(` ${wanted} `);
}

/**
 * The rule the customer's message meets, if any: HUMAN as the whole message (W1's keyword), then a
 * legal matter, a complaint, a price and a subsidy, each a word or phrase of
 * `WORKSHOP_DEFAULTS.whatsapp.handoffWords` anywhere in the message. A file with no words meets none.
 */
export function handoffRuleOf(
  text: string | null,
  words: HandoffWords = WORKSHOP_DEFAULTS.whatsapp.handoffWords,
): ConciergeRuleCause | null {
  if (text === null) return null;
  if (matchKeyword(text) === 'human') return 'human';
  const read = normalise(text);
  if (read === '') return null;
  for (const cause of ['legal', 'complaint', 'price', 'subsidy'] as const) {
    if (words[cause].some((w) => holds(read, w))) return cause;
  }
  return null;
}

/** Every cause the worker hands a chat over for. */
export type ConciergeHandoff = ConciergeRuleCause | ConciergeHandoffCause | 'refusals';

/**
 * The thread's hand-off reason for a cause: the customer's HUMAN is the keyword's, a person asked
 * for is a request, a complaint or legal matter a complaint, refused answers the filter's, and a
 * question only a person answers (a price, a subsidy, anything outside the rules, the model unsure)
 * a question.
 */
export function handoffReasonOf(cause: ConciergeHandoff): WhatsAppHandoffReason {
  switch (cause) {
    case 'human':
      return 'keyword';
    case 'asked_for_person':
      return 'request';
    case 'complaint':
    case 'legal':
      return 'complaint';
    case 'refusals':
      return 'filter_refusals';
    case 'price':
    case 'subsidy':
    case 'out_of_scope':
    case 'low_confidence':
    case 'other':
      return 'question';
  }
}
