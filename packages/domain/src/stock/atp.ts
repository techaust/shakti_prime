/**
 * Availability to promise (H2, docs/03-roadmap-appendix/phase3.md §7.1): pure, on quantities in
 * thousandths of the stock unit, so no float ever decides a status. `app.line_availability()` and
 * the reservation definers apply the same rules in the database; `atp.test.ts` and the security
 * suite hold the two equal on generated kits and lines.
 */

/** The bin kinds that hold free stock; receiving, dispatch, transit, quarantine and surplus never do. */
export const FREE_STOCK_BIN_KIND = 'storage';

/** One balance row as the ledger keeps it: a company's on hand and reserved in one bin. */
export interface BalanceFacts {
  hubId: string;
  binKind: string;
  /** Thousandths of the stock unit. */
  onHand: number;
  reserved: number;
}

/**
 * Free stock of an item: on hand less reserved, in storage bins only, optionally of one hub. A
 * bin whose reserved exceeds its on hand (never, by the database's check) counts nothing.
 */
export function itemAvailability(
  balances: readonly BalanceFacts[],
  options: { hubId?: string } = {},
): number {
  let free = 0;
  for (const b of balances) {
    if (b.binKind !== FREE_STOCK_BIN_KIND) continue;
    if (options.hubId !== undefined && b.hubId !== options.hubId) continue;
    free += Math.max(b.onHand - b.reserved, 0);
  }
  return free;
}

export interface KitComponent {
  itemId: string;
  /** Thousandths per kit, above zero. */
  perKit: number;
}

export interface KitAvailability {
  /** Whole kits the components' free stock makes. */
  kits: number;
  /** The component that allows the fewest kits (the first such, in the kit's order); null for a kit with no stocked component. */
  limitingItemId: string | null;
}

/**
 * The largest number of whole kits the free stock makes: the floor of each component's free stock
 * over its quantity per kit, the smallest of them, with the component that sets it. A kit whose
 * components are all kept out of stock (services) is not limited by stock: `kits` is
 * `Number.POSITIVE_INFINITY`.
 */
export function kitAvailability(
  components: readonly KitComponent[],
  freeByItem: ReadonlyMap<string, number>,
): KitAvailability {
  let kits = Number.POSITIVE_INFINITY;
  let limitingItemId: string | null = null;
  for (const c of components) {
    if (c.perKit <= 0) throw new RangeError('a kit component needs a quantity above zero');
    const made = Math.floor((freeByItem.get(c.itemId) ?? 0) / c.perKit);
    if (made < kits) {
      kits = made;
      limitingItemId = c.itemId;
    }
  }
  return { kits, limitingItemId };
}

export type LineStatus = 'covered' | 'partly_covered' | 'short';

/** Open purchase quantities of the line's item, each with its expected date (U2's purchase orders). */
export interface OpenPurchase {
  /** Thousandths of the stock unit (kits for a kit line). */
  qty: number;
  /** IST calendar date, `YYYY-MM-DD`. */
  expectedOn: string;
}

export interface LineAvailability {
  status: LineStatus;
  /** When receipts on open purchase orders would cover the line; null when covered or unknown. */
  expectedOn: string | null;
}

/**
 * A line's status: covered when what is available meets the quantity, partly covered when some
 * is, short when none is; with open purchases, the date the earliest receipts would cover the rest.
 * `available` and `qty` are in the line's unit, thousandths (kits for a kit line).
 */
export function lineAvailability(
  qty: number,
  available: number,
  openPurchases: readonly OpenPurchase[] = [],
): LineAvailability {
  if (available >= qty) return { status: 'covered', expectedOn: null };
  const status: LineStatus = available > 0 ? 'partly_covered' : 'short';
  let covered = available;
  const byDate = [...openPurchases].sort((a, b) => a.expectedOn.localeCompare(b.expectedOn));
  for (const p of byDate) {
    covered += p.qty;
    if (covered >= qty) return { status, expectedOn: p.expectedOn };
  }
  return { status, expectedOn: null };
}

/** A quantity as the ledger writes it (`12.500`) in thousandths, and back. */
export function toThousandths(qty: string): number {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(qty.trim());
  if (!match) throw new RangeError(`not a stock quantity: ${qty}`);
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}

export function fromThousandths(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`not a stock quantity: ${String(n)}`);
  return `${String(Math.trunc(n / 1000))}.${String(n % 1000).padStart(3, '0')}`;
}
