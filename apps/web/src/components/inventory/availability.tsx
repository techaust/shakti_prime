'use client';

import type { AvailabilityStatus, LineAvailabilityDto, LineStockDto } from '@shakti/contracts';
import { StatusBadge, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { formatDate } from '../../screens/format';
import { plainQuantity } from '../../screens/quotes';

const TONE: Record<AvailabilityStatus, StatusTone> = {
  covered: 'success',
  partly_covered: 'warning',
  short: 'danger',
};

/** One line's availability, as `app.line_availability()` answered it for this reader. */
export type LineAvailability = LineAvailabilityDto['lines'][number];

/** A document's availability by line position, for the lines table. */
export function availabilityByPosition(
  availability: LineAvailabilityDto | undefined,
): ReadonlyMap<number, LineAvailability> {
  return new Map((availability?.lines ?? []).map((line) => [line.position, line]));
}

function hasCounts(line: LineAvailability): line is LineStockDto {
  return 'free' in line;
}

/**
 * A line's availability (H2, question 4 (a)): in stock, partly in stock, or out of stock (on order
 * with the date receipts would cover it, once purchase orders exist). The quantities show only
 * when the reader holds `inventory.stock.read`, and only then does the line carry them: free
 * stock on a quote or a draft order; held, waiting and dispatched on a confirmed order.
 */
export function AvailabilityValue({ line }: { line: LineAvailability | undefined }) {
  const t = useTranslations('inventory.availability');
  if (line === undefined) return <span className="text-text-muted">{t('none')}</span>;
  const label =
    line.status === 'short' && line.expectedOn !== null ? t('onOrder') : t(`status.${line.status}`);
  const counts: string[] = [];
  if (hasCounts(line)) {
    if (line.free !== null) counts.push(t('free', { qty: plainQuantity(line.free) }));
    if (line.reserved !== null) counts.push(t('reserved', { qty: plainQuantity(line.reserved) }));
    if (line.backordered !== null && Number(line.backordered) > 0) {
      counts.push(t('backordered', { qty: plainQuantity(line.backordered) }));
    }
    if (line.dispatched !== null) {
      counts.push(t('dispatched', { qty: plainQuantity(line.dispatched) }));
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusBadge tone={TONE[line.status]}>{label}</StatusBadge>
      {line.expectedOn === null ? null : (
        <span className="text-text-muted text-xs">
          {t('expected', { date: formatDate(line.expectedOn) })}
        </span>
      )}
      {counts.length === 0 ? null : (
        <span className="text-text-muted text-xs tabular-nums">{counts.join(' · ')}</span>
      )}
    </span>
  );
}
