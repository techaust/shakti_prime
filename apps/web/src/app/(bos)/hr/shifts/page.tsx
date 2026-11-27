import { executeQuery, requestCoversAllCompanies, WORKSHOP_DEFAULTS } from '@shakti/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listShifts } from '../../../../actions/hr';
import { ShiftsScreen } from '../../../../components/hr/shifts-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';
import { settingCompanies } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('hr-shifts'), (await getTranslations('hr.shifts'))('title'));
}

/**
 * HR › Shifts (docs/03-roadmap-appendix/phase5.md §5): each company's working patterns and the
 * group's. A new shift starts from HR-1's working day (`WORKSHOP_DEFAULTS.hr`).
 */
export default async function ShiftsPage() {
  const { principal, access } = await screenAccess(navRequires('hr-shifts'));
  const t = await getTranslations('hr');
  const list = await listShifts({});
  const coversGroup = await executeQuery(principal, {}, (ctx) => requestCoversAllCompanies(ctx), {
    name: 'hr.shifts.coversAll',
  });
  const day = WORKSHOP_DEFAULTS.hr;
  return (
    <Page title={t('shifts.title')} description={t('shifts.intro')}>
      {list.ok ? (
        <ShiftsScreen
          initial={list.data}
          companies={settingCompanies(principal, access, coversGroup, t('wholeGroup'))}
          start={{
            startTime: day.workdayStart,
            endTime: day.workdayEnd,
            lunchMinutes: day.lunchMinutes,
            graceMinutes: day.graceMinutes,
          }}
        />
      ) : (
        <FailureMessage failure={firstFailure(list)} />
      )}
    </Page>
  );
}
