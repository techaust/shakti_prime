// India's calendar day for screens and print. Browser code takes no value from the domain package
// (docs/08-design-system.md §10, the per-page budget), so this is the web app's one copy of the
// domain's `IST_OFFSET_MS` and `istCalendarDate()`; `ist.test.ts` holds the two equal.

/** India has one time zone and no daylight saving: a fixed offset is exact. */
export const IST_OFFSET_MS = 330 * 60_000;

/** The day in India a moment falls on, as `YYYY-MM-DD`. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
