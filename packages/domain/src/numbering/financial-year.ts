import type { DocType, FinancialYear } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/**
 * India has one time zone and no daylight saving: a fixed offset is exact. The domain's one copy
 * (audit ARCH-11); `apps/web/src/screens/ist.ts` holds the browser's, tested equal to this one.
 */
export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

function istParts(at: Date): { year: number; month: number; day: number } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The calendar date in IST as `YYYY-MM-DD`, the form Postgres `date` columns use. */
export function istCalendarDate(at: Date): string {
  const { year, month, day } = istParts(at);
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The instant the IST calendar day of `at` began (00:00 IST). */
export function istDayStart(at: Date): Date {
  const local = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** Indian financial year of an instant, April to March in IST, written `2026-27`. */
export function financialYear(at: Date): FinancialYear {
  const { year, month } = istParts(at);
  const start = month >= 4 ? year : year - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Series prefix per entity and document type, in the workshop default format (SALE-1,
 * `WORKSHOP_DEFAULTS.numbering`).
 */
export function documentPrefix(entityCode: string, docType: DocType): string {
  const { docCodes, separator } = WORKSHOP_DEFAULTS.numbering;
  return `${entityCode}${separator}${docCodes[docType]}`;
}

/** The printed number (SALE-1): the series prefix, the financial year and the padded serial. */
export function formatDocumentNo(prefix: string, fy: FinancialYear, no: number): string {
  const { separator, serialDigits } = WORKSHOP_DEFAULTS.numbering;
  return `${prefix}${separator}${fy}${separator}${String(no).padStart(serialDigits, '0')}`;
}
