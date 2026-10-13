'use client';

import type { QuoteLineDto, QuoteTotalsDto, SupplyKind } from '@shakti/contracts';
import { CardList } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { formatRupees } from '../../screens/format';
import { plainQuantity } from '../../screens/quotes';

/**
 * A quote's lines as the server priced and taxed them: every amount comes from the quote or its
 * preview, and nothing is added up here (AGENTS.md §11). A table on wider screens and a card per
 * line on a phone, so each line's amounts stay on screen (docs/08-design-system.md §5).
 */
export function QuoteLinesTable({ lines, caption }: { lines: QuoteLineDto[]; caption: string }) {
  const t = useTranslations('quotes.page');
  const gst = (line: QuoteLineDto) =>
    line.compositeRuleId === null
      ? t('gstRate', { rate: Number(line.taxRatePct ?? '0') })
      : t('worksContract', {
          goods: Number(line.goodsRatePct ?? '0'),
          services: Number(line.servicesRatePct ?? '0'),
        });
  return (
    <>
      <CardList
        label={caption}
        items={lines.map((line) => ({
          key: String(line.position),
          title: (
            <>
              <span className="block">{line.description}</span>
              <span className="text-text-muted block text-xs font-normal">{line.sku}</span>
            </>
          ),
          fields: [
            {
              id: 'position',
              label: t('lineColumns.position'),
              value: line.position,
              numeric: true,
            },
            {
              id: 'hsn',
              label: t('lineColumns.hsn'),
              value: line.hsn ?? t('noHsn'),
              numeric: true,
            },
            {
              id: 'quantity',
              label: t('lineColumns.quantity'),
              value: plainQuantity(line.qty),
              numeric: true,
            },
            {
              id: 'rate',
              label: t('lineColumns.rate'),
              value: formatRupees(line.unitPrice),
              numeric: true,
            },
            {
              id: 'taxable',
              label: t('lineColumns.taxable'),
              value: formatRupees(line.taxableValue),
              numeric: true,
            },
            { id: 'gst', label: t('lineColumns.gst'), value: gst(line) },
            {
              id: 'total',
              label: t('lineColumns.total'),
              value: formatRupees(line.lineTotal),
              numeric: true,
            },
          ],
        }))}
      />
      <QuoteLinesWide lines={lines} caption={caption} gst={gst} />
    </>
  );
}

/** The lines as a table, on wider screens. */
function QuoteLinesWide({
  lines,
  caption,
  gst,
}: {
  lines: QuoteLineDto[];
  caption: string;
  gst: (line: QuoteLineDto) => string;
}) {
  const t = useTranslations('quotes.page');
  return (
    // A wide table scrolls in a narrow window: the region takes focus, so the keyboard can scroll it.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="border-border hidden overflow-x-auto rounded-lg border md:block"
    >
      <table className="w-full min-w-160 border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-text-muted text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('lineColumns.position')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('lineColumns.item')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('lineColumns.hsn')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('lineColumns.quantity')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('lineColumns.rate')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('lineColumns.taxable')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('lineColumns.gst')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('lineColumns.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.position} className="border-border border-t align-top">
              <td className="px-3 py-2 tabular-nums">{line.position}</td>
              <td className="px-3 py-2">
                <span className="block break-words">{line.description}</span>
                <span className="text-text-muted block text-xs">{line.sku}</span>
              </td>
              <td className="px-3 py-2 tabular-nums">{line.hsn ?? t('noHsn')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{plainQuantity(line.qty)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRupees(line.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatRupees(line.taxableValue)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{gst(line)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRupees(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A quote's totals: the taxable value, each tax head the supply carries, rounding and total. */
export function QuoteTotals({
  totals,
  supplyKind,
}: {
  totals: QuoteTotalsDto;
  supplyKind: SupplyKind;
}) {
  const t = useTranslations('quotes.page');
  const rows: [string, string][] = [
    [t('subtotal'), totals.subtotal],
    ...(supplyKind === 'intra'
      ? ([
          [t('cgst'), totals.cgst],
          [t('sgst'), totals.sgst],
        ] as [string, string][])
      : ([[t('igst'), totals.igst]] as [string, string][])),
    [t('roundOff'), totals.roundOff],
  ];
  return (
    <dl className="grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 self-end text-sm">
      {rows.map(([label, amount]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="text-right tabular-nums">{formatRupees(amount)}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="border-border border-t pt-1 font-semibold">{t('grandTotal')}</dt>
        <dd className="border-border border-t pt-1 text-right font-semibold tabular-nums">
          {formatRupees(totals.grandTotal)}
        </dd>
      </div>
    </dl>
  );
}
