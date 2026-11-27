import { DomainError } from '@shakti/contracts';
import { executeQuery, getPurchaseOrderPrint } from '@shakti/domain';
import { requestMeta } from '../../../../../../actions/support';
import { currentPrincipal } from '../../../../../../auth/current-principal';
import { purchaseOrderPdfFileName } from '../../../../../../print/purchase-order-file';
import { purchaseOrderPdf } from '../../../../../../print/purchase-order-pdf';
import { purchaseOrderPrints } from '../../../../../../screens/purchase-orders';

export const dynamic = 'force-dynamic';
/** Chromium's first launch on a cold function, and the page. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `GET /procurement/orders/{id}/pdf`: the purchase order's PDF (docs/03-roadmap-appendix/phase3.md
 * §7.2), printed for the person who asks, from what they may read: the rates, amounts and tax
 * split only for a holder of `procurement.rate.read`, so nobody else's copy carries a value; on the
 * company's letterhead. It prints from the order's approval on (a cancelled one marked so): a
 * draft, an order never approved, or one the person may not read answers 404, a signed-out
 * request 401.
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
  if (!purchaseOrderPrints(data.order.state, data.order.approvedAt)) {
    return new Response(null, { status: 404 });
  }
  const pdf = await purchaseOrderPdf(data, requestId);
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${purchaseOrderPdfFileName(data.order.poNo)}"`,
      'cache-control': 'private, no-store',
    },
  });
}
