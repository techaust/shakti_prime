import type { SizingAdvisory } from '@shakti/contracts';
import { bounded, lphToCubicMetresPerSecond, requireFinite, type Bounded } from './bounds';

export interface HeadInput {
  /** Depth from ground level to the water surface at rest, in metres. */
  readonly staticLevelM: number;
  /** How far the water level falls while the pump runs, in metres. */
  readonly drawdownM: number;
  /** Height of the outlet above ground level, in metres. */
  readonly deliveryHeightM: number;
  /** Total length of pipe from the pump to the outlet, in metres. */
  readonly pipeLengthM: number;
  /** Inner diameter of the pipe, in millimetres. */
  readonly pipeInnerDiameterMm: number;
  /** Required flow, in litres per hour. */
  readonly flowLph: number;
  /** Losses in bends, valves and joints as a fraction of the pipe's friction loss (0.1 = 10%). */
  readonly fittingsLossFraction: number;
  /** Hazen-Williams roughness coefficient of the pipe (higher is smoother). */
  readonly hazenWilliamsC: number;
  /**
   * Water velocity above which the pipe is advised to be wider, in metres per second
   * (`WORKSHOP_DEFAULTS.sizing.maxPipeVelocityMps`).
   */
  readonly maxPipeVelocityMps: number;
}

export interface HeadResult extends Bounded {
  /** Static lift: water level at rest plus the delivery height, in metres. */
  readonly staticHeadM: number;
  readonly drawdownM: number;
  /** Friction loss along the pipe by Hazen-Williams, in metres. */
  readonly frictionM: number;
  /** Losses in the fittings, in metres. */
  readonly fittingsM: number;
  /** Total dynamic head, the sum of the parts above, in metres. */
  readonly tdhM: number;
  /** Mean water velocity in the pipe, in metres per second (advised on, not bounded). */
  readonly pipeVelocityMps: number;
  /** Advice that never puts the sizing out of bounds (`pipe_velocity_high`). */
  readonly advisories: readonly SizingAdvisory[];
}

/**
 * Hazen-Williams friction loss in SI units, for water at ordinary temperatures:
 * `hf = 10.67 · L · Q^1.852 / (C^1.852 · d^4.8704)` with `L` and `d` in metres and `Q` in cubic
 * metres per second.
 */
export function hazenWilliamsLossM(
  pipeLengthM: number,
  flowM3s: number,
  hazenWilliamsC: number,
  innerDiameterM: number,
): number {
  return (
    (10.67 * pipeLengthM * flowM3s ** 1.852) / (hazenWilliamsC ** 1.852 * innerDiameterM ** 4.8704)
  );
}

/**
 * Total dynamic head (TDH) a pump must deliver: the static lift from the water at rest to the
 * outlet, the drawdown while pumping, the pipe's friction loss by Hazen-Williams, and the
 * fittings' losses as a fraction of that friction. Every part is returned so the panel can show
 * where the head comes from. Always in bounds: the head itself limits nothing until a pump is
 * chosen (`pumpDutyPoint`). Water faster than the advised velocity is named as advice
 * (`pipe_velocity_high`): a wider pipe would lose less head and wear less, but the sizing stands.
 */
export function totalDynamicHead(input: HeadInput): HeadResult {
  requireFinite('staticLevelM', input.staticLevelM);
  requireFinite('drawdownM', input.drawdownM);
  requireFinite('deliveryHeightM', input.deliveryHeightM);
  requireFinite('pipeLengthM', input.pipeLengthM);
  requireFinite('pipeInnerDiameterMm', input.pipeInnerDiameterMm, { positive: true });
  requireFinite('flowLph', input.flowLph);
  requireFinite('fittingsLossFraction', input.fittingsLossFraction);
  requireFinite('hazenWilliamsC', input.hazenWilliamsC, { positive: true });
  requireFinite('maxPipeVelocityMps', input.maxPipeVelocityMps, { positive: true });

  const flowM3s = lphToCubicMetresPerSecond(input.flowLph);
  const diameterM = input.pipeInnerDiameterMm / 1000;
  const staticHeadM = input.staticLevelM + input.deliveryHeightM;
  const frictionM = hazenWilliamsLossM(input.pipeLengthM, flowM3s, input.hazenWilliamsC, diameterM);
  const fittingsM = frictionM * input.fittingsLossFraction;
  const pipeVelocityMps = flowM3s / (Math.PI * (diameterM / 2) ** 2);

  return {
    staticHeadM,
    drawdownM: input.drawdownM,
    frictionM,
    fittingsM,
    tdhM: staticHeadM + input.drawdownM + frictionM + fittingsM,
    pipeVelocityMps,
    // A millionth of a metre a second of floating-point noise is not fast water.
    advisories: pipeVelocityMps > input.maxPipeVelocityMps + 1e-6 ? ['pipe_velocity_high'] : [],
    ...bounded([]),
  };
}
