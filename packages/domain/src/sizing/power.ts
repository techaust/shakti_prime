import {
  bounded,
  KW_PER_HP,
  lphToCubicMetresPerSecond,
  requireFinite,
  requireFraction,
  type Bounded,
} from './bounds';

/** Density of water (kg/m³) and standard gravity (m/s²). */
const WATER_DENSITY = 1000;
const GRAVITY = 9.806_65;

export interface PowerInput {
  /** Required flow, in litres per hour. */
  readonly flowLph: number;
  /** Total dynamic head, in metres (`totalDynamicHead`). */
  readonly tdhM: number;
  /** Pump (wet end) efficiency, above 0 and at most 1. */
  readonly pumpEfficiency: number;
  /** Motor efficiency, above 0 and at most 1. */
  readonly motorEfficiency: number;
  /** Motor ratings on sale, in HP, ascending (`WORKSHOP_DEFAULTS.sizing.standardHp`). */
  readonly standardHp: readonly number[];
}

export interface PowerResult extends Bounded {
  /** Power the water gains: ρ · g · Q · H, in kW. */
  readonly hydraulicKw: number;
  /** Power the pump shaft needs: hydraulic power over the pump efficiency, in kW. */
  readonly shaftKw: number;
  /** Shaft power in HP. */
  readonly shaftHp: number;
  /** Electrical power the motor draws at that duty: shaft power over the motor efficiency, in kW. */
  readonly motorInputKw: number;
  /** The smallest standard rating that covers the shaft power, or null above the largest. */
  readonly standardHp: number | null;
  /** That rating in kW, or null. */
  readonly standardKw: number | null;
}

/**
 * Pump power from flow and head. The water gains `ρ · g · Q · H`; the shaft needs that over the
 * pump efficiency, and the motor draws the shaft power over its own efficiency. The motor is
 * rated by its output, so the chosen rating is the smallest standard HP at or above the shaft
 * power. Out of bounds (`above_largest_standard_hp`) when no standard rating covers it.
 */
export function pumpPower(input: PowerInput): PowerResult {
  requireFinite('flowLph', input.flowLph);
  requireFinite('tdhM', input.tdhM);
  requireFraction('pumpEfficiency', input.pumpEfficiency);
  requireFraction('motorEfficiency', input.motorEfficiency);
  if (input.standardHp.length === 0) throw new RangeError('standardHp must list a rating');

  const flowM3s = lphToCubicMetresPerSecond(input.flowLph);
  const hydraulicKw = (WATER_DENSITY * GRAVITY * flowM3s * input.tdhM) / 1000;
  const shaftKw = hydraulicKw / input.pumpEfficiency;
  const shaftHp = shaftKw / KW_PER_HP;
  const standardHp = nextStandardHp(shaftHp, input.standardHp);

  return {
    hydraulicKw,
    shaftKw,
    shaftHp,
    motorInputKw: shaftKw / input.motorEfficiency,
    standardHp,
    standardKw: standardHp === null ? null : standardHp * KW_PER_HP,
    ...bounded(standardHp === null ? ['above_largest_standard_hp'] : []),
  };
}

/**
 * The smallest rating in `ratings` at or above `hp`, or null when `hp` exceeds them all. A shaft
 * power within a millionth of an HP of a rating takes that rating, so floating-point noise never
 * moves a pump up a size.
 */
export function nextStandardHp(hp: number, ratings: readonly number[]): number | null {
  const sorted = [...ratings].sort((a, b) => a - b);
  return sorted.find((rating) => rating >= hp - 1e-6) ?? null;
}
