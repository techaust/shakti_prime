// H1's stock screens (docs/03-roadmap-appendix/phase3.md §6.2): links, and reading what a person
// types. Pure functions, so the screens and their tests share them.

import type { Route } from 'next';
import { groupIndian } from '../print/format';

/** A ledger quantity (`12.500`) as a person reads it: lakh grouping, no trailing zeros (`12.5`). */
export function formatQty(qty: string): string {
  const [whole = '0', fraction = ''] = qty.split('.');
  const kept = fraction.replace(/0+$/, '');
  const grouped = groupIndian(whole.replace(/^0+(?=\d)/, ''));
  return kept === '' ? grouped : `${grouped}.${kept}`;
}

/** A typed quantity as the commands take it: above zero, up to three decimals; else undefined. */
export function quantityFromTyped(typed: string): string | undefined {
  const text = typed.trim().replaceAll(',', '');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(text)) return undefined;
  return Number(text) > 0 ? text : undefined;
}

/**
 * Serial numbers typed or scanned one per line: trimmed, blank lines dropped. Undefined when a
 * number repeats (in any case) or one is longer than 100 characters, or more than 100 are given.
 */
export function serialsFromTyped(typed: string): string[] | undefined {
  const lines = typed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0 || lines.length > 100 || lines.some((l) => l.length > 100)) {
    return undefined;
  }
  return new Set(lines.map((l) => l.toLowerCase())).size === lines.length ? lines : undefined;
}

/** An item's stock card in a company. */
export function stockCardHref(entityId: number, itemId: string): Route {
  return `/inventory/stock/${String(entityId)}/${itemId}` as Route;
}

/** A serial's page in a company. */
export function serialHref(entityId: number, serialId: string): Route {
  return `/inventory/serials/${serialId}?company=${String(entityId)}` as Route;
}

/** Today's calendar date in India, `YYYY-MM-DD`. */
export function istDate(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
