import type { SizingReason } from '@shakti/contracts';
import { bounded, requireFinite, type Bounded } from './bounds';

export interface PumpMatchInput {
  /** Flow the chosen pump delivers at the sized head (`pumpDutyPoint`); null off its curve. */
  readonly dutyFlowLph: number | null;
  /** Flow the site needs, in litres per hour (the sizing's input). */
  readonly requiredFlowLph: number;
  /** The chosen pump's rated HP from its specifications; null when not given. */
  readonly ratedHp: number | null;
  /** The standard rating the sizing chose (`pumpPower().standardHp`); null above the largest. */
  readonly sizedHp: number | null;
  /**
   * How far below the needed flow the duty flow may fall (0.1 = 10% short at most;
   * `WORKSHOP_DEFAULTS.sizing.dutyFlowTolerance`).
   */
  readonly dutyFlowTolerance: number;
  /**
   * How many times the needed flow the duty flow may reach before the pump is too large for the
   * site (`WORKSHOP_DEFAULTS.sizing.dutyFlowOvershootFactor`).
   */
  readonly dutyFlowOvershootFactor: number;
}

export interface PumpMatchResult extends Bounded {
  readonly requiredFlowLph: number;
  /** The least duty flow that meets the need: the needed flow less the tolerance. */
  readonly minFlowLph: number;
  /** The most duty flow before the pump is too large: the needed flow times the overshoot. */
  readonly maxFlowLph: number;
  readonly ratedHp: number | null;
}

/** Floating-point noise below a millionth is not a shortfall or an excess. */
const EPSILON = 1e-6;

/**
 * Whether the chosen pump suits the site, beyond running on its curve. Its duty flow must reach
 * the needed flow less the tolerance (`duty_flow_short`) and stay within the overshoot factor of
 * it (`duty_flow_excess`: a pump that large wastes power and, on solar, panels), and its rated HP,
 * when its specifications give one, must reach the standard rating the sizing chose
 * (`pump_power_short`). A flow off the curve is judged by `pumpDutyPoint` alone, and a rating not
 * given skips the power check rather than guessing.
 */
export function pumpMatch(input: PumpMatchInput): PumpMatchResult {
  requireFinite('requiredFlowLph', input.requiredFlowLph);
  requireFinite('dutyFlowTolerance', input.dutyFlowTolerance);
  requireFinite('dutyFlowOvershootFactor', input.dutyFlowOvershootFactor, { positive: true });
  if (input.dutyFlowTolerance >= 1) throw new RangeError('dutyFlowTolerance must be below 1');
  if (input.dutyFlowOvershootFactor < 1) {
    throw new RangeError('dutyFlowOvershootFactor must be at least 1');
  }
  if (input.dutyFlowLph !== null) requireFinite('dutyFlowLph', input.dutyFlowLph);

  const minFlowLph = input.requiredFlowLph * (1 - input.dutyFlowTolerance);
  const maxFlowLph = input.requiredFlowLph * input.dutyFlowOvershootFactor;
  const reasons: SizingReason[] = [];
  if (input.dutyFlowLph !== null) {
    if (input.dutyFlowLph < minFlowLph - EPSILON) reasons.push('duty_flow_short');
    else if (input.dutyFlowLph > maxFlowLph + EPSILON) reasons.push('duty_flow_excess');
  }
  if (input.ratedHp !== null && input.sizedHp !== null && input.ratedHp < input.sizedHp - EPSILON) {
    reasons.push('pump_power_short');
  }
  return {
    requiredFlowLph: input.requiredFlowLph,
    minFlowLph,
    maxFlowLph,
    ratedHp: input.ratedHp,
    ...bounded(reasons),
  };
}
