import type { SizingReason } from '@shakti/contracts';

/**
 * What every calculator result carries, so the quote guard can refuse and name why (PRD SAL-04):
 * `inBounds` is true exactly when `reasons` is empty.
 */
export interface Bounded {
  readonly inBounds: boolean;
  readonly reasons: readonly SizingReason[];
}

/** A result's bounds from its reasons: in bounds exactly when there are none. */
export function bounded(reasons: readonly SizingReason[]): Bounded {
  return { inBounds: reasons.length === 0, reasons };
}

/**
 * Refuses a value no caller should pass: the contract validates every input before a calculator
 * runs, so this is a programming error, not an engineering result.
 */
export function requireFinite(name: string, value: number, { positive = false } = {}): void {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(`${name} must be a finite number ${positive ? 'above' : 'of at least'} 0`);
  }
}

/** A fraction strictly above 0 and at most 1 (an efficiency or a performance ratio). */
export function requireFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${name} must be above 0 and at most 1`);
  }
}

/**
 * Tolerance for rounding a count up or down: 2.2 kWp in 550 Wp modules is 4.000000000000001 in
 * binary floating point and must count as 4, not 5.
 */
const COUNT_EPSILON = 1e-9;

/** The smallest whole count that covers `value` (never negative zero). */
export function ceilCount(value: number): number {
  return Math.max(0, Math.ceil(value - COUNT_EPSILON));
}

/** The largest whole count that fits within `value`. */
export function floorCount(value: number): number {
  return Math.floor(value + COUNT_EPSILON);
}

/** Litres per hour to cubic metres per second. */
export function lphToCubicMetresPerSecond(flowLph: number): number {
  return flowLph / 3_600_000;
}

/** Mechanical horsepower (550 ft·lbf/s) in kilowatts, the rating Indian pump motors carry. */
export const KW_PER_HP = 0.745_699_872;
