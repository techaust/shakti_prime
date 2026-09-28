import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { listImportJobs } from '../../../actions/imports';
import { ImportsScreen } from '../../../components/imports/imports-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { navRequires } from '../../../nav';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('imports'), (await getTranslations('imports'))('title'));
}

/**
 * Imports (IMP-01, docs/design/backend-weeks-3-5.md §8): the files added to the companies being
 * viewed, newest first, and the way to add another.
 */
export default async function ImportsPage() {
  const { principal, access } = await screenAccess(navRequires('imports'));
  const t = await getTranslations('imports');
  const page = await listImportJobs({ limit: 25 });
  return (
    <Page
      title={t('title')}
      description={t('intro')}
      actions={
        <Button asChild>
          <Link href="/imports/new">{t('add')}</Link>
        </Button>
      }
    >
      {page.ok ? (
        <ImportsScreen
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
