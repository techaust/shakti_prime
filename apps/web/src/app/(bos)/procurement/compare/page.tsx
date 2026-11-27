import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { compareQuotes } from '../../../../actions/procurement';
import { CompareScreen } from '../../../../components/procurement/compare-screen';
import { ProcurementTabs } from '../../../../components/procurement/procurement-tabs';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { rateCompanies, orderTabs } from '../companies';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

/** The comparison needs the menu's grant and the supplier rates' own. */
const COMPARE_REQUIRES = [
  ...navRequires('procurement'),
  { key: 'procurement.rate.read', scope: 'entity' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(COMPARE_REQUIRES, (await getTranslations('procurement.compare'))('title'));
}

/**
 * Procurement › Compare (INV-04): supplier quotes side by side for one company, for a holder of
 * `procurement.rate.read` only; anyone else gets the not-found screen, as for any screen their
 * grants do not open, and the query refuses them as well.
 */
export default async function ComparePage() {
  const { principal, access, can } = await screenAccess(COMPARE_REQUIRES);
  const t = await getTranslations('procurement');
  const companies = rateCompanies(principal, access.entities);
  const first = companies[0];
  const result = first === undefined ? undefined : await compareQuotes({ entityId: first.id });
  return (
    <Page title={t('compare.title')} description={t('compare.intro')}>
      <ProcurementTabs
        current="compare"
        {...orderTabs(can, t)}
        label={t('sections')}
        vendors={t('vendorsTab')}
        compare={t('compareTab')}
      />
      {result === undefined ? (
        <EmptyState message={t('compare.noCompany')} />
      ) : result.ok ? (
        <CompareScreen initial={result.data} companies={companies} />
      ) : (
        <FailureMessage failure={firstFailure(result)} />
      )}
    </Page>
  );
}
