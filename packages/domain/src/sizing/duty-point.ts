import type { SizingReason } from '@shakti/contracts';
import { bounded, requireFinite, type Bounded } from './bounds';

/** One head-flow point of a pump's curve (`pump_curves`), as numbers. */
export interface CurvePoint {
  readonly headM: number;
  readonly flowLph: number;
}

export interface DutyPointResult extends Bounded {
  /** Flow at the head, interpolated along the curve, in litres per hour; null out of bounds. */
  readonly dutyFlowLph: number | null;
  /** The curve's highest head (its shut-off head when the flow there is zero), in metres. */
  readonly shutoffHeadM: number | null;
  /** The curve's lowest head, its last point, in metres. */
  readonly minHeadM: number | null;
}

/**
 * The pump's duty point: the flow it delivers at the sized head, by straight-line interpolation
 * between the two curve points around that head. Out of bounds when the curve has fewer than two
 * points (`curve_too_short`), when its flow rises with head or two points share a head
 * (`curve_not_monotonic`), when the head is at or above the shut-off head so the pump delivers
 * nothing (`head_above_curve`), or when the head is below the curve's last point, where the
 * pump would run off its curve and overload (`head_below_curve`).
 */
export function pumpDutyPoint(curve: readonly CurvePoint[], tdhM: number): DutyPointResult {
  requireFinite('tdhM', tdhM);
  for (const point of curve) {
    requireFinite('headM', point.headM);
    requireFinite('flowLph', point.flowLph);
  }

  const points = [...curve].sort((a, b) => a.headM - b.headM);
  const outOfBounds = (reason: SizingReason, known = true): DutyPointResult => ({
    dutyFlowLph: null,
    shutoffHeadM: known ? (points.at(-1)?.headM ?? null) : null,
    minHeadM: known ? (points[0]?.headM ?? null) : null,
    ...bounded([reason]),
  });

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) return outOfBounds('curve_too_short', false);
  const spans = segments(points);
  if (
    spans.some(([lower, upper]) => upper.headM === lower.headM || upper.flowLph > lower.flowLph)
  ) {
    return outOfBounds('curve_not_monotonic', false);
  }

  if (tdhM > last.headM) return outOfBounds('head_above_curve');
  if (tdhM < first.headM) return outOfBounds('head_below_curve');

  const [lower, upper] = spans.find(([, top]) => tdhM <= top.headM) ?? [first, first];
  const share = upper === lower ? 0 : (tdhM - lower.headM) / (upper.headM - lower.headM);
  const dutyFlowLph = lower.flowLph + share * (upper.flowLph - lower.flowLph);
  if (dutyFlowLph <= 0) return outOfBounds('head_above_curve');

  return { dutyFlowLph, shutoffHeadM: last.headM, minHeadM: first.headM, ...bounded([]) };
}

/** Each pair of neighbouring points, lower head first. */
function segments(points: readonly CurvePoint[]): [CurvePoint, CurvePoint][] {
  const pairs: [CurvePoint, CurvePoint][] = [];
  let previous: CurvePoint | undefined;
  for (const point of points) {
    if (previous) pairs.push([previous, point]);
    previous = point;
  }
  return pairs;
}
