import { hasGrant, IMPLEMENTED_IMPORT_KINDS, IMPORT_LIMITS } from '@shakti/contracts';
import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UploadForm } from '../../../../components/imports/upload-form';
import { ImportSteps } from '../../../../components/imports/import-steps';
import { Page } from '../../../../components/shell/page';
import { screenAccess } from '../../../../screens/access';
import { navRequires } from '../../../../nav';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports.upload'))('title') };
}

/**
 * New import, step one: the company, what the file holds and the file itself. In All companies
 * mode the person chooses the company; only companies where their role may import are offered.
 */
export default async function NewImportPage() {
  const { principal, access } = await screenAccess(navRequires('imports'));
  const t = await getTranslations('imports.upload');
  const companies = access.entities
    .filter(
      (e) =>
        principal.entityIds.includes(e.entityId) && hasGrant(e.grants, 'imports.write', 'entity'),
    )
    .map((e) => ({ id: e.entityId, name: e.entityName }));
  return (
    <Page title={t('title')} description={t('intro')} width="form">
      <ImportSteps state={undefined} />
      {companies.length === 0 ? (
        <EmptyState message={t('noCompany')} />
      ) : (
        <UploadForm
          companies={companies}
          kinds={[...IMPLEMENTED_IMPORT_KINDS]}
          limits={{ maxFileBytes: IMPORT_LIMITS.maxFileBytes, maxRows: IMPORT_LIMITS.maxRows }}
        />
      )}
    </Page>
  );
}
