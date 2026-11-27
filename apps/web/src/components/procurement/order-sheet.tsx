import type { PurchaseOrderDto, PurchaseOrderWithRatesDto } from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import { formatDate, formatDateTime, formatRupees } from '../../screens/format';
import { formatRate } from '../../screens/procurement';
import { ORDER_STATE_TONE, outstanding, plainQty } from '../../screens/purchase-orders';
import { ScrollTable } from '../home/scroll-table';

/** Whether the order arrived with its rates (a holder of `procurement.rate.read`). */
export function hasRates(
  order: PurchaseOrderDto | PurchaseOrderWithRatesDto,
): order is PurchaseOrderWithRatesDto {
  return 'totals' in order;
}

/**
 * The order sheet's details and lines (docs/03-roadmap-appendix/phase3.md §7.2), rendered on the
 * server. Rates, amounts and the tax split are printed only when the order arrived with them,
 * which `getPurchaseOrder` does only for a holder of `procurement.rate.read`.
 */
export async function OrderSheet({
  order,
}: {
  order: PurchaseOrderDto | PurchaseOrderWithRatesDto;
}) {
  const t = await getTranslations('procurement.orderSheet');
  const states = await getTranslations('procurement.orderStates');
  const units = await getTranslations('catalogue.units');
  const withRates = hasRates(order);
  const details: [string, string][] = [
    [t('vendor'), order.vendorName],
    [t('hub'), order.hubName],
    [t('expected'), order.expectedAt === null ? t('noDate') : formatDate(order.expectedAt)],
    [t('source'), order.source === 'reorder' ? t('fromReorder') : t('byPerson')],
    [t('draftedBy'), order.draftedByName ?? t('platform')],
    ...(order.approvedAt === null
      ? []
      : ([
          [t('approvedBy'), `${order.approvedByName ?? ''} · ${formatDateTime(order.approvedAt)}`],
        ] as [string, string][])),
    ...(order.sentAt === null
      ? []
      : ([
          [
            t('sent'),
            `${formatDateTime(order.sentAt)} · ${order.sentVia === 'email' ? t('byEmail') : t('byHand')}`,
          ],
        ] as [string, string][])),
    ...(order.cancelReason === null
      ? []
      : ([[t('cancelReason'), order.cancelReason]] as [string, string][])),
    ...(order.closeReason === null
      ? []
      : ([[t('closeReason'), order.closeReason]] as [string, string][])),
    ...(order.notes === null ? [] : ([[t('notes'), order.notes]] as [string, string][])),
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={ORDER_STATE_TONE[order.state]}>{states(order.state)}</StatusBadge>
        {order.overdue ? <StatusBadge tone="danger">{t('overdue')}</StatusBadge> : null}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-text-muted text-sm">{label}</dt>
            <dd className="text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {/* A labelled region the keyboard can scroll while the lines are wider than a phone. */}
      <ScrollTable label={t('linesCaption')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('linesCaption')}</caption>
          <thead className="bg-surface-2 text-text-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('item')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('hsn')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('ordered')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('received')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('gst')}
              </th>
              {withRates ? (
                <>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('rate')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('amount')}
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => {
              const rate = withRates ? order.lines.find((l) => l.id === line.id) : undefined;
              return (
                <tr key={line.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <span className="font-medium">{line.itemName}</span>
                    <span className="text-text-muted block text-xs">{line.sku}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{line.hsn}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {plainQty(line.qty)} {units(line.purchaseUnit)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {plainQty(line.qtyReceived)}
                    <span className="text-text-muted block text-xs">
                      {t('toCome', { qty: outstanding(line.qty, line.qtyReceived) })}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.taxRatePct === null ? t('noGst') : `${plainQty(line.taxRatePct)} %`}
                  </td>
                  {withRates ? (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {rate?.unitRate == null ? t('noRate') : formatRate(rate.unitRate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {rate?.amount == null ? '' : formatRupees(rate.amount)}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
      {withRates && order.totals !== null ? (
        <dl className="ml-auto grid w-full max-w-sm grid-cols-2 gap-y-1 text-sm">
          <dt className="text-text-muted">{t('subtotal')}</dt>
          <dd className="text-right tabular-nums">{formatRupees(order.totals.subtotal)}</dd>
          {order.totals.igst === '0.00' ? (
            <>
              <dt className="text-text-muted">{t('cgst')}</dt>
              <dd className="text-right tabular-nums">{formatRupees(order.totals.cgst)}</dd>
              <dt className="text-text-muted">{t('sgst')}</dt>
              <dd className="text-right tabular-nums">{formatRupees(order.totals.sgst)}</dd>
            </>
          ) : (
            <>
              <dt className="text-text-muted">{t('igst')}</dt>
              <dd className="text-right tabular-nums">{formatRupees(order.totals.igst)}</dd>
            </>
          )}
          <dt className="text-text-muted">{t('roundOff')}</dt>
          <dd className="text-right tabular-nums">{order.totals.roundOff}</dd>
          <dt className="font-medium">{t('grandTotal')}</dt>
          <dd className="text-right font-medium tabular-nums">
            {formatRupees(order.totals.grandTotal)}
          </dd>
        </dl>
      ) : withRates ? (
        <p className="text-text-muted text-sm">{t('totalsWaiting')}</p>
      ) : null}
    </div>
  );
}
