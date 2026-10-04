import { describe, expect, it } from 'vitest';
import { pumpDutyPoint, type CurvePoint } from './duty-point';

// A curve that shows the method, not a catalogue pump: shut-off at 90 m, 24,000 litres an hour
// at its last point of 20 m.
const CURVE: readonly CurvePoint[] = [
  { headM: 90, flowLph: 0 },
  { headM: 70, flowLph: 9_000 },
  { headM: 50, flowLph: 16_000 },
  { headM: 35, flowLph: 20_000 },
  { headM: 20, flowLph: 24_000 },
];

// Worked example 1: the pump against 44.39 m (head example 1).
//   44.39 m lies between 35 m (20,000 l/h) and 50 m (16,000 l/h). The share of the way up is
//   (44.39 − 35) / (50 − 35) = 0.626; the flow falls by 4,000 over that span, so
//   20,000 − 0.626 · 4,000 = 17,496 litres an hour.
//
// Worked example 2: the pump against 80 m.
//   Between 70 m (9,000) and 90 m (0): share (80 − 70) / 20 = 0.5, so 9,000 − 0.5 · 9,000 =
//   4,500 litres an hour.

describe('pumpDutyPoint', () => {
  it('worked example 1: 44.39 m gives about 17,496 litres an hour', () => {
    const result = pumpDutyPoint(CURVE, 44.39);
    expect(result.dutyFlowLph).toBeCloseTo(17_496, 6);
    expect(result).toMatchObject({ shutoffHeadM: 90, minHeadM: 20, inBounds: true, reasons: [] });
  });

  it('worked example 2: 80 m gives 4,500 litres an hour', () => {
    expect(pumpDutyPoint(CURVE, 80).dutyFlowLph).toBeCloseTo(4_500, 9);
  });

  it.each([
    [70, 9_000],
    [20, 24_000],
    [35, 20_000],
  ])('a head on a curve point (%s m) gives that point’s flow', (head, flow) => {
    expect(pumpDutyPoint(CURVE, head).dutyFlowLph).toBe(flow);
  });

  it('reads the points in any order', () => {
    expect(pumpDutyPoint([...CURVE].reverse(), 44.39).dutyFlowLph).toBeCloseTo(17_496, 6);
  });

  it('above the shut-off head is out of bounds', () => {
    expect(pumpDutyPoint(CURVE, 90.01)).toMatchObject({
      dutyFlowLph: null,
      shutoffHeadM: 90,
      minHeadM: 20,
      inBounds: false,
      reasons: ['head_above_curve'],
    });
  });

  it('at the shut-off head the pump delivers nothing, so it is out of bounds', () => {
    expect(pumpDutyPoint(CURVE, 90).reasons).toEqual(['head_above_curve']);
  });

  it('above a curve whose top point still flows is out of bounds', () => {
    const open = CURVE.slice(1);
    expect(pumpDutyPoint(open, 70).dutyFlowLph).toBe(9_000);
    expect(pumpDutyPoint(open, 70.5).reasons).toEqual(['head_above_curve']);
  });

  it('below the last point is out of bounds', () => {
    expect(pumpDutyPoint(CURVE, 19.99)).toMatchObject({
      dutyFlowLph: null,
      inBounds: false,
      reasons: ['head_below_curve'],
    });
  });

  it.each([
    ['no points', []],
    ['one point', [{ headM: 40, flowLph: 10_000 }]],
  ])('a curve with %s is too short', (_label, curve) => {
    expect(pumpDutyPoint(curve, 40)).toMatchObject({
      dutyFlowLph: null,
      shutoffHeadM: null,
      minHeadM: null,
      reasons: ['curve_too_short'],
    });
  });

  it('a curve whose flow rises with head is refused', () => {
    const bad = [
      { headM: 20, flowLph: 10_000 },
      { headM: 40, flowLph: 12_000 },
    ];
    expect(pumpDutyPoint(bad, 30).reasons).toEqual(['curve_not_monotonic']);
  });

  it('two points at one head are refused', () => {
    const bad = [
      { headM: 20, flowLph: 10_000 },
      { headM: 20, flowLph: 9_000 },
    ];
    expect(pumpDutyPoint(bad, 20).reasons).toEqual(['curve_not_monotonic']);
  });

  it('a flat stretch of the curve is allowed', () => {
    const flat = [
      { headM: 20, flowLph: 10_000 },
      { headM: 30, flowLph: 10_000 },
      { headM: 40, flowLph: 0 },
    ];
    expect(pumpDutyPoint(flat, 25).dutyFlowLph).toBe(10_000);
  });

  it('refuses a negative head', () => {
    expect(() => pumpDutyPoint(CURVE, -1)).toThrow(RangeError);
  });
});
