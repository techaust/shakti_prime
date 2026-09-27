// Display formats for printed documents (DESIGN.md §9, §11.1 rule 5). These only format
// amounts and dates that were already computed by the domain; they never do money arithmetic.

const MONEY = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Indian digit grouping: the last three digits, then pairs (12,34,567). */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const pairs: string[] = [];
  while (rest.length > 2) {
    pairs.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) pairs.unshift(rest);
  return `${pairs.join(',')},${last}`;
}

/**
 * A money string from a DTO ("1234567.5", "-40.00") as ₹ with lakh and crore grouping and
 * paise ("₹12,34,567.50"). Works on the string itself, so no rounding can creep in.
 */
export function formatRupees(amount: string): string {
  const match = MONEY.exec(amount.trim());
  if (!match) throw new RangeError('amount is not a money string');
  const [, minus, whole = '0', paise = ''] = match;
  const rupees = groupIndian(whole.replace(/^0+(?=\d)/, ''));
  return `${minus ? '-' : ''}₹${rupees}.${paise.padEnd(2, '0')}`;
}

/** The same grouping without the sign, for quantities and plain amounts in tables. */
export function formatAmount(amount: string): string {
  return formatRupees(amount).replace('₹', '');
}

const IST_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** DD-MM-YYYY in IST, for an instant or a calendar date ("2026-09-27"). */
export function formatDate(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d ?? ''}-${m ?? ''}-${y ?? ''}`;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError('not a date');
  const parts = Object.fromEntries(IST_DATE.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day ?? ''}-${parts.month ?? ''}-${parts.year ?? ''}`;
}
