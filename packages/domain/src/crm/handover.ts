import type { CallerPresence, CustomerLanguage, Segment } from '@shakti/contracts';

/**
 * Who takes a qualified lead (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): pure functions, so every
 * rule is tested without a database or Redis. The worker passes the cursor it keeps in Redis and
 * stores the one the function's answer implies.
 */

/** A person who might take a lead, with their profile and the open leads they hold now. */
export interface ConverterCandidate {
  userId: string;
  isConverter: boolean;
  presence: CallerPresence;
  /** The most open leads they take; null takes any number. */
  maxOpen: number | null;
  /** The languages they take; empty takes all. */
  languages: readonly CustomerLanguage[];
  /** The business lines they take; empty takes all. */
  segments: readonly Segment[];
  openLeads: number;
}

/** What a lead asks of a converter: its customer's language and its pipeline's business line. */
export interface HandoverLead {
  language: CustomerLanguage;
  segment: Segment;
}

/** Whether the candidate may take this lead now: every rule but the order they are tried in. */
export function qualifiesAsConverter(candidate: ConverterCandidate, lead: HandoverLead): boolean {
  return (
    candidate.isConverter &&
    candidate.presence === 'present' &&
    (candidate.maxOpen === null || candidate.openLeads < candidate.maxOpen) &&
    (candidate.languages.length === 0 || candidate.languages.includes(lead.language)) &&
    (candidate.segments.length === 0 || candidate.segments.includes(lead.segment))
  );
}

/**
 * The Lead Converter who takes the lead: of those who qualify, the one with the fewest open
 * leads; among those tied, the first after `cursor` (the person chosen last) in id order,
 * starting again from the first after the last, so ties go round in turn. Null when nobody
 * qualifies.
 */
export function pickConverter(
  candidates: readonly ConverterCandidate[],
  lead: HandoverLead,
  cursor: string | null,
): string | null {
  const qualified = candidates.filter((c) => qualifiesAsConverter(c, lead));
  if (qualified.length === 0) return null;
  const fewest = Math.min(...qualified.map((c) => c.openLeads));
  const tied = qualified
    .filter((c) => c.openLeads === fewest)
    .map((c) => c.userId)
    .sort();
  if (cursor === null) return tied[0] ?? null;
  return tied.find((id) => id > cursor) ?? tied[0] ?? null;
}
