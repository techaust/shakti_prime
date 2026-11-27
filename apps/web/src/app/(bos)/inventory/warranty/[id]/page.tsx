import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  getWarrantyClaim,
  listClaimSerials,
  readWarrantyClaimCosts,
} from '../../../../../actions/warranty';
import { listHubs } from '../../../../../actions/inventory';
import { listVendors } from '../../../../../actions/procurement';
import { WarrantyClaimScreen } from '../../../../../components/inventory/warranty-claim-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { companyParam } from '../../../../../screens/customers';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-warranty'),
    (await getTranslations('warranty'))('title'),
  );
}

/**
 * A warranty claim's sheet (docs/03-roadmap-appendix/phase3.md §7.5). `?company=` names the
 * claim's company; a claim the caller may not read shows the not-found screen. The costs are read
 * only for a holder of `finance.cost.read`, and the customer's serials only while the failed one
 * is still to identify.
 */
export default async function WarrantyClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await screenAccess(navRequires('inventory-warranty'));
  const { principal, access, activeEntityId } = screen;
  const { id } = await params;
  const asked = companyParam((await searchParams).company);
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined || !principal.entityIds.includes(entityId) || !UUID.test(id)) {
    notFound();
  }
  const claim = await getWarrantyClaim({ entityId, claimId: id });
  if (!claim.ok && claim.error === 'warranty_claim_missing') notFound();
  const t = await getTranslations('warranty');
  if (!claim.ok) {
    return (
      <Page title={t('title')} width="detail">
        <FailureMessage failure={firstFailure(claim)} />
      </Page>
    );
  }
  const can = {
    write: hasGrant(principal.permissions, 'inventory.warranty.write', 'entity'),
    rma: hasGrant(principal.permissions, 'procurement.po.write', 'entity'),
    settle: hasGrant(principal.permissions, 'procurement.grn.write', 'entity'),
  };
  const state = claim.data.state;
  const movesStock =
    (can.write && state === 'serial_identified') || (can.rma && state === 'replacement_issued');
  const [costs, serials, hubs, vendors] = await Promise.all([
    hasGrant(principal.permissions, 'finance.cost.read', 'entity')
      ? readWarrantyClaimCosts({ entityId, claimId: id })
      : undefined,
    can.write && claim.data.state === 'raised'
      ? listClaimSerials({ entityId, accountId: claim.data.account.id })
      : undefined,
    movesStock ? listHubs({}) : undefined,
    can.rma && state === 'replacement_issued' ? listVendors({ limit: 200 }) : undefined,
  ]);
  return (
    <WarrantyClaimScreen
      claim={claim.data}
      company={companyNames(access)[entityId] ?? ''}
      serials={serials?.ok === true ? serials.data.serials : undefined}
      costs={costs?.ok === true ? costs.data : undefined}
      hubs={hubs?.ok === true ? hubs.data.hubs : []}
      vendors={vendors?.ok === true ? vendors.data.items.filter((v) => v.isActive) : []}
      can={can}
    />
  );
}
