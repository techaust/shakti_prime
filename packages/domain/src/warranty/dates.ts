/**
 * Warranty dates (R3, docs/03-roadmap-appendix/phase3.md §7.5), calendar dates in India written
 * `YYYY-MM-DD`. Pure, so the installed base import and the dispatch's delivery (D2) give a serial
 * the same date.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;

function realDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1) return undefined;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A date as a spreadsheet gives it: `DD-MM-YYYY` (or with `/` or `.`), as the screens write it, or
 * `YYYY-MM-DD`, as a date cell of a workbook reads. Undefined for anything else or a day that
 * does not exist.
 */
export function parseSheetDate(text: string): string | undefined {
  const value = text.trim();
  const iso = ISO.exec(value);
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DMY.exec(value);
  if (dmy) return realDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return undefined;
}

/**
 * The last day of a warranty of `months` months from delivery: the day before the same date
 * `months` months later; when that month has no such date, the day before its last day. A
 * 12-month warranty from 10-03-2026 runs to 09-03-2027; a one-month warranty from 31-01-2026 runs
 * to 27-02-2026, and a 12-month one from 29-02-2028 to 27-02-2029. The client confirms the rule,
 * the month-end case with it (phase3 §12 question 10).
 */
export function warrantyUntilFrom(deliveredOn: string, months: number): string {
  const m = ISO.exec(deliveredOn);
  if (!m || !Number.isInteger(months) || months < 0) {
    throw new RangeError('a delivery date as YYYY-MM-DD and whole months');
  }
  const year = Number(m[1]);
  const month = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const last = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const same = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, last)));
  const until = new Date(same.getTime() - 24 * 60 * 60 * 1000);
  return until.toISOString().slice(0, 10);
}
