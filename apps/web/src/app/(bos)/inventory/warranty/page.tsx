import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listWarrantyClaims } from '../../../../actions/warranty';
import { WarrantyListScreen } from '../../../../components/inventory/warranty-list-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { WARRANTY_CLAIM_STATES } from '../../../../screens/contract-values';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-warranty'),
    (await getTranslations('warranty'))('title'),
  );
}

/**
 * Inventory › Warranty claims (docs/03-roadmap-appendix/phase3.md §7.5): one company's claims by
 * state, newest first. The company is the one being viewed, or the one chosen with `?company=`;
 * `?state=` picks the tab. A claim is raised from the customer's page or the serial's.
 */
export default async function WarrantyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await screenAccess(navRequires('inventory-warranty'));
  const { principal, access, activeEntityId } = screen;
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const state = WARRANTY_CLAIM_STATES.find((s) => s === query.state);
  const t = await getTranslations('warranty');
  const names = companyNames(access);
  const page = await listWarrantyClaims({
    entityId,
    limit: 50,
    ...(state === undefined ? {} : { state }),
  });
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok ? (
        <WarrantyListScreen
          key={`${String(entityId)}/${state ?? ''}`}
          initial={page.data}
          entityId={entityId}
          state={state}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(page)} />
      )}
    </Page>
  );
}
