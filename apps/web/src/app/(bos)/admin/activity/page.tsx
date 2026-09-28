import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listAuditLog, listAuditPeople } from '../../../../actions/admin';
import { ActivityScreen } from '../../../../components/activity/activity-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { auditWindow, defaultWindow } from '../../../../screens/audit';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('admin-activity'), (await getTranslations('activity'))('title'));
}

/**
 * Admin › Activity log (`audit.read`): the audit trail of the last seven days, newest first, with
 * filters by date, result, action and person. The database decides which rows each person reads.
 */
export default async function ActivityPage() {
  const { access } = await screenAccess(navRequires('admin-activity'));
  const t = await getTranslations('activity');
  const dates = defaultWindow(new Date());
  const window = auditWindow(dates.from, dates.to);
  // The default window is always a valid one; the check keeps the types honest.
  if (!window.ok) throw new Error('the default window is not valid');
  const [page, people] = await Promise.all([
    listAuditLog({ from: window.from, to: window.to, limit: 50 }),
    listAuditPeople({ from: window.from, to: window.to }),
  ]);
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok && people.ok ? (
        <ActivityScreen
          initialDates={dates}
          initialPage={page.data}
          initialPeople={people.data}
          companies={companyNames(access)}
        />
      ) : (
        <FailureMessage failure={firstFailure(page, people)} />
      )}
    </Page>
  );
}
