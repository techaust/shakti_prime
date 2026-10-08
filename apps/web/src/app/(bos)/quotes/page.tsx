import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listQuotes } from '../../../actions/quotes';
import { QuotesScreen } from '../../../components/quotes/quotes-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('quotes'), (await getTranslations('quotes'))('title'));
}

/** Quotes (docs/03-roadmap-appendix/phase1.md §7.3): the quotes of the caller's leads, newest first. */
export default async function QuotesPage() {
  const { principal, access } = await screenAccess(navRequires('quotes'));
  const t = await getTranslations('quotes');
  const page = await listQuotes({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <QuotesScreen
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
