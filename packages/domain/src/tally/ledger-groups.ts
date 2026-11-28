/**
 * TC2: which party ledgers the BOS keeps (docs/03-roadmap-appendix/phase5.md §6.3). Dealer
 * outstanding needs the ledgers under Sundry Debtors only; anyone with `finance.read` reads the
 * stored ones, so a supplier's, bank's or expense ledger must not be kept. The connector reads
 * the ledgers that belong to Sundry Debtors (Tally's `IsBelongsTo`), directly or through a group
 * the company made under it, and sends each one's immediate group as `parent`. The BOS cannot see
 * the path above a company's own group, so it refuses a ledger whose group is one of the groups
 * Tally itself starts every company with, other than Sundry Debtors.
 */

/** The groups Tally starts every company with: fifteen primary groups and thirteen beneath them. */
const TALLY_OWN_GROUPS: readonly string[] = [
  'Branch / Divisions',
  'Capital Account',
  'Current Assets',
  'Current Liabilities',
  'Direct Expenses',
  'Direct Incomes',
  'Fixed Assets',
  'Indirect Expenses',
  'Indirect Incomes',
  'Investments',
  'Loans (Liability)',
  'Misc. Expenses (ASSET)',
  'Purchase Accounts',
  'Sales Accounts',
  'Suspense A/c',
  'Bank Accounts',
  'Bank OD A/c',
  'Cash-in-Hand',
  'Deposits (Asset)',
  'Duties & Taxes',
  'Loans & Advances (Asset)',
  'Provisions',
  'Reserves & Surplus',
  'Secured Loans',
  'Stock-in-Hand',
  'Sundry Creditors',
  'Sundry Debtors',
  'Unsecured Loans',
];

const SUNDRY_DEBTORS = 'sundry debtors';

/** A group name as Tally compares them: case and runs of spaces do not matter. */
function groupKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const OTHER_OWN_GROUPS: ReadonlySet<string> = new Set(
  TALLY_OWN_GROUPS.map(groupKey).filter((g) => g !== SUNDRY_DEBTORS),
);

/**
 * True when a ledger with this immediate group may be a party ledger under Sundry Debtors: the
 * group is Sundry Debtors or one the company made. False for every other group Tally starts a
 * company with (Sundry Creditors, Purchase Accounts, Bank Accounts and the rest).
 */
export function isDebtorLedgerParent(parent: string): boolean {
  return !OTHER_OWN_GROUPS.has(groupKey(parent));
}
