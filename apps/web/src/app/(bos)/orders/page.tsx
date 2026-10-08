import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listOrders } from '../../../actions/orders';
import { OrdersScreen } from '../../../components/orders/orders-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('orders'), (await getTranslations('orders'))('title'));
}

/** Orders (docs/03-roadmap-appendix/phase1.md §8.3): the orders the caller reads, newest first. */
export default async function OrdersPage() {
  const { principal, access } = await screenAccess(navRequires('orders'));
  const t = await getTranslations('orders');
  const page = await listOrders({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <OrdersScreen
          initial={page.data}
          companies={companyNames(access)}
          showCompany={principal.entityIds.length > 1}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
