import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listEmployees } from '../../../../actions/hr';
import { PeopleScreen } from '../../../../components/hr/people-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';
import { requestCompanies } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('hr-people'), (await getTranslations('hr.people'))('title'));
}

/**
 * HR › People (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01): the staff the caller may read,
 * HR and the Executive every person, the GM their company, a team lead the people they manage.
 * HR adds people; row security decides every row.
 */
export default async function PeoplePage() {
  const { principal, access, can } = await screenAccess(navRequires('hr-people'));
  const t = await getTranslations('hr.people');
  const first = await listEmployees({ limit: 50 });
  return (
    <Page title={t('title')} description={t('intro')}>
      {first.ok ? (
        <PeopleScreen
          initialPage={first.data}
          canEdit={can('hr.employee.write', 'all')}
          companies={requestCompanies(principal, access)}
        />
      ) : (
        <FailureMessage failure={firstFailure(first)} />
      )}
    </Page>
  );
}
