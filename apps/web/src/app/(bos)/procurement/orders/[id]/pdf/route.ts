import { DomainError } from '@shakti/contracts';
import { executeQuery, getPurchaseOrderPdf, type PurchaseOrderPdfState } from '@shakti/domain';
import { createTranslator } from 'next-intl';
import en from '../../../../../../../messages/en.json';
import { requestMeta } from '../../../../../../actions/support';
import { currentPrincipal } from '../../../../../../auth/current-principal';
import { fileStore } from '../../../../../../files/store';
import { purchaseOrderPdfFileName } from '../../../../../../print/purchase-order-file';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seconds before the page asks again while the render worker prints the PDF. */
const RETRY_SECONDS = 5;

/** The answer while the PDF is not stored yet: a sentence, and the page asks again by itself. */
function preparing(): Response {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'procurement.orderPdf' });
  return new Response(t('preparing'), {
    status: 503,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': String(RETRY_SECONDS),
      refresh: String(RETRY_SECONDS),
      'cache-control': 'private, no-store',
    },
  });
}

/**
 * `GET /procurement/orders/{id}/pdf`: the purchase order's PDF (docs/03-roadmap-appendix/phase3.md
 * §7.2) as the render worker stored it (ADR 0009, review R2): the vendor's copy with its rates, on
 * the company's letterhead, of the version the order prints now (as approved, or marked cancelled).
 * Nothing is printed here. The stored file is read as the person who asks: an order's PDF is a
 * `purchase_order_pdf` file, which only a holder of `procurement.rate.read` in its company reads,
 * so anyone else, a draft, an order never approved, or an order the person may not read answers
 * 404, and a signed-out request 401. While the worker has not stored it yet (the order sheet's
 * Download PDF asks for it with `procurement.po.pdf.request`) the answer says it is being prepared
 * and the page asks again a few seconds later. `?download=1` saves the file instead of showing it,
 * so the order sheet stays open.
 */
export async function GET(
  request: Request,
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
  let pdf: PurchaseOrderPdfState;
  try {
    pdf = await executeQuery(
      principal,
      { requestId },
      (context) => getPurchaseOrderPdf(context, { purchaseOrderId: id }),
      { name: 'procurement.orders.pdf' },
    );
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'not_found' || e.code === 'forbidden')) {
      return new Response(null, { status: 404 });
    }
    throw e;
  }
  const file = pdf.file;
  const store = fileStore();
  if (file?.status !== 'ready' || file.deletedAt !== null || store?.bucket !== file.bucket) {
    return preparing();
  }
  const bytes = await store.get(file.key);
  const download = new URL(request.url).searchParams.get('download') === '1';
  if (bytes === undefined) return preparing();
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${purchaseOrderPdfFileName(pdf.poNo)}"`,
      'cache-control': 'private, no-store',
    },
  });
}
