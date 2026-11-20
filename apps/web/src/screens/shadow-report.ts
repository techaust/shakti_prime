// The shadow report's reading (docs/03-roadmap-appendix/phase1.md §9, A1). Pure functions, so the
// screen and its tests share them; browser code, so no contracts values.

import { SHADOW_REPORT_MAX_DAYS_VALUE } from './contract-values';
import { istDay } from './ist';

/** Proposals a page of the report shows. */
export const SHADOW_PAGE_SIZE = 50;

const DAY_MS = 86_400_000;

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

// The G2 shadow review pack (docs/03-roadmap-appendix/phase2.md §8.1): the review sample's pages.

/** The agents with a review sample, by the path segment of their report. */
export type SampleAgent = 'concierge' | 'copilot';

/** The review sample of a report's company and period. */
export function sampleHref(agent: SampleAgent, entityId: number, from: string, to: string): string {
  const query = new URLSearchParams({ company: String(entityId), from, to });
  return `/admin/agents/${agent}/sample?${query.toString()}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The company and period a sample page's address names, else the viewer's first company and the
 * last 30 days. A company outside `entityIds` or a period the report would refuse falls back too,
 * so the page never asks for what it may not read.
 */
export function sampleQuery(
  params: Record<string, string | string[] | undefined>,
  entityIds: readonly number[],
  fallbackEntityId: number | undefined,
  now: Date,
): { entityId: number | undefined; from: string; to: string } {
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const company = Number(one(params.company));
  const entityId = entityIds.includes(company) ? company : fallbackEntityId;
  const from = one(params.from);
  const to = one(params.to);
  const valid =
    from !== undefined &&
    to !== undefined &&
    DAY.test(from) &&
    DAY.test(to) &&
    !Number.isNaN(Date.parse(`${from}T00:00:00Z`)) &&
    !Number.isNaN(Date.parse(`${to}T00:00:00Z`)) &&
    periodProblem(from, to) === undefined;
  return valid ? { entityId, from, to } : { entityId, ...defaultShadowPeriod(now) };
}
