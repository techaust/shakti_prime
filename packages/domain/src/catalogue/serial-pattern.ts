import { serialFitsPattern } from '@shakti/contracts';

/** What the serial check needs of an item: its pattern, if it has one. */
export interface ItemSerialPattern {
  serialPattern: string | null;
}

/**
 * Whether a scanned serial fits its item's serial pattern (phase3 §6.1): goods receipt (U2) and
 * stock counts (H3) refuse a serial that does not, as the scan of a wrong code. An item with no
 * pattern takes any serial.
 */
export function serialMatchesPattern(item: ItemSerialPattern, serial: string): boolean {
  return serialFitsPattern(item.serialPattern, serial);
}

/**
 * The serials, of those an item already holds, that a new pattern would not take, in the order
 * given; empty when it takes them all or when there is no pattern. `catalogue.item.update`
 * refuses a pattern that leaves any out. No serials exist before H1's ledger, so its caller, which
 * reads the item's serials, comes with H1's merge.
 */
export function serialsOutsidePattern(
  pattern: string | null,
  serials: readonly string[],
): string[] {
  if (pattern === null) return [];
  return serials.filter((serial) => !serialFitsPattern(pattern, serial));
}
