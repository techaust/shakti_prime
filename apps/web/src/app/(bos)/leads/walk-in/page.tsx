import { hasGrant } from '@shakti/contracts';
import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { leadFormOptions } from '../../../../actions/crm';
import { WalkInForm } from '../../../../components/leads/walk-in-form';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('leads-walk-in'),
    (await getTranslations('leads.walkIn'))('title'),
  );
}

/**
 * Walk-in customer (docs/03-roadmap-appendix/phase1.md §6.6, CRM-01): the Store Manager's quick form at the
 * counter. It saves through `crm.lead.create` like New lead, with the walk-in source, and stays
 * open for the next customer.
 */
export default async function WalkInPage() {
  const { principal, access } = await screenAccess(navRequires('leads-walk-in'));
  const t = await getTranslations('leads.walkIn');
  const companies = access.entities
    .filter(
      (e) =>
        principal.entityIds.includes(e.entityId) &&
        hasGrant(e.grants, 'crm.lead.write', 'own') &&
        hasGrant(e.grants, 'crm.account.write', 'own'),
    )
    .map((e) => ({ id: e.entityId, name: e.entityName }));
  const options = await leadFormOptions();
  return (
    <Page title={t('title')} description={t('intro')} width="form">
      {!options.ok ? (
        <FailureMessage failure={firstFailure(options)} />
      ) : companies.length === 0 ? (
        <EmptyState message={t('noCompany')} />
      ) : (
        // Open gap: the consent wording and its version come from the client (workshop LAW-1).
        // Until they exist no consent is recorded at the counter, and service calls from the
        // 160-series numbers, which need a recorded consent, cannot be made to these leads.
        <WalkInForm companies={companies} pipelines={options.data.pipelines} consent={undefined} />
      )}
    </Page>
  );
}
