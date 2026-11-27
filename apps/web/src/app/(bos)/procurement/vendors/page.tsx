import { executeQuery, requestCoversAllCompanies, UPLOAD_LIMITS } from '@shakti/domain';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { listVendors } from '../../../../actions/procurement';
import { ProcurementTabs } from '../../../../components/procurement/procurement-tabs';
import { VendorsScreen } from '../../../../components/procurement/vendors-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { quoteCompanies, orderTabs } from '../companies';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('procurement'), (await getTranslations('procurement'))('title'));
}

/** A supplier quote's document limits, from `UPLOAD_LIMITS`. */
function quoteDocumentLimit() {
  const found = UPLOAD_LIMITS.vendor_quote;
  if (found === undefined) throw new Error('no upload limits for vendor_quote');
  return { contentTypes: [...found.contentTypes], maxBytes: found.maxBytes };
}

/**
 * Procurement › Vendors (INV-04, docs/03-roadmap-appendix/phase3.md §6.3): the group's vendor
 * list. Whoever reads stock or writes purchase orders opens it; adding and changing vendors needs
 * `procurement.po.write`, and quotes are shown and recorded only with `procurement.rate.read`, as
 * the commands and queries check again.
 */
export default async function VendorsPage() {
  const { principal, access, can } = await screenAccess(navRequires('procurement'));
  const t = await getTranslations('procurement');
  const first = await listVendors({ limit: 50 });
  const readsRates = can('procurement.rate.read', 'entity');
  const canWrite = can('procurement.po.write', 'entity');
  const coversGroup =
    readsRates && canWrite
      ? await executeQuery(principal, {}, (ctx) => requestCoversAllCompanies(ctx), {
          name: 'procurement.vendors.coversAll',
        })
      : false;
  const companies = readsRates
    ? quoteCompanies(principal, access.entities, coversGroup, t('wholeGroup'))
    : [];
  return (
    <Page title={t('title')} description={t('intro')}>
      <ProcurementTabs
        current="vendors"
        {...orderTabs(can, t)}
        label={t('sections')}
        vendors={t('vendorsTab')}
        compare={readsRates ? t('compareTab') : undefined}
      />
      {first.ok ? (
        <VendorsScreen
          initialPage={first.data}
          powers={{
            canWrite,
            canRecordQuotes: readsRates && canWrite && companies.length > 0,
            quoteCompanies: companies,
            companyNames: Object.fromEntries(
              access.entities
                .filter((e) => principal.entityIds.includes(e.entityId))
                .map((e) => [e.entityId, e.entityName]),
            ),
          }}
          uploadLimit={quoteDocumentLimit()}
        />
      ) : (
        <FailureMessage failure={firstFailure(first)} />
      )}
    </Page>
  );
}
