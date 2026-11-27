import { hasGrant } from '@shakti/contracts';
import { Button, cn } from '@shakti/ui';
import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listGoodsReceipts } from '../../../../actions/purchase-orders';
import { ProcurementTabs } from '../../../../components/procurement/procurement-tabs';
import { ReceiptsList } from '../../../../components/procurement/receipts-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';
import { orderCompanies, orderTabs } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('procurement'),
    (await getTranslations('procurement'))('receipts.title'),
  );
}

/**
 * Procurement › Receipts (docs/03-roadmap-appendix/phase3.md §7.2): one company's goods receipts,
 * newest first, with no rate; a holder of `procurement.grn.write` reverses one from here.
 */
export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, can } = await screenAccess(navRequires('procurement'));
  const query = await searchParams;
  const companies = orderCompanies(principal, access.entities);
  const entityId = companyParam(query.company) ?? Number(Object.keys(companies)[0]);
  if (!(entityId in companies)) notFound();
  const t = await getTranslations('procurement');
  const page = await listGoodsReceipts({ entityId, limit: 50 });
  const grants = access.entities.find((e) => e.entityId === entityId)?.grants ?? [];
  const names = Object.entries(companies);
  return (
    <Page title={t('receipts.title')} description={t('receipts.intro')}>
      <ProcurementTabs
        current="receipts"
        label={t('sections')}
        vendors={t('vendorsTab')}
        compare={can('procurement.rate.read', 'entity') ? t('compareTab') : undefined}
        {...orderTabs(can, t)}
      />
      {names.length > 1 ? (
        <nav aria-label={t('orders.companies')} className="flex flex-wrap gap-2">
          {names.map(([id, name]) => (
            <Button
              key={id}
              asChild
              size="sm"
              variant={Number(id) === entityId ? 'primary' : 'secondary'}
              className={cn(Number(id) === entityId && 'pointer-events-none')}
            >
              <Link
                href={`/procurement/receipts?company=${id}` as Route}
                aria-current={Number(id) === entityId ? 'page' : undefined}
              >
                {name}
              </Link>
            </Button>
          ))}
        </nav>
      ) : null}
      {page.ok ? (
        <ReceiptsList
          key={entityId}
          initial={page.data}
          entityId={entityId}
          canReverse={hasGrant(grants, 'procurement.grn.write', 'entity')}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
