import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listHubs, listStockBalances } from '../../../../actions/inventory';
import { StockScreen } from '../../../../components/inventory/stock-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { ITEM_CATEGORIES } from '../../../../screens/contract-values';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-stock'),
    (await getTranslations('inventory.stock'))('title'),
  );
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Inventory › Stock (docs/03-roadmap-appendix/phase3.md §6.2): one company's balances by hub, bin
 * and item. The company is the one being viewed, or the one chosen with `?company=`; `hub`,
 * `category` and `q` filter the list.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('inventory-stock'));
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const hub = one(query.hub);
  const category = one(query.category);
  const search = one(query.q)?.slice(0, 80);
  const filters = {
    hubId: hub !== undefined && UUID.test(hub) ? hub : undefined,
    category:
      category !== undefined && (ITEM_CATEGORIES as readonly string[]).includes(category)
        ? category
        : undefined,
    search,
  };
  const t = await getTranslations('inventory.stock');
  const names = companyNames(access);
  const [hubs, page] = await Promise.all([
    listHubs({}),
    listStockBalances({
      entityId,
      limit: 50,
      ...(filters.hubId ? { hubId: filters.hubId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.search ? { search: filters.search } : {}),
    }),
  ]);
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok && hubs.ok ? (
        <StockScreen
          key={`${String(entityId)}/${filters.hubId ?? ''}/${filters.category ?? ''}/${filters.search ?? ''}`}
          initial={page.data}
          entityId={entityId}
          hubs={hubs.data.hubs.filter((h) => h.kind !== 'transit')}
          filters={filters}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(page, hubs)} />
      )}
      {hasGrant(principal.permissions, 'inventory.stock.adjust', 'entity') ? (
        <p className="text-text-muted text-sm">{t('cardHint')}</p>
      ) : null}
    </Page>
  );
}
