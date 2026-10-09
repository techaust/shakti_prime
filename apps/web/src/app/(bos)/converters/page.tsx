import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listCallerProfiles } from '../../../actions/handover';
import { ConvertersScreen } from '../../../components/converters/converters-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('converters'), (await getTranslations('converters'))('title'));
}

/**
 * Lead converters (docs/03-roadmap-appendix/phase1.md §8.2, PRD TEL-02): who takes qualified leads in one
 * company. For whoever may assign leads (`crm.lead.assign`): a Sales Team Lead sees their team, a
 * General Manager and an Executive the company. The company is the one being viewed, or the one
 * chosen with `?company=` among the request's companies.
 */
export default async function ConvertersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('converters'));
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const t = await getTranslations('converters');
  const names = companyNames(access);
  const people = await listCallerProfiles({ entityId });
  return (
    <Page title={t('title')} description={t('intro')}>
      {people.ok ? (
        <ConvertersScreen
          key={entityId}
          initial={people.data}
          entityId={entityId}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(people)} />
      )}
    </Page>
  );
}
