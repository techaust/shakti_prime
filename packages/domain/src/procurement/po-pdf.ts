import type { PurchaseOrderState } from '@shakti/contracts';
import { createHash } from 'node:crypto';

/**
 * A purchase order's PDF (docs/03-roadmap-appendix/phase3.md §7.2, ADR 0009): the render worker
 * prints it from the order's approval on and stores it as a `purchase_order_pdf` file. It has two
 * versions: 1, the order as approved, and 2, the same order marked cancelled once it is cancelled.
 * Each version is one file whose id is worked out from the order and the version, so every request
 * to print it (approval, sending, cancelling, a person asking to download it) finds or makes the
 * same file, and the download serves the order's current version.
 */
export type PurchaseOrderPdfVersion = 1 | 2;

export const PO_PDF_AS_APPROVED: PurchaseOrderPdfVersion = 1;
export const PO_PDF_CANCELLED: PurchaseOrderPdfVersion = 2;

/** The states an order prints in once it was approved. */
const PRINTED: ReadonlySet<PurchaseOrderState> = new Set([
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
]);

/**
 * The version of the PDF an order in `state`, approved at `approvedAt` (or never), prints now:
 * none for a draft or an order cancelled before it was approved, so no unapproved order reaches a
 * vendor; the cancelled version for one cancelled after its approval; else the approved one.
 */
export function purchaseOrderPdfVersion(
  state: PurchaseOrderState,
  approvedAt: string | Date | null,
): PurchaseOrderPdfVersion | undefined {
  if (approvedAt === null || !PRINTED.has(state)) return undefined;
  return state === 'cancelled' ? PO_PDF_CANCELLED : PO_PDF_AS_APPROVED;
}

/**
 * The id of an order's PDF file of one version: a UUID v7 that keeps the order's own time prefix
 * (so it sorts with its order), with the rest taken from a SHA-256 of the order's id and the
 * version. The same order and version always give the same id; another order or version never
 * does in practice.
 */
export function purchaseOrderPdfFileId(
  purchaseOrderId: string,
  version: PurchaseOrderPdfVersion,
): string {
  const time = purchaseOrderId.replaceAll('-', '').slice(0, 12).toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(time)) throw new RangeError('a purchase order id is a UUID');
  const hash = createHash('sha256')
    .update(`purchase_order_pdf:${purchaseOrderId.toLowerCase()}:${version}`)
    .digest('hex');
  const variant = ((Number.parseInt(hash.charAt(3), 16) & 0x3) | 0x8).toString(16);
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    `7${hash.slice(0, 3)}`,
    `${variant}${hash.slice(4, 7)}`,
    hash.slice(7, 19),
  ].join('-');
}
