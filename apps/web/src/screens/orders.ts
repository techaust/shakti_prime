// Addresses and display rules of the order and dealer credit screens (docs/design/phase1.md §8.3).
// Browser code: types only from the contracts.
import type { SalesOrderState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The order page of one order. */
export function orderHref(entityId: number, orderId: string): Route {
  return `/orders/${String(entityId)}/${orderId}` as Route;
}

/** The order form of one dealer in one company. */
export function dealerOrderHref(entityId: number, accountId: string): Route {
  return `/orders/new?company=${String(entityId)}&dealer=${accountId}` as Route;
}

/** How each state of an order reads as a badge. */
export const ORDER_STATE_TONE: Record<SalesOrderState, StatusTone> = {
  draft: 'neutral',
  confirmed: 'success',
  partially_dispatched: 'accent',
  dispatched: 'accent',
  invoiced: 'accent',
  closed: 'neutral',
  cancelled: 'neutral',
};

/** The states `/orders` offers to show: those an order reaches in Phase 1. */
export const ORDER_FILTER_STATES = [
  'draft',
  'confirmed',
  'cancelled',
] as const satisfies readonly SalesOrderState[];
