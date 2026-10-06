import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listDealerCredit } from '../../../actions/orders';
import { DealerCreditScreen } from '../../../components/orders/dealer-credit-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('dealer-credit'),
    (await getTranslations('dealerCredit'))('title'),
  );
}

/**
 * Dealer credit (docs/design/phase1.md §8.3, SALE-4, SALE-6): one company's dealers with their
 * limits, days, outstanding and exposure, where Accounts enter terms and outstanding. The company
 * is the one being viewed, or the one chosen with `?company=` among the request's companies.
 */
export default async function DealerCreditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('dealer-credit'));
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const t = await getTranslations('dealerCredit');
  const names = companyNames(access);
  const page = await listDealerCredit({ entityId, limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <DealerCreditScreen
          key={entityId}
          initial={page.data}
          entityId={entityId}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
