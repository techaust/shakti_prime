import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { OrderForm } from '../../../../../components/procurement/order-form';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { companyParam } from '../../../../../screens/customers';
import { orderFormChoices } from '../order-form-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('procurement'),
    (await getTranslations('procurement'))('orderForm.createTitle'),
  );
}

/** A new purchase order of a company the person writes orders in (`procurement.po.write`). */
export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access } = await screenAccess(navRequires('procurement'));
  const query = await searchParams;
  const entityId = companyParam(query.company) ?? principal.entityIds[0];
  const grants = access.entities.find((e) => e.entityId === entityId)?.grants;
  if (
    entityId === undefined ||
    !principal.entityIds.includes(entityId) ||
    grants === undefined ||
    !hasGrant(grants, 'procurement.po.write', 'entity')
  ) {
    notFound();
  }
  const t = await getTranslations('procurement.orderForm');
  const { vendors, hubs } = await orderFormChoices();
  return (
    <Page
      title={t('createTitle')}
      description={t('createIntro', { company: companyNames(access)[entityId] ?? '' })}
    >
      <OrderForm
        entityId={entityId}
        vendors={vendors}
        hubs={hubs}
        canRate={hasGrant(grants, 'procurement.rate.read', 'entity')}
      />
    </Page>
  );
}
