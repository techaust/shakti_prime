import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listDuplicates } from '../../../actions/duplicates';
import { DuplicatesScreen } from '../../../components/duplicates/duplicates-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('duplicates'), (await getTranslations('duplicates'))('title'));
}

/** Duplicates (CRM-03): the possible duplicates a team lead and above decide, surest first. */
export default async function DuplicatesPage() {
  const { access } = await screenAccess(navRequires('duplicates'));
  const t = await getTranslations('duplicates');
  const page = await listDuplicates({ limit: 25 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <DuplicatesScreen initial={page.data} companies={companyNames(access)} />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
