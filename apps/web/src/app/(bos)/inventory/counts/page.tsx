import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listHubs } from '../../../../actions/inventory';
import { listStockCounts } from '../../../../actions/stock-counts';
import { CountsScreen } from '../../../../components/inventory/counts/counts-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navAnyOf, navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { STOCK_COUNT_STATES } from '../../../../screens/contract-values';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-counts'),
    (await getTranslations('inventory.counts'))('title'),
  );
}

/**
 * Inventory › Stock counts (docs/03-roadmap-appendix/phase3.md §7.3): one company's counts,
 * newest first, by status (`?state=`), for a reader of stock or a counter. A counter
 * (`inventory.stock.move`, with or without `inventory.stock.read`) opens a count to count it; the
 * Inventory Manager (`inventory.stock.adjust`) starts counts and opens their review.
 */
export default async function StockCountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = screenAccess(navRequires('inventory-counts'));
  const { principal, access, activeEntityId, can } = await guard;
  if (!navAnyOf('inventory-counts').some((g) => can(g.key, g.scope))) notFound();
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const state =
    typeof query.state === 'string' &&
    (STOCK_COUNT_STATES as readonly string[]).includes(query.state)
      ? (query.state as (typeof STOCK_COUNT_STATES)[number])
      : undefined;
  const t = await getTranslations('inventory.counts');
  const names = companyNames(access);
  const canStart = can('inventory.stock.adjust', 'entity');
  const [page, hubs] = await Promise.all([
    listStockCounts({ entityId, limit: 50, ...(state === undefined ? {} : { state }) }),
    canStart ? listHubs({}) : Promise.resolve(undefined),
  ]);
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok && (hubs === undefined || hubs.ok) ? (
        <CountsScreen
          key={`${String(entityId)}/${state ?? ''}`}
          initial={page.data}
          entityId={entityId}
          state={state}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
          canCount={can('inventory.stock.move', 'entity')}
          canReview={canStart}
          hubs={
            hubs?.ok === true
              ? hubs.data.hubs
                  .filter((h) => h.kind !== 'transit' && h.archivedAt === null)
                  .map((h) => ({
                    ...h,
                    bins: h.bins.filter((b) => b.archivedAt === null),
                  }))
              : []
          }
        />
      ) : (
        <FailureMessage
          failure={hubs === undefined ? firstFailure(page) : firstFailure(page, hubs)}
        />
      )}
    </Page>
  );
}
