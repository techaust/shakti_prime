import type { PurchaseOrderPdfVersion } from '@shakti/contracts';
import { createHash } from 'node:crypto';
import type { CommandContext } from '../command/context';

/*
 * A purchase order's PDF (docs/03-roadmap-appendix/phase3.md §7.2, ADR 0009): the render worker
 * prints it from the order's approval on and stores it as a `purchase_order_pdf` file, one file per
 * version (`purchaseOrderPdfVersion` in the contracts). Each file's id is worked out from the order
 * and the version, so every request to print it (approval, sending, cancelling, a person asking to
 * download it) finds or makes the same file, and the download serves the order's current version.
 */

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

/**
 * Asks the render worker for an order's PDF of one version (ADR 0009, review R2), from a command:
 * it prints the order with its rates on the company's letterhead and stores it as a
 * `purchase_order_pdf` file under `purchaseOrderPdfFileId`, so a second request finds that file.
 */
export function requestPurchaseOrderPrint(
  ctx: Pick<CommandContext, 'emit'>,
  order: { id: string; entityId: number },
  version: PurchaseOrderPdfVersion,
): void {
  ctx.emit({
    type: 'print.document.requested',
    entityId: order.entityId,
    aggregateType: 'purchase_order',
    aggregateId: order.id,
    payload: { documentType: 'purchase_order', documentId: order.id, version },
  });
}
