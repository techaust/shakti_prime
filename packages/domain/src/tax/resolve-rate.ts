import { type CalendarDate, DomainError, type TaxRateRow } from '@shakti/contracts';
import { istCalendarDate } from '../numbering/financial-year';

export interface RateQuery {
  hsn: string | null;
  itemId: string | null;
  /** The document date; rates resolve on its calendar date in IST. */
  on: Date;
}

interface Effective {
  effectiveFrom: CalendarDate;
  effectiveTo: CalendarDate | null;
}

/** Rows are effective on `[effective_from, effective_to)`, as the exclusion constraints read them. */
export function effectiveOn(row: Effective, day: CalendarDate): boolean {
  return row.effectiveFrom <= day && (row.effectiveTo === null || day < row.effectiveTo);
}

function single<T extends { id: string }>(rows: T[], what: string): T | undefined {
  if (rows.length > 1) {
    // The exclusion constraints make this impossible; a second row means the caller mixed sources.
    throw new DomainError('internal', `${String(rows.length)} ${what} rates overlap`);
  }
  return rows[0];
}

/**
 * The GST rate of a line on the document date (ADR 0007): an item's own row wins over its HSN
 * row. The engine never reads tables; the command passes every candidate row.
 */
export function resolveRate(rates: readonly TaxRateRow[], query: RateQuery): TaxRateRow {
  const day = istCalendarDate(query.on);
  const live = rates.filter((row) => effectiveOn(row, day));
  const byItem =
    query.itemId === null
      ? undefined
      : single(
          live.filter((row) => row.itemId === query.itemId),
          'item',
        );
  if (byItem) return byItem;
  const byHsn =
    query.hsn === null
      ? undefined
      : single(
          live.filter((row) => row.itemId === null && row.hsn === query.hsn),
          'HSN',
        );
  if (byHsn) return byHsn;
  throw new DomainError('validation_failed', `no tax rate on ${day}`, {
    reason: 'tax_rate_missing',
    hsn: query.hsn,
    day,
  });
}
