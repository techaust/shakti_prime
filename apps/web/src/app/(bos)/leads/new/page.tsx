import { hasGrant } from '@shakti/contracts';
import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { leadFormOptions } from '../../../../actions/crm';
import { NewLeadForm } from '../../../../components/leads/new-lead-form';
import { FailureMessage } from '../../../../components/screens/failure';
import { Screen } from '../../../../components/screens/screen';
import { screenAccess } from '../../../../screens/access';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('leads.new'))('title') };
}

/**
 * New lead (CRM-01): a new customer's lead in one of the companies being viewed. In All companies
 * mode the person chooses the company; only companies where their role may add leads are offered.
 */
export default async function NewLeadPage() {
  const { principal, access } = await screenAccess({ key: 'crm.lead.write', scope: 'own' });
  const t = await getTranslations('leads.new');
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
    <Screen title={t('title')} intro={t('intro')} width="form">
      {!options.ok ? (
        <FailureMessage failure={firstFailure(options)} />
      ) : companies.length === 0 ? (
        <EmptyState message={t('noCompany')} />
      ) : (
        <NewLeadForm
          companies={companies}
          pipelines={options.data.pipelines}
          sources={options.data.sources}
        />
      )}
    </Screen>
  );
}
