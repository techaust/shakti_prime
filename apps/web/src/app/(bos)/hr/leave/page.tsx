import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getLeaveScreen } from '../../../../actions/hr';
import { LeaveScreen } from '../../../../components/hr/leave-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';
import { requestCompanies } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('hr-leave'), (await getTranslations('hr.leave'))('title'));
}

/**
 * HR › Leave (docs/03-roadmap-appendix/phase5.md §5, PRD HR-02): the caller's own leave, and for
 * a holder of `hr.leave.approve` the requests waiting for their decision.
 */
export default async function LeavePage() {
  const { principal, access, can } = await screenAccess(navRequires('hr-leave'));
  const t = await getTranslations('hr.leave');
  const screen = await getLeaveScreen();
  return (
    <Page title={t('title')} description={t('intro')}>
      {screen.ok ? (
        <LeaveScreen
          initial={screen.data}
          companies={requestCompanies(principal, access)}
          canDecide={can('hr.leave.approve', 'team')}
        />
      ) : (
        <FailureMessage failure={firstFailure(screen)} />
      )}
    </Page>
  );
}
