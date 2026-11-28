import type { StockCountSheetRowDto } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listHubs } from '../../../../../actions/inventory';
import { getStockCountSheet } from '../../../../../actions/stock-counts';
import { CountingScreen } from '../../../../../components/inventory/counts/counting-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { screenAccess, screenTitle } from '../../../../../screens/access';
import { companyParam } from '../../../../../screens/customers';
import { ALL_BINS_UP_TO, countBins, shownBin } from '../../../../../screens/stock-counts';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-counts'),
    (await getTranslations('inventory.counts.sheet'))('title'),
  );
}

/**
 * The counting screen (`inventory.stock.move`, docs/03-roadmap-appendix/phase3.md §7.3), made for
 * a phone held in one hand: each bin's items to count, and what the counter entered, never what
 * the records expect. `?company=` names the count's company.
 */
export default async function CountingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, activeEntityId, can } = await screenAccess(navRequires('inventory-counts'));
  if (!can('inventory.stock.move', 'entity')) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const asked = companyParam(query.company);
  const askedBin = typeof query.bin === 'string' && UUID.test(query.bin) ? query.bin : undefined;
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const [sheet, hubs] = await Promise.all([
    getStockCountSheet(entityId, { countId: id }),
    listHubs({}),
  ]);
  if (!sheet.ok && sheet.error === 'stock_count_missing') notFound();
  const t = await getTranslations('inventory.counts.sheet');
  return (
    <Page
      title={sheet.ok ? t('heading', { hub: sheet.data.count.hubName }) : t('title')}
      description={t('intro')}
      width="form"
    >
      {sheet.ok && hubs.ok ? (
        <CountingScreen
          sheet={{ ...sheet.data, rows: shownRows(sheet.data.rows, askedBin) }}
          binChoices={countBins(sheet.data.rows)}
          shownBin={shownBin(sheet.data.rows, askedBin)}
          allBins={sheet.data.rows.length <= ALL_BINS_UP_TO}
          bins={(hubs.data.hubs.find((h) => h.id === sheet.data.count.hubId)?.bins ?? []).filter(
            (b) =>
              b.archivedAt === null &&
              (sheet.data.count.binIds === null || sheet.data.count.binIds.includes(b.id)),
          )}
          canReview={can('inventory.stock.adjust', 'entity')}
        />
      ) : (
        <FailureMessage failure={firstFailure(sheet, hubs)} />
      )}
    </Page>
  );
}

/** The rows of the bin the screen shows, or every row when it shows every bin. */
function shownRows(
  rows: StockCountSheetRowDto[],
  askedBin: string | undefined,
): StockCountSheetRowDto[] {
  const bin = shownBin(rows, askedBin);
  return bin === null ? rows : rows.filter((r) => r.binId === bin);
}
