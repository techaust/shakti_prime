import type { PurchaseOrderState } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listPurchaseOrders } from '../../../../actions/purchase-orders';
import { OrdersScreen } from '../../../../components/procurement/orders-screen';
import { ProcurementTabs } from '../../../../components/procurement/procurement-tabs';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { PURCHASE_ORDER_STATES } from '../../../../screens/contract-values';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';
import { orderCompanies, orderTabs } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('procurement'), (await getTranslations('procurement'))('orders.title'));
}

/**
 * Procurement › Orders (docs/03-roadmap-appendix/phase3.md §7.2): one company's purchase orders by
 * state, the reorder drafts on top. The company is the one asked for with `?company=`, else the
 * first the person reads orders in; `state` is a state of the machine, `draft` when not given.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, can } = await screenAccess(navRequires('procurement'));
  const query = await searchParams;
  const companies = orderCompanies(principal, access.entities);
  const asked = companyParam(query.company);
  const entityId = asked ?? Number(Object.keys(companies)[0]);
  if (!(entityId in companies)) notFound();
  const stateAsked = typeof query.state === 'string' ? query.state : 'draft';
  const state = (PURCHASE_ORDER_STATES as readonly string[]).includes(stateAsked)
    ? (stateAsked as PurchaseOrderState)
    : 'draft';
  const t = await getTranslations('procurement');
  const page = await listPurchaseOrders({ entityId, state, limit: 50 });
  return (
    <Page
      title={t('orders.title')}
      description={t('orders.intro')}
      actions={
        can('procurement.po.write', 'entity') ? (
          <Button asChild>
            <Link href={`/procurement/orders/new?company=${String(entityId)}` as Route}>
              {t('orders.create')}
            </Link>
          </Button>
        ) : undefined
      }
    >
      <ProcurementTabs
        current="orders"
        label={t('sections')}
        vendors={t('vendorsTab')}
        compare={can('procurement.rate.read', 'entity') ? t('compareTab') : undefined}
        {...orderTabs(can, t)}
      />
      {page.ok ? (
        <OrdersScreen
          key={`${String(entityId)}/${state}`}
          initial={page.data}
          entityId={entityId}
          state={state}
          companies={companies}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
