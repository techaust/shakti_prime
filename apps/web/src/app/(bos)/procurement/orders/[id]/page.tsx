import { hasGrant } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVendor } from '../../../../../actions/procurement';
import { getPurchaseOrder, listGoodsReceipts } from '../../../../../actions/purchase-orders';
import { OrderActionsBar } from '../../../../../components/procurement/order-actions';
import { OrderSheet } from '../../../../../components/procurement/order-sheet';
import { ReceiptsList } from '../../../../../components/procurement/receipts-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../screens/access';
import { orderActions } from '../../../../../screens/purchase-orders';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('procurement'),
    (await getTranslations('procurement'))('orderSheet.title'),
  );
}

/**
 * The order sheet (docs/03-roadmap-appendix/phase3.md §7.2): the order, its lines and, for a
 * holder of `procurement.rate.read`, its rates and totals; the actions its state allows the
 * person; and its goods receipts. An order the person may not read shows the not-found screen.
 */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { principal, access } = await screenAccess(navRequires('procurement'));
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const result = await getPurchaseOrder({ purchaseOrderId: id });
  if (!result.ok && result.error === 'purchase_order_missing') notFound();
  const t = await getTranslations('procurement');
  if (!result.ok) {
    return (
      <Page title={t('orderSheet.title')}>
        <FailureMessage failure={firstFailure(result)} />
      </Page>
    );
  }
  const order = result.data;
  // The company's own grants decide what the sheet offers in it.
  const grants =
    access.entities.find((e) => e.entityId === order.entityId)?.grants ?? principal.permissions;
  const allowed = orderActions(
    order.state,
    {
      canWrite: hasGrant(grants, 'procurement.po.write', 'entity'),
      canApprove:
        hasGrant(grants, 'procurement.po.approve', 'entity') &&
        hasGrant(grants, 'procurement.rate.read', 'entity'),
      canReceive: hasGrant(grants, 'procurement.grn.write', 'entity'),
      readsRates: hasGrant(grants, 'procurement.rate.read', 'entity'),
    },
    order.approvedAt,
  );
  // The vendor's people with an email address, for Send by email.
  const vendor = allowed.send ? await getVendor({ vendorId: order.vendorId }) : undefined;
  const emailContacts = vendor?.ok
    ? vendor.data.contacts.flatMap((c) =>
        c.email === null ? [] : [{ id: c.id, name: c.name, email: c.email }],
      )
    : [];
  const receipts = await listGoodsReceipts({
    entityId: order.entityId,
    purchaseOrderId: order.id,
    limit: 50,
  });
  return (
    <Page
      title={t('orderSheet.heading', { number: order.poNo })}
      description={t('orderSheet.intro')}
      actions={
        <Button asChild variant="secondary">
          <Link
            href={
              `/procurement/orders?company=${String(order.entityId)}&state=${order.state}` as Route
            }
          >
            {t('orderSheet.back')}
          </Link>
        </Button>
      }
    >
      <OrderActionsBar
        orderId={order.id}
        poNo={order.poNo}
        allowed={allowed}
        emailContacts={emailContacts}
      />
      <OrderSheet order={order} />
      <section aria-labelledby="order-receipts" className="flex flex-col gap-3">
        <h2 id="order-receipts" className="text-h3">
          {t('orderSheet.receipts')}
        </h2>
        {receipts.ok ? (
          <ReceiptsList
            initial={receipts.data}
            entityId={order.entityId}
            purchaseOrderId={order.id}
            canReverse={hasGrant(grants, 'procurement.grn.write', 'entity')}
          />
        ) : (
          <FailureMessage failure={firstFailure(receipts)} />
        )}
      </section>
    </Page>
  );
}
