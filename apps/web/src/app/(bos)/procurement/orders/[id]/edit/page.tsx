import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getPurchaseOrder } from '../../../../../../actions/purchase-orders';
import { OrderForm } from '../../../../../../components/procurement/order-form';
import { hasRates } from '../../../../../../components/procurement/order-sheet';
import { Page } from '../../../../../../components/shell/page';
import { navRequires } from '../../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../../screens/access';
import { orderFormChoices } from '../../order-form-data';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('procurement'),
    (await getTranslations('procurement'))('orderForm.editTitle'),
  );
}

/** A draft purchase order changed by a person who writes orders in its company. */
export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { access } = await screenAccess(navRequires('procurement'));
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const result = await getPurchaseOrder({ purchaseOrderId: id });
  if (!result.ok) notFound();
  const order = result.data;
  const grants = access.entities.find((e) => e.entityId === order.entityId)?.grants ?? [];
  if (order.state !== 'draft' || !hasGrant(grants, 'procurement.po.write', 'entity')) notFound();
  const t = await getTranslations('procurement.orderForm');
  const { vendors, hubs } = await orderFormChoices();
  const rates = hasRates(order) ? order.lines : undefined;
  return (
    <Page title={t('editHeading', { number: order.poNo })} description={t('editIntro')}>
      <OrderForm
        entityId={order.entityId}
        orderId={order.id}
        vendors={
          vendors.some((v) => v.id === order.vendorId)
            ? vendors
            : [...vendors, { id: order.vendorId, name: order.vendorName }]
        }
        hubs={hubs}
        canRate={hasGrant(grants, 'procurement.rate.read', 'entity')}
        initial={{
          vendorId: order.vendorId,
          hubId: order.deliverToWarehouseId,
          expectedAt: order.expectedAt,
          notes: order.notes,
          lines: order.lines.map((l) => ({
            key: l.id,
            itemId: l.itemId,
            qty: l.qty.replace(/\.?0+$/, ''),
            rate: rates?.find((r) => r.id === l.id)?.unitRate?.replace(/\.?0+$/, '') ?? '',
            fromQuote: false,
          })),
        }}
      />
    </Page>
  );
}
