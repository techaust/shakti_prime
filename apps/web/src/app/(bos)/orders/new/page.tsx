import type { PermissionGrant } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadOrderBuilder } from '../../../../actions/orders';
import { OrderBuilder } from '../../../../components/orders/order-builder';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam, customerHref } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Making a dealer's order needs its own permission beside reading the dealer.
const BUILDER_REQUIRES: readonly PermissionGrant[] = [
  { key: 'crm.account.read', scope: 'own' },
  { key: 'sales.order.create', scope: 'own' },
];

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(BUILDER_REQUIRES, (await getTranslations('orders'))('builder.pageTitle'));
}

/**
 * A dealer's order without a quote (docs/03-roadmap-appendix/phase1.md §8.3), opened from the dealer's
 * Account 360: `?company=<company>&dealer=<customer>`. A customer the caller may not read, one who
 * is not a dealer, or an address that names none, shows the not-found screen.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await screenAccess(BUILDER_REQUIRES);
  const query = await searchParams;
  const entityId = companyParam(query.company);
  const dealer = Array.isArray(query.dealer) ? query.dealer[0] : query.dealer;
  if (entityId === undefined || dealer === undefined || !UUID.test(dealer)) notFound();
  const t = await getTranslations('orders');
  const builder = await loadOrderBuilder({ entityId, accountId: dealer });
  if (
    !builder.ok &&
    ['account_missing', 'forbidden', 'order_needs_accepted_quote'].includes(builder.error)
  ) {
    notFound();
  }
  return builder.ok ? (
    <Page
      title={t('builder.for', { name: builder.data.customerName })}
      description={t('builder.intro')}
      width="detail"
      actions={
        <Button asChild variant="secondary">
          <Link href={customerHref(builder.data.accountId, builder.data.entityId)}>
            {t('builder.back')}
          </Link>
        </Button>
      }
    >
      <OrderBuilder builder={builder.data} />
    </Page>
  ) : (
    <Page title={t('builder.pageTitle')} width="detail">
      <FailureMessage failure={firstFailure(builder)} />
    </Page>
  );
}
