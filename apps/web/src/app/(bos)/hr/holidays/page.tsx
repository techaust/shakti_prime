import { executeQuery, requestCoversAllCompanies } from '@shakti/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listHolidays } from '../../../../actions/hr';
import { HolidaysScreen } from '../../../../components/hr/holidays-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { istToday } from '../../../../screens/audit';
import { firstFailure } from '../../../../screens/result';
import { settingCompanies } from '../companies';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('hr-holidays'), (await getTranslations('hr.holidays'))('title'));
}

/**
 * HR › Holidays (docs/03-roadmap-appendix/phase5.md §5): this year's holidays of each company and
 * of the group, the year before and the year after one choice away.
 */
export default async function HolidaysPage() {
  const { principal, access } = await screenAccess(navRequires('hr-holidays'));
  const t = await getTranslations('hr');
  const year = Number(istToday(new Date()).slice(0, 4));
  const list = await listHolidays({ year });
  const coversGroup = await executeQuery(principal, {}, (ctx) => requestCoversAllCompanies(ctx), {
    name: 'hr.holidays.coversAll',
  });
  return (
    <Page title={t('holidays.title')} description={t('holidays.intro')}>
      {list.ok ? (
        <HolidaysScreen
          initial={list.data}
          year={year}
          years={[year - 1, year, year + 1]}
          companies={settingCompanies(principal, access, coversGroup, t('wholeGroup'))}
        />
      ) : (
        <FailureMessage failure={firstFailure(list)} />
      )}
    </Page>
  );
}
