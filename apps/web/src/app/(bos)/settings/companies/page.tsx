import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listEntities } from '../../../../actions/org';
import { CompaniesScreen } from '../../../../components/companies/companies-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('companies'))('title') };
}

/** Settings › Companies: every company the caller works in; an Executive edits their details. */
export default async function CompaniesPage() {
  const { can } = await screenAccess();
  const t = await getTranslations('companies');
  const companies = await listEntities();
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {companies.ok ? (
        <CompaniesScreen initial={companies.data} canEdit={can('admin.entities.write', 'all')} />
      ) : (
        <FailureMessage failure={firstFailure(companies)} />
      )}
    </Page>
  );
}
