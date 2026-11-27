// What the purchase order and goods receipt screens work out from the DTOs they are given
// (docs/03-roadmap-appendix/phase3.md §7.2). Nothing here computes a price, a tax or a total: the
// amounts arrive computed by the tax engine (`getPurchaseOrder`), and are only placed and formatted.

import type { StatusTone } from '@shakti/ui';
import type { PurchaseOrderState } from '@shakti/contracts';

/** The badge tone of each state. */
export const ORDER_STATE_TONE: Record<PurchaseOrderState, StatusTone> = {
  draft: 'neutral',
  approved: 'info',
  sent: 'accent',
  partially_received: 'warning',
  received: 'success',
  closed: 'neutral',
  cancelled: 'danger',
};

/** A stored quantity as people read it: `5.000` is `5`, `2.500` is `2.5`. */
export function plainQty(qty: string): string {
  return qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
}

/** The states an order's PDF prints in: from its approval on, a cancelled one marked so. */
const PRINTED: ReadonlySet<PurchaseOrderState> = new Set([
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
]);

/**
 * Whether an order in `state`, approved at `approvedAt` (or never), prints: never a draft, and
 * never an order cancelled before it was approved, so no unapproved order reaches a vendor.
 */
export function purchaseOrderPrints(state: PurchaseOrderState, approvedAt: string | null): boolean {
  return PRINTED.has(state) && approvedAt !== null;
}

/** What a person may do with an order in its state, given what they hold. */
export interface OrderPowers {
  canWrite: boolean;
  canApprove: boolean;
  canReceive: boolean;
}

export interface OrderActions {
  edit: boolean;
  approve: boolean;
  send: boolean;
  receive: boolean;
  cancel: boolean;
  close: boolean;
  /** Download PDF: only where it prints (`purchaseOrderPrints`). */
  pdf: boolean;
}

/** The actions the order sheet offers: each also checked again by its command. */
export function orderActions(
  state: PurchaseOrderState,
  powers: OrderPowers,
  approvedAt: string | null = null,
): OrderActions {
  return {
    pdf: purchaseOrderPrints(state, approvedAt),
    edit: state === 'draft' && powers.canWrite,
    approve: state === 'draft' && powers.canApprove,
    send: state === 'approved' && powers.canWrite,
    receive: (state === 'sent' || state === 'partially_received') && powers.canReceive,
    cancel: (state === 'draft' || state === 'approved' || state === 'sent') && powers.canWrite,
    close: (state === 'partially_received' || state === 'received') && powers.canWrite,
  };
}

const THOUSANDTHS = /^(\d{1,9})(?:\.(\d{1,3}))?$/;

function milli(value: string): bigint | undefined {
  const match = THOUSANDTHS.exec(value.trim());
  if (match === null) return undefined;
  const [, whole = '0', part = ''] = match;
  return BigInt(whole) * 1000n + BigInt(part.padEnd(3, '0'));
}

/**
 * The stock units a typed quantity of purchase units comes to, for the count of serials to scan:
 * a whole number, or undefined when the quantity is not one or does not make whole units.
 */
export function unitsToScan(typedQty: string, unitFactor: string): number | undefined {
  const qty = milli(typedQty);
  const factor = milli(unitFactor);
  if (qty === undefined || factor === undefined || qty <= 0n) return undefined;
  const product = qty * factor; // in millionths
  return product % 1_000_000n === 0n ? Number(product / 1_000_000n) : undefined;
}

/** What is still to come on a line, in purchase units, as a quantity string. */
export function outstanding(qty: string, received: string): string {
  const left = (milli(qty) ?? 0n) - (milli(received) ?? 0n);
  const value = left > 0n ? left : 0n;
  return plainQty(`${(value / 1000n).toString()}.${(value % 1000n).toString().padStart(3, '0')}`);
}
