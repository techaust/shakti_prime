import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listDocumentRequirements } from '../../../../actions/documents';
import { RequirementsScreen } from '../../../../components/documents/requirements-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-document-requirements'),
    (await getTranslations('documents.settings'))('title'),
  );
}

/**
 * Settings › Document requirements (an Executive, `documents.requirement.set`,
 * docs/03-roadmap-appendix/phase4.md §6.3): the documents each step of a flow needs, per company.
 */
export default async function DocumentRequirementsPage() {
  const { access, principal } = await screenAccess(navRequires('settings-document-requirements'));
  const t = await getTranslations('documents.settings');
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  const first = companies[0]?.id ?? 1;
  const requirements = await listDocumentRequirements({ entityId: first });
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {requirements.ok ? (
        <RequirementsScreen
          companies={companies}
          initial={{ entityId: first, requirements: requirements.data }}
        />
      ) : (
        <FailureMessage failure={firstFailure(requirements)} />
      )}
    </Page>
  );
}
