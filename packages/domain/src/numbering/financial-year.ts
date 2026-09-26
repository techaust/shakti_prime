import type { DocType, FinancialYear } from '@shakti/contracts';

/** India has one time zone and no daylight saving: a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60_000;

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

/** Indian financial year of an instant, April to March in IST, written `2026-27`. */
export function financialYear(at: Date): FinancialYear {
  const { year, month } = istParts(at);
  const start = month >= 4 ? year : year - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const DOC_CODES: Record<DocType, string> = {
  quote: 'Q',
  sales_order: 'SO',
  proforma: 'PI',
  challan: 'DC',
  purchase_order: 'PO',
};

/** Series prefix per entity and document type. Format is a discovery-workshop input (BLUEPRINT §19). */
export function documentPrefix(entityCode: string, docType: DocType): string {
  return `${entityCode}/${DOC_CODES[docType]}`;
}

/** The printed number. Change the format here and nowhere else. */
export function formatDocumentNo(prefix: string, fy: FinancialYear, no: number): string {
  return `${prefix}/${fy}/${String(no).padStart(4, '0')}`;
}
