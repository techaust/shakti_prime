// H3's stock count screens (docs/03-roadmap-appendix/phase3.md §7.3): links, tones and reading what
// a counter types or scans. Pure functions, so the screens and their tests share them.

import type { StockCountState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The counting screen of a count, in its company. */
export function countHref(entityId: number, countId: string): Route {
  return `/inventory/counts/${countId}?company=${String(entityId)}` as Route;
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
