// The shadow report's reading (docs/03-roadmap-appendix/phase1.md §9, A1). Pure functions, so the
// screen and its tests share them; browser code, so no contracts values.

import { SHADOW_REPORT_MAX_DAYS_VALUE } from './contract-values';

/** Proposals a page of the report shows. */
export const SHADOW_PAGE_SIZE = 50;

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** The day in India a moment falls on, as `YYYY-MM-DD`. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The report's first period: the last 30 days in India, today included. */
export function defaultShadowPeriod(now: Date): { from: string; to: string } {
  const to = istDay(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

export type PeriodProblem = 'periodMissing' | 'periodReversed' | 'periodTooLong';

/** What is wrong with a period typed on the screen, if anything. */
export function periodProblem(
  from: string | undefined,
  to: string | undefined,
): PeriodProblem | undefined {
  if (from === undefined || to === undefined) return 'periodMissing';
  if (from > to) return 'periodReversed';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  return days > SHADOW_REPORT_MAX_DAYS_VALUE ? 'periodTooLong' : undefined;
}

/** A score change with its sign, as the report shows it (`+5`, `-3`). */
export function signedPoints(change: number): string {
  return change > 0 ? `+${String(change)}` : String(change);
}

/** The share of decided proposals people agreed with, as a whole percentage, or undefined. */
export function agreementShare(agreed: number, disagreed: number): number | undefined {
  const decided = agreed + disagreed;
  return decided === 0 ? undefined : Math.round((agreed / decided) * 100);
}
