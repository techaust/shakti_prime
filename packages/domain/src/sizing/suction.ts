import { bounded, requireFinite, type Bounded } from './bounds';

export interface SuctionInput {
  /** Depth from ground level to the water at rest, in metres. */
  readonly staticLevelM: number;
  /** How far the water level falls while the pump runs, in metres. */
  readonly drawdownM: number;
  /**
   * The deepest water a surface pump can draw up, in metres
   * (`WORKSHOP_DEFAULTS.sizing.surfaceMaxSuctionLiftM`).
   */
  readonly maxSuctionLiftM: number;
}

export interface SuctionResult extends Bounded {
  /** How far a surface pump must draw the water up: the water level while pumping, in metres. */
  readonly suctionLiftM: number;
  readonly maxSuctionLiftM: number;
}

/** Floating-point noise below a millionth of a metre is not an excess. */
const EPSILON = 1e-6;

/**
 * The suction lift of a surface pump: it sits at ground level and draws the water up to itself,
 * so the water while pumping (its level at rest plus the drawdown) must be no deeper than the
 * pump can pull. Air pressure caps that near 10 m at sea level and practice near 7 m, below which
 * the water boils off in the suction pipe and the pump runs dry. Out of bounds
 * (`suction_lift_exceeded`) when the water is deeper; a submersible sits in the water and has no
 * suction lift, so `sizePump` checks surface pumps only.
 */
export function suctionLift(input: SuctionInput): SuctionResult {
  requireFinite('staticLevelM', input.staticLevelM);
  requireFinite('drawdownM', input.drawdownM);
  requireFinite('maxSuctionLiftM', input.maxSuctionLiftM, { positive: true });

  const suctionLiftM = input.staticLevelM + input.drawdownM;
  return {
    suctionLiftM,
    maxSuctionLiftM: input.maxSuctionLiftM,
    ...bounded(suctionLiftM > input.maxSuctionLiftM + EPSILON ? ['suction_lift_exceeded'] : []),
  };
}
