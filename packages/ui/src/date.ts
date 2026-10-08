// Dates on screen are DD-MM-YYYY (docs/08-design-system.md §9); forms send the ISO calendar date YYYY-MM-DD.

const DMY = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one, leap years included.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `27-09-2026` → `2026-09-27`; undefined for anything that is not a real calendar date. */
export function parseDmy(text: string): string | undefined {
  const m = DMY.exec(text.trim());
  if (!m) return undefined;
  const [, dd = '', mm = '', yyyy = ''] = m;
  return isRealDate(Number(yyyy), Number(mm), Number(dd)) ? `${yyyy}-${mm}-${dd}` : undefined;
}

/** `2026-09-27` → `27-09-2026`; an empty string for anything else. */
export function formatDmy(iso: string | undefined): string {
  const m = ISO.exec(iso ?? '');
  if (!m) return '';
  const [, yyyy = '', mm = '', dd = ''] = m;
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Keeps what a person types in the DD-MM-YYYY shape: digits only, dashes put in after the day
 * and the month, at most eight digits.
 */
export function maskDmy(raw: string): string {
  const digits = raw.replaceAll(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
