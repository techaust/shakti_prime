import type { DuplicateKind, DuplicateReason, DuplicateSignal } from '@shakti/contracts';

/**
 * How sure a duplicate match is (PRD CRM-03, docs/03-roadmap-appendix/phase1.md §7.4): a pure function of the
 * facts two customers, or two leads, share. The database only finds the facts; the confidence is
 * worked out here, so it is tested once and the nightly search and lead creation agree.
 *
 * The weights are an engineering judgement of how strongly each fact points to one customer, not
 * a business threshold: nothing is merged on a confidence, a person decides on every card.
 * - A phone number is strong but not proof, since families share numbers (one number, two
 *   contacts); with the same name as well it is near certain.
 * - The same name in the same village is a fair sign on its own, weaker than a number.
 * - Two leads of one customer and segment, open or in nurture with at least one open, are the
 *   same enquiry told twice.
 */
export interface DuplicateFacts {
  kind: DuplicateKind;
  /** A phone number on a contact of each customer is the same. */
  samePhone: boolean;
  /** The customers' names match, whatever their case and spacing. */
  sameName: boolean;
  /** A site of each customer is in a village of the same name. */
  sameVillage: boolean;
  /** For a lead pair: both leads belong to the one customer. */
  sameCustomer: boolean;
}

export interface DuplicateConfidence {
  reason: DuplicateReason;
  /** 1 to 100. */
  confidence: number;
  /** The facts behind it, strongest first, each named on the card. */
  signals: DuplicateSignal[];
}

/** The points each combination earns; the first that matches wins. */
const RULES: readonly {
  when: (f: DuplicateFacts) => boolean;
  confidence: number;
  basis: DuplicateReason;
}[] = [
  { when: (f) => f.kind === 'lead' && f.sameCustomer, confidence: 95, basis: 'phone' },
  { when: (f) => f.samePhone && f.sameName, confidence: 95, basis: 'phone' },
  { when: (f) => f.samePhone && f.sameVillage, confidence: 85, basis: 'phone' },
  { when: (f) => f.samePhone, confidence: 70, basis: 'phone' },
  { when: (f) => f.sameName && f.sameVillage, confidence: 60, basis: 'name_village' },
];

/**
 * The confidence and reasons of a pair, or undefined when the facts are not enough to put it
 * forward: a name alone, or a village alone, never is.
 */
export function duplicateConfidence(facts: DuplicateFacts): DuplicateConfidence | undefined {
  const rule = RULES.find((r) => r.when(facts));
  if (rule === undefined) return undefined;
  const signals: DuplicateSignal[] = [];
  if (facts.kind === 'lead' && facts.sameCustomer) signals.push('same_customer');
  if (facts.samePhone) signals.push('same_phone');
  if (facts.sameName) signals.push('same_name');
  if (facts.sameVillage) signals.push('same_village');
  return { reason: rule.basis, confidence: rule.confidence, signals };
}

/**
 * The text two names or villages are compared by: lower case, spaces trimmed and runs of spaces
 * made one. The database compares the same form (`app.match_text()`), which a test keeps equal.
 */
export function matchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
