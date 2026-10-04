import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UPLOAD_LIMITS } from '@shakti/domain';
import { listCompanyBranding } from '../../../../actions/files';
import { listEntities } from '../../../../actions/org';
import { CompaniesScreen } from '../../../../components/companies/companies-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-companies'),
    (await getTranslations('companies'))('title'),
  );
}

/** The logo's and letterhead's limits, for the uploader to check before it sends a byte. */
function brandingLimits() {
  const limit = (purpose: 'entity_logo' | 'letterhead') => {
    const found = UPLOAD_LIMITS[purpose];
    if (found === undefined) throw new Error(`no upload limits for ${purpose}`);
    return { contentTypes: [...found.contentTypes], maxBytes: found.maxBytes };
  };
  return { entity_logo: limit('entity_logo'), letterhead: limit('letterhead') };
}

/**
 * Settings › Companies: every company the caller works in; an Executive edits their details and
 * uploads their logo and letterhead.
 */
export default async function CompaniesPage() {
  const { can } = await screenAccess(navRequires('settings-companies'));
  const t = await getTranslations('companies');
  const canEdit = can('admin.entities.write', 'all');
  const [companies, branding] = await Promise.all([listEntities(), listCompanyBranding()]);
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {companies.ok ? (
        <CompaniesScreen
          initial={companies.data}
          canEdit={canEdit}
          branding={branding.ok ? branding.data : []}
          {...(canEdit ? { limits: brandingLimits() } : {})}
        />
      ) : (
        <FailureMessage failure={firstFailure(companies)} />
      )}
    </Page>
  );
}
