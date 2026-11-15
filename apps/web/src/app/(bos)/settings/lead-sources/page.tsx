import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { leadFormOptions } from '../../../../actions/crm';
import { LeadSourcesScreen } from '../../../../components/lead-sources/lead-sources-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-lead-sources'),
    (await getTranslations('leadSources'))('title'),
  );
}

/**
 * Settings › Lead sources (`crm.sources.write`, docs/03-roadmap-appendix/phase2.md §6.2): one
 * company's connected Facebook and Instagram lead forms, Google lead forms and websites, with their
 * field maps, consent questions and Page connections, and its website keys. The lines of business
 * come from the lead form's choices.
 */
export default async function LeadSourcesPage() {
  const { access, principal } = await screenAccess(navRequires('settings-lead-sources'));
  const t = await getTranslations('leadSources');
  const options = await leadFormOptions();
  const names = companyNames(access);
  const companies = principal.entityIds.map((id) => ({ id, name: names[id] ?? String(id) }));
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {options.ok ? (
        <LeadSourcesScreen companies={companies} pipelines={options.data.pipelines} />
      ) : (
        <FailureMessage failure={firstFailure(options)} />
      )}
    </Page>
  );
}
