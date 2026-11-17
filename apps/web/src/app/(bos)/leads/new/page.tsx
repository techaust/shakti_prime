import { hasGrant } from '@shakti/contracts';
import { EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { leadFormOptions } from '../../../../actions/crm';
import { NewLeadForm } from '../../../../components/leads/new-lead-form';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('leads-new'), (await getTranslations('leads.new'))('title'));
}

/**
 * New lead (CRM-01): a new customer's lead in one of the companies being viewed. In All companies
 * mode the person chooses the company; only companies where their role may add leads are offered.
 * `?company=` starts with that company chosen (the screen-pop opens the form for its call's), and
 * `?call=` (the call's id) gives the call its own fresh form, never one the person was typing in.
 */
export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access } = await screenAccess(navRequires('leads-new'));
  const t = await getTranslations('leads.new');
  const companies = access.entities
    .filter(
      (e) =>
        principal.entityIds.includes(e.entityId) &&
        hasGrant(e.grants, 'crm.lead.write', 'own') &&
        hasGrant(e.grants, 'crm.account.write', 'own'),
    )
    .map((e) => ({
      id: e.entityId,
      name: e.entityName,
      // Only an Executive makes a customer a dealer (the owner's decision of 13-10-2026).
      mayMakeDealer: hasGrant(e.grants, 'sales.credit.write', 'entity'),
    }));
  const [options, query] = await Promise.all([leadFormOptions(), searchParams]);
  return (
    <Page title={t('title')} description={t('intro')} width="form">
      {!options.ok ? (
        <FailureMessage failure={firstFailure(options)} />
      ) : companies.length === 0 ? (
        <EmptyState message={t('noCompany')} />
      ) : (
        <NewLeadForm
          key={typeof query.call === 'string' ? query.call : 'new'}
          companies={companies}
          pipelines={options.data.pipelines}
          sources={options.data.sources}
          initialEntityId={companyParam(query.company)}
        />
      )}
    </Page>
  );
}
