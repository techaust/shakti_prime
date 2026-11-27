import { executeQuery, requestCoversAllCompanies } from '@shakti/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listLeaveTypes } from '../../../../actions/hr';
import { LeaveTypesScreen } from '../../../../components/hr/leave-types-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';
import { settingCompanies } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('hr-leave-types'),
    (await getTranslations('hr.leaveTypes'))('title'),
  );
}

/** HR › Leave types (docs/03-roadmap-appendix/phase5.md §5): each company's kinds of leave and the group's. */
export default async function LeaveTypesPage() {
  const { principal, access } = await screenAccess(navRequires('hr-leave-types'));
  const t = await getTranslations('hr');
  const list = await listLeaveTypes({});
  const coversGroup = await executeQuery(principal, {}, (ctx) => requestCoversAllCompanies(ctx), {
    name: 'hr.leaveTypes.coversAll',
  });
  return (
    <Page title={t('leaveTypes.title')} description={t('leaveTypes.intro')}>
      {list.ok ? (
        <LeaveTypesScreen
          initial={list.data}
          companies={settingCompanies(principal, access, coversGroup, t('wholeGroup'))}
        />
      ) : (
        <FailureMessage failure={firstFailure(list)} />
      )}
    </Page>
  );
}
