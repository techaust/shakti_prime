import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { readStockValuation } from '../../../../actions/inventory';
import { ValuationScreen } from '../../../../components/inventory/valuation-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam } from '../../../../screens/customers';
import { istDate } from '../../../../screens/inventory';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-valuation'),
    (await getTranslations('inventory.valuation'))('title'),
  );
}

/**
 * Inventory › Stock valuation (`finance.cost.read`, docs/03-roadmap-appendix/phase3.md §6.2): one
 * company's stock at the close of a date, per hub and category. `?company=` and `?date=`
 * (`YYYY-MM-DD`, today in India by default) choose what is valued.
 */
export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = screenAccess(navRequires('inventory-valuation'));
  const { principal, access, activeEntityId } = await guard;
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const today = istDate(new Date());
  const date =
    typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date) && query.date <= today
      ? query.date
      : today;
  const t = await getTranslations('inventory.valuation');
  const names = companyNames(access);
  const valuation = await readStockValuation({ entityId, asOf: date });
  return (
    <Page title={t('title')} description={t('intro')}>
      {valuation.ok ? (
        <ValuationScreen
          key={`${String(entityId)}/${date}`}
          valuation={valuation.data}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(valuation)} />
      )}
    </Page>
  );
}
