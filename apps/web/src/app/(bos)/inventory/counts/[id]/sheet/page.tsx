import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getStockCountReview } from '../../../../../../actions/stock-counts';
import { CountSheetFrame } from '../../../../../../components/inventory/counts/count-sheet-frame';
import { FailureMessage } from '../../../../../../components/screens/failure';
import { Page } from '../../../../../../components/shell/page';
import { navRequires } from '../../../../../../nav';
import { renderStockCountSheet } from '../../../../../../print/stock-count-template';
import { companyNames, screenAccess, screenTitle } from '../../../../../../screens/access';
import { companyParam } from '../../../../../../screens/customers';
import { istDate } from '../../../../../../screens/inventory';
import { firstFailure } from '../../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('inventory-counts'),
    (await getTranslations('inventory.counts.printSheet'))('title'),
  );
}

/**
 * A count's sheet for the record (`inventory.stock.adjust`, docs/03-roadmap-appendix/phase3.md
 * §7.3): the print template filled from the review as it stands, values only with
 * `finance.cost.read`, shown full size and printed from the browser.
 */
export default async function CountSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = screenAccess(navRequires('inventory-counts'));
  const { principal, access, activeEntityId, can } = await guard;
  if (!can('inventory.stock.adjust', 'entity')) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = companyParam((await searchParams).company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const review = await getStockCountReview(entityId, { countId: id });
  if (!review.ok && review.error === 'stock_count_missing') notFound();
  const t = await getTranslations('inventory.counts');
  if (!review.ok) {
    return (
      <Page title={t('printSheet.title')}>
        <FailureMessage failure={firstFailure(review)} />
      </Page>
    );
  }
  const { count, lines } = review.data;
  const scopeSize = (count.scope === 'bins' ? count.binIds : count.itemIds)?.length ?? 0;
  const sheet = renderStockCountSheet(
    {
      company: companyNames(access)[count.entityId] ?? String(count.entityId),
      hub: `${count.hubName} (${count.hubCode})`,
      scope:
        count.scope === 'hub' ? t('scopes.hub') : t(`scopes.${count.scope}`, { count: scopeSize }),
      state: t(`states.${count.state}`),
      startedAt: count.startedAt,
      startedBy: count.startedByName,
      postedAt: count.postedAt,
      note: count.postNote,
      lines: lines.map((l) => ({
        bin: l.binCode,
        item: l.itemName,
        sku: l.sku,
        serial: l.serialNo,
        atStart: l.expectedAtStart,
        moved: l.movedDuringCount,
        expected: l.expectedAtCount,
        counted: l.counted,
        variance: l.variance,
        value: l.value,
      })),
      showsValues: review.data.showsValues,
      netValue: review.data.netValue,
      printedOn: istDate(new Date()),
    },
    { fonts: 'viewer' },
  );
  return (
    <Page title={t('printSheet.title')} description={t('printSheet.intro')}>
      <CountSheetFrame html={sheet.html} />
    </Page>
  );
}
