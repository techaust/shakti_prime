import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrderLoans } from '../../../../../actions/loans';
import { getOrder } from '../../../../../actions/orders';
import { OrderLoanPanel } from '../../../../../components/loans/order-loan-panel';
import { OrderScreen } from '../../../../../components/orders/order-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Params {
  entityId: string;
  orderId: string;
}

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('orders'), (await getTranslations('orders'))('title'));
}

/**
 * One order (docs/03-roadmap-appendix/phase1.md §8.3): its lines and totals, and confirming, releasing or
 * cancelling it; below them its Loan tab (docs/03-roadmap-appendix/phase4.md §6.2). An order the caller may not read, or an address that names none, shows the
 * not-found screen.
 */
export default async function OrderPage({ params }: { params: Promise<Params> }) {
  const { access } = await screenAccess(navRequires('orders'));
  const { entityId: rawEntityId, orderId } = await params;
  const entityId = Number(rawEntityId);
  if (!Number.isInteger(entityId) || entityId < 1 || entityId > 32_767 || !UUID.test(orderId)) {
    notFound();
  }
  // The order and its Loan tab (J2) are read at once; a caller who may not read the customer's
  // loans sees the order without the tab.
  const [order, loans] = await Promise.all([
    getOrder({ entityId, orderId }),
    getOrderLoans({ entityId, orderId }),
  ]);
  if (!order.ok && ['order_missing', 'forbidden'].includes(order.error)) notFound();
  const t = await getTranslations('orders');
  return order.ok ? (
    <OrderScreen
      key={order.data.id}
      initial={order.data}
      company={companyNames(access)[order.data.entityId] ?? ''}
    >
      {loans.ok ? <OrderLoanPanel initial={loans.data} /> : null}
    </OrderScreen>
  ) : (
    <Page
      title={t('title')}
      width="detail"
      actions={
        <Button asChild variant="secondary">
          <Link href="/orders">{t('page.back')}</Link>
        </Button>
      }
    >
      <FailureMessage failure={firstFailure(order)} />
    </Page>
  );
}
