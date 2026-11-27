import { DomainError } from '@shakti/contracts';
import { executeQuery, getPurchaseOrderPrint } from '@shakti/domain';
import { requestMeta } from '../../../../../../actions/support';
import { currentPrincipal } from '../../../../../../auth/current-principal';
import { purchaseOrderPdfFileName } from '../../../../../../print/purchase-order-file';
import { renderPurchaseOrder } from '../../../../../../print/purchase-order-template';
import { sharedPrintRenderer } from '../../../../../../print/renderer';
import { istDay } from '../../../../../../screens/ist';

export const dynamic = 'force-dynamic';
/** Chromium's first launch on a cold function, and the page. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `GET /procurement/orders/{id}/pdf`: the purchase order's PDF (docs/03-roadmap-appendix/phase3.md
 * §7.2), printed for the person who asks, from what they may read: the rates, amounts and tax
 * split only for a holder of `procurement.rate.read`, so nobody else's copy carries a value. An
 * order the person may not read answers 404, a signed-out request 401.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  let principal;
  try {
    principal = await currentPrincipal();
  } catch {
    return new Response(null, { status: 401 });
  }
  if (principal === undefined) return new Response(null, { status: 401 });
  const { requestId } = await requestMeta();
  let data;
  try {
    data = await executeQuery(
      principal,
      { requestId },
      (context) => getPurchaseOrderPrint(context, { purchaseOrderId: id }),
      { name: 'procurement.orders.pdf' },
    );
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'not_found' || e.code === 'forbidden')) {
      return new Response(null, { status: 404 });
    }
    throw e;
  }
  const document = renderPurchaseOrder(data, istDay(new Date()));
  const renderer = await sharedPrintRenderer();
  const pdf = await renderer.renderPdf(document.html, document.options);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${purchaseOrderPdfFileName(data.order.poNo)}"`,
      'cache-control': 'private, no-store',
    },
  });
}
