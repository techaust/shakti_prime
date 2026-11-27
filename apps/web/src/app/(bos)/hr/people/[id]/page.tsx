import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getEmployee } from '../../../../../actions/hr';
import { PersonScreen } from '../../../../../components/hr/person-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../screens/access';
import { firstFailure } from '../../../../../screens/result';
import { requestCompanies } from '../../companies';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('hr-leave'), (await getTranslations('hr.person'))('title'));
}

/**
 * A person's page (docs/03-roadmap-appendix/phase5.md §5): their details, shift, manager and
 * leave. Everyone may open their own, as HR › Leave links it; an approver the people they may
 * read; anyone else gets the not-found screen, since row security hides the record.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { principal, access, can } = await screenAccess(navRequires('hr-leave'));
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sheet = await getEmployee({ id });
  if (!sheet.ok && sheet.error === 'employee_missing') notFound();
  const t = await getTranslations('hr.person');
  return (
    <Page
      title={sheet.ok ? sheet.data.employee.name : t('title')}
      description={t('intro')}
      width="detail"
    >
      {sheet.ok ? (
        <PersonScreen
          sheet={sheet.data}
          companies={requestCompanies(principal, access)}
          canEdit={can('hr.employee.write', 'all')}
        />
      ) : (
        <FailureMessage failure={firstFailure(sheet)} />
      )}
    </Page>
  );
}
