import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getReceiveGoods } from '../../../../../../actions/purchase-orders';
import { ReceiveScreen } from '../../../../../../components/procurement/receive-screen';
import { Page } from '../../../../../../components/shell/page';
import { navRequires } from '../../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../../screens/access';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('procurement'),
    (await getTranslations('procurement'))('receive.title'),
  );
}

/**
 * Receive goods (docs/03-roadmap-appendix/phase3.md §7.2): for a holder of
 * `procurement.grn.write` in the order's company, against an order that has been sent.
 */
export default async function ReceiveGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { access } = await screenAccess(navRequires('procurement'));
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const result = await getReceiveGoods({ purchaseOrderId: id });
  if (!result.ok) notFound();
  const { order } = result.data;
  const grants = access.entities.find((e) => e.entityId === order.entityId)?.grants ?? [];
  if (
    !hasGrant(grants, 'procurement.grn.write', 'entity') ||
    (order.state !== 'sent' && order.state !== 'partially_received')
  ) {
    notFound();
  }
  const t = await getTranslations('procurement.receive');
  return (
    <Page
      title={t('heading', { number: order.poNo })}
      description={t('intro', { vendor: order.vendorName, hub: order.hubName })}
    >
      <ReceiveScreen data={result.data} />
    </Page>
  );
}
