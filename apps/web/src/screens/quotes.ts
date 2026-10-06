// Addresses and display rules of the quote screens (docs/03-roadmap-appendix/phase1.md §7.3). Browser code:
// types only from the contracts.
import type { QuoteState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The quote page of one quote. */
export function quoteHref(entityId: number, quoteId: string): Route {
  return `/quotes/${String(entityId)}/${quoteId}` as Route;
}

/** The quote builder of one lead. */
export function quoteBuilderHref(entityId: number, opportunityId: string): Route {
  return `/quotes/new?company=${String(entityId)}&lead=${opportunityId}` as Route;
}

/** How each state of a quote reads as a badge. */
export const QUOTE_STATE_TONE: Record<QuoteState, StatusTone> = {
  draft: 'neutral',
  sent: 'accent',
  accepted: 'success',
  expired: 'warning',
  superseded: 'neutral',
  withdrawn: 'neutral',
};

/** A quantity as people read it: `5.000` → `5`, `2.500` → `2.5`. */
export function plainQuantity(qty: string): string {
  return qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
}
