/** The ISO day of the week (1 Monday to 7 Sunday) of a `YYYY-MM-DD` calendar date. */
export function isoDayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
