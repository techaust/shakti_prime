import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Page } from '../../../components/shell/page';
import { TallyChecksScreen } from '../../../components/tally/tally-checks-screen';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('tally-checks'), (await getTranslations('tallyChecks'))('title'));
}

/**
 * Tally checks (`finance.recon.write`, docs/03-roadmap-appendix/phase5.md §6.3): the daily checks
 * of the caller's companies held because they would mark many records as removed, each confirmed
 * here by Accounts.
 */
export default async function TallyChecksPage() {
  const { access } = await screenAccess(navRequires('tally-checks'));
  const t = await getTranslations('tallyChecks');
  return (
    <Page title={t('title')} description={t('intro')}>
      <TallyChecksScreen companies={companyNames(access)} />
    </Page>
  );
}
