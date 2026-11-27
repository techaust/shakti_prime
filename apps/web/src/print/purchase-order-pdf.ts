import type { PurchaseOrderPrintData } from '@shakti/domain';
import { fileStore } from '../files/store';
import { istDay } from '../screens/ist';
import { systemWorkersPrincipal } from '../workers/events/system-principal';
import type { CompanyPrint } from './company';
import { loadCompanyLetterhead } from './documents';
import { renderPurchaseOrder } from './purchase-order-template';
import { sharedPrintRenderer } from './renderer';

/**
 * A purchase order's PDF from its print data, whoever read that data (the person asking, with
 * rates only when they read rates; or the mail worker's narrow read for the vendor's copy): the
 * company's letterhead, logo and block as the quote's (read as the worker for that one company,
 * never the bank account), else, with no file store, the block alone from the order's own read.
 * The caller has checked that the order prints (`purchaseOrderPrints`).
 */
export async function purchaseOrderPdf(
  data: PurchaseOrderPrintData,
  requestId: string,
  now: Date = new Date(),
): Promise<Uint8Array<ArrayBuffer>> {
  const store = fileStore();
  const company: CompanyPrint =
    store === undefined
      ? { ...data.company, logo: null, letterhead: null, bank: null }
      : await loadCompanyLetterhead({
          principal: systemWorkersPrincipal(data.order.entityId),
          entityId: data.order.entityId,
          requestId,
          store,
        });
  const document = renderPurchaseOrder(data, company, istDay(now));
  const renderer = await sharedPrintRenderer();
  return new Uint8Array(await renderer.renderPdf(document.html, document.options));
}
