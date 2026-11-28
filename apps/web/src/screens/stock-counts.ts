// H3's stock count screens (docs/03-roadmap-appendix/phase3.md §7.3): links, tones and reading what
// a counter types or scans. Pure functions, so the screens and their tests share them.

import type { StockCountSheetRowDto, StockCountState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The counting screen of a count, in its company, on one bin when one is named. */
export function countHref(entityId: number, countId: string, binId?: string): Route {
  const bin = binId === undefined ? '' : `&bin=${binId}`;
  return `/inventory/counts/${countId}?company=${String(entityId)}${bin}` as Route;
}

/**
 * Up to this many items in bins, the counting screen shows every bin at once; above it, one bin
 * at a time, so a whole hub's count stays light on a phone.
 */
export const ALL_BINS_UP_TO = 100;

/** A bin of a count as the counting screen offers it: how many of its items are left to count. */
export interface CountBin {
  binId: string;
  binCode: string;
  left: number;
}

/** The bins of a counter's sheet in its order, each with its items still to count or again. */
export function countBins(rows: readonly StockCountSheetRowDto[]): CountBin[] {
  const bins = new Map<string, CountBin>();
  for (const row of rows) {
    const bin = bins.get(row.binId) ?? { binId: row.binId, binCode: row.binCode, left: 0 };
    if (row.state !== 'counted') bin.left += 1;
    bins.set(row.binId, bin);
  }
  return [...bins.values()];
}

/**
 * The bin the counting screen shows: the one asked for when the sheet has it; otherwise every
 * bin (null) for a small count, or the first bin with items left (else the first) for a large one.
 */
export function shownBin(
  rows: readonly StockCountSheetRowDto[],
  asked: string | undefined,
): string | null {
  const bins = countBins(rows);
  if (asked !== undefined && bins.some((b) => b.binId === asked)) return asked;
  if (rows.length <= ALL_BINS_UP_TO) return null;
  return (bins.find((b) => b.left > 0) ?? bins[0])?.binId ?? null;
}

/** The review of a count, in its company. */
export function countReviewHref(entityId: number, countId: string): Route {
  return `/inventory/counts/${countId}/review?company=${String(entityId)}` as Route;
}

/** The printable sheet of a count, in its company. */
export function countSheetHref(entityId: number, countId: string): Route {
  return `/inventory/counts/${countId}/sheet?company=${String(entityId)}` as Route;
}

/** The badge tone of a count's state. */
export function countStateTone(state: StockCountState): StatusTone {
  switch (state) {
    case 'open':
      return 'neutral';
    case 'counting':
      return 'info';
    case 'review':
      return 'warning';
    case 'posted':
      return 'success';
    case 'cancelled':
      return 'neutral';
  }
}

/** A counted quantity as the record command takes it: zero or more, up to three decimals. */
export function countedQtyFromTyped(typed: string): string | undefined {
  const text = typed.trim().replaceAll(',', '');
  return /^\d{1,9}(\.\d{1,3})?$/.test(text) ? text : undefined;
}

/**
 * What a code scanned or typed into the serial field is, in the shape the scan field's `resolve`
 * answers (U2, question 8 (a)): a serial to add, a repeat of one already added, or a code that
 * does not fit the item's serial pattern. Whether the company knows the serial is said when the
 * count is saved, by the server.
 */
export type SerialResolution =
  | { status: 'ok'; code: string }
  | { status: 'repeat'; code: string }
  | { status: 'pattern'; code: string }
  | { status: 'empty' };

/** The item's serial pattern as the catalogue keeps it, anchored, or null when it has none. */
function patternOf(pattern: string | null): RegExp | null {
  if (pattern === null || pattern === '') return null;
  try {
    return new RegExp(`^(?:${pattern})$`, 'u');
  } catch {
    // A pattern the catalogue refused cannot be stored; one that fails here checks nothing.
    return null;
  }
}

/** Resolves a scanned or typed code against the serials already added and the item's pattern. */
export function resolveSerial(
  typed: string,
  added: readonly string[],
  pattern: string | null,
): SerialResolution {
  const code = typed.trim();
  if (code === '') return { status: 'empty' };
  if (added.some((s) => s.toLowerCase() === code.toLowerCase())) return { status: 'repeat', code };
  const rule = patternOf(pattern);
  if (rule !== null && !rule.test(code)) return { status: 'pattern', code };
  return { status: 'ok', code };
}

/** A ledger quantity that may be below zero (`-2.500`) as a person reads it, with its sign. */
export function formatSignedQty(qty: string, format: (unsigned: string) => string): string {
  if (qty.startsWith('-')) {
    const rest = qty.slice(1);
    return /^0*(\.0*)?$/.test(rest) ? format(rest) : `-${format(rest)}`;
  }
  return Number(qty) > 0 ? `+${format(qty)}` : format(qty);
}
