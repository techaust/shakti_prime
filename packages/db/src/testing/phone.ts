/**
 * A made-up Indian mobile number for the suites on real Postgres: ten digits, the first 6 to 9
 * (audit OPS-18). Drawn at random, two suites could pick one number, and `crm.lead.create` then
 * refuses the second as a colleague's customer, a failure that has nothing to do with the change
 * under test.
 *
 * The numbers count up from the clock in milliseconds, one counter per test file. The files of a
 * run go one after another and each draws fewer numbers than the milliseconds it runs for, so no
 * two numbers of a run meet; a later run starts from a later time, so it does not meet an earlier
 * run's numbers left on a long-lived database either, until the count goes round after 46 days.
 */
const SPAN = 4_000_000_000;
let last = 0;

export function testPhone(now: number = Date.now()): string {
  last = Math.max(last + 1, now % SPAN);
  const n = last % SPAN;
  return `${String(6 + Math.floor(n / 1e9))}${String(n % 1e9).padStart(9, '0')}`;
}
