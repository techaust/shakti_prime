import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getStockCountReview } from '../../../../../../actions/stock-counts';
import { ReviewScreen } from '../../../../../../components/inventory/counts/review-screen';
import { FailureMessage } from '../../../../../../components/screens/failure';
import { Page } from '../../../../../../components/shell/page';
import { navRequires } from '../../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../../screens/access';
import { companyParam } from '../../../../../../screens/customers';
import { firstFailure } from '../../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-counts'),
    (await getTranslations('inventory.counts.review'))('title'),
  );
}

/**
 * The review of a count (`inventory.stock.adjust`, docs/03-roadmap-appendix/phase3.md §7.3): each
 * line against what the records held when it was counted, the stock moved in the counted bins
 * during the count, values only with `finance.cost.read`; ask for an item again, post or cancel.
 */
export default async function CountReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, activeEntityId, can } = await screenAccess(navRequires('inventory-counts'));
  if (!can('inventory.stock.adjust', 'entity')) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = companyParam((await searchParams).company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const review = await getStockCountReview(entityId, { countId: id });
  if (!review.ok && review.error === 'stock_count_missing') notFound();
  const t = await getTranslations('inventory.counts.review');
  return (
    <Page
      title={review.ok ? t('heading', { hub: review.data.count.hubName }) : t('title')}
      description={t('intro')}
    >
      {review.ok ? (
        <ReviewScreen review={review.data} canCount={can('inventory.stock.move', 'entity')} />
      ) : (
        <FailureMessage failure={firstFailure(review)} />
      )}
    </Page>
  );
}
