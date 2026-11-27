// Procurement's screen helpers (docs/03-roadmap-appendix/phase3.md §6.3). They only format what a
// DTO carries: no screen compares or computes a rate; the comparison's lowest mark is the query's.

import type { StatusTone } from '@shakti/ui';
import { groupIndian } from '../print/format';

const RATE = /^(\d+)\.(\d{4})$/;

/**
 * A supplier's rate as the DTO carries it (`41.5000`, four decimals) in rupees with lakh grouping,
 * keeping two decimals and the third and fourth only when they are not zero (`₹41.50`,
 * `₹12.3456`). Works on the string itself, so no rounding can creep in.
 */
export function formatRate(rate: string): string {
  const match = RATE.exec(rate.trim());
  if (!match) throw new RangeError('rate is not a four-decimal string');
  const [, whole = '0', decimals = '0000'] = match;
  const kept = decimals.replace(/0{1,2}$/, '').padEnd(2, '0');
  return `₹${groupIndian(whole.replace(/^0+(?=\d)/, ''))}.${kept}`;
}

/** A quantity as `numeric(12,3)` returns it (`500.000`) without trailing zeros (`500`). */
export function formatQuantity(qty: string): string {
  const [whole = '0', decimals = ''] = qty.split('.');
  const kept = decimals.replace(/0+$/, '');
  return `${groupIndian(whole.replace(/^0+(?=\d)/, ''))}${kept === '' ? '' : `.${kept}`}`;
}

/** A rate as a person types it (`₹ 1,250.5`) in the form the record command takes (`1250.5`). */
export function rateFromTyped(typed: string): string | undefined {
  const cleaned = typed.replaceAll(/[\s,₹]/g, '');
  return /^\d{1,10}(\.\d{1,4})?$/.test(cleaned) && Number(cleaned) > 0 ? cleaned : undefined;
}

/** How each quote status shows. */
export const QUOTE_STATUS_TONE: Record<'live' | 'upcoming' | 'expired' | 'withdrawn', StatusTone> =
  {
    live: 'success',
    upcoming: 'info',
    expired: 'neutral',
    withdrawn: 'neutral',
  };
