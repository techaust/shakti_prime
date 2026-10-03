import { PumpSizingResultSchema, RooftopSizingResultSchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import type { CurvePoint } from './duty-point';
import { sizePump, sizeRooftop, type ChosenPump } from './size';

const CURVE: readonly CurvePoint[] = [
  { headM: 90, flowLph: 0 },
  { headM: 50, flowLph: 16_000 },
  { headM: 20, flowLph: 24_000 },
];

const PUMP: ChosenPump = { curve: CURVE, ratedHp: null };

const SUBMERSIBLE = {
  pumpType: 'submersible',
  drive: 'solar',
  pipeMaterial: 'hdpe',
  staticLevelM: 30,
  drawdownM: 5,
  deliveryHeightM: 2,
  pipeLengthM: 50,
  pipeInnerDiameterMm: 50,
  flowLph: 18_000,
} as const;

describe('sizePump', () => {
  it('combines the head, power, solar array and duty point with the constants it used', () => {
    const { result, inBounds, reasons } = sizePump(SUBMERSIBLE, PUMP);
    const { sizing } = WORKSHOP_DEFAULTS;
    expect(result.constants).toEqual({
      hazenWilliamsC: sizing.hazenWilliamsC.hdpe,
      fittingsLossFraction: sizing.fittingsLossFraction,
      pumpEfficiency: sizing.efficiency.submersible.pump,
      motorEfficiency: sizing.efficiency.submersible.motor,
      motorMarginFraction: sizing.motorMarginFraction,
      standardHp: sizing.standardHp,
      dutyFlowTolerance: sizing.dutyFlowTolerance,
      dutyFlowOvershootFactor: sizing.dutyFlowOvershootFactor,
      maxPipeVelocityMps: sizing.maxPipeVelocityMps,
      maxSuctionLiftM: null,
      arrayOversize: sizing.solarArrayOversize,
      moduleWp: sizing.moduleWp,
    });
    // 2.55 m/s in the 50 mm pipe is above the advised 2 m/s: advice, kept out of the reasons.
    expect(result.advisories).toEqual(['pipe_velocity_high']);
    expect(result.head.advisories).toEqual(['pipe_velocity_high']);
    // A submersible sits in the water: no suction lift to check.
    expect(result.suction).toBeNull();
    // Head example 1: 44.39 m at the textbook HDPE roughness and 10% fittings.
    expect(result.head.tdhM).toBeCloseTo(44.3948, 4);
    expect(result.power.standardHp).not.toBeNull();
    expect(result.solar?.moduleCount).toBeGreaterThan(0);
    // On the curve at 44.39 m: 16,000 + (50 − 44.39) / 30 · 8,000 = 17,495 litres an hour,
    // within 16,200 to 27,000 for the 18,000 needed.
    expect(result.dutyPoint?.dutyFlowLph).toBeCloseTo(17_494.7, 1);
    expect(result.dutyPoint).toMatchObject({
      requiredFlowLph: 18_000,
      ratedHp: null,
      inBounds: true,
    });
    expect(result.dutyPoint?.minFlowLph).toBeCloseTo(16_200, 6);
    expect(result.dutyPoint?.maxFlowLph).toBeCloseTo(27_000, 6);
    expect({ inBounds, reasons }).toEqual({ inBounds: true, reasons: [] });
    expect(PumpSizingResultSchema.parse(result)).toEqual(result);
  });

  it('a chosen pump short of flow or of power is out of bounds and names why', () => {
    // A small pump: 9,000 litres an hour at 30 m, 5,000 at 60 m, rated 5 HP against the sized 7.5.
    const small: ChosenPump = {
      curve: [
        { headM: 30, flowLph: 9_000 },
        { headM: 60, flowLph: 5_000 },
      ],
      ratedHp: 5,
    };
    const { inBounds, reasons, result } = sizePump(SUBMERSIBLE, small);
    expect(result.power.standardHp).toBe(7.5);
    expect(result.dutyPoint?.reasons).toEqual(['duty_flow_short', 'pump_power_short']);
    expect({ inBounds, reasons }).toEqual({
      inBounds: false,
      reasons: ['duty_flow_short', 'pump_power_short'],
    });
  });

  it('a chosen pump far larger than the need is out of bounds', () => {
    const large: ChosenPump = {
      curve: [
        { headM: 20, flowLph: 60_000 },
        { headM: 80, flowLph: 40_000 },
      ],
      ratedHp: 15,
    };
    expect(sizePump(SUBMERSIBLE, large).reasons).toEqual(['duty_flow_excess']);
  });

  it('a grid pump has no array and no solar constants', () => {
    const { result } = sizePump({ ...SUBMERSIBLE, drive: 'grid' }, null);
    expect(result.solar).toBeNull();
    expect(result.dutyPoint).toBeNull();
    expect(result.constants).toMatchObject({ arrayOversize: null, moduleWp: null });
  });

  it('GI pipe and a surface pump take their own constants', () => {
    const { result } = sizePump({ ...SUBMERSIBLE, pumpType: 'surface', pipeMaterial: 'gi' }, null);
    expect(result.constants.hazenWilliamsC).toBe(WORKSHOP_DEFAULTS.sizing.hazenWilliamsC.gi);
    expect(result.constants.pumpEfficiency).toBe(WORKSHOP_DEFAULTS.sizing.efficiency.surface.pump);
    expect(result.constants.maxSuctionLiftM).toBe(WORKSHOP_DEFAULTS.sizing.surfaceMaxSuctionLiftM);
  });

  it('a surface pump over shallow water draws it up within the limit', () => {
    // 4 m to the water and 1.5 m of drawdown: 5.5 m of suction lift, within 7 m.
    const { result, reasons } = sizePump(
      { ...SUBMERSIBLE, pumpType: 'surface', staticLevelM: 4, drawdownM: 1.5 },
      null,
    );
    expect(result.suction).toEqual({
      suctionLiftM: 5.5,
      maxSuctionLiftM: 7,
      inBounds: true,
      reasons: [],
    });
    expect(reasons).toEqual([]);
  });

  it('a surface pump over deep water is out of bounds and names why', () => {
    // 30 m to the water and 5 m of drawdown: 35 m, far beyond the 7 m a surface pump can draw.
    const { inBounds, reasons, result } = sizePump({ ...SUBMERSIBLE, pumpType: 'surface' }, null);
    expect(result.suction?.suctionLiftM).toBe(35);
    expect({ inBounds, reasons }).toEqual({ inBounds: false, reasons: ['suction_lift_exceeded'] });
    // The same water suits a submersible.
    expect(sizePump(SUBMERSIBLE, null).reasons).toEqual([]);
  });

  it('a head above the chosen pump’s shut-off is out of bounds and names why', () => {
    const { inBounds, reasons, result } = sizePump({ ...SUBMERSIBLE, staticLevelM: 100 }, PUMP);
    expect(result.dutyPoint?.reasons).toEqual(['head_above_curve']);
    expect({ inBounds, reasons }).toEqual({ inBounds: false, reasons: ['head_above_curve'] });
  });

  it('a duty beyond the largest rating has no array to size and is out of bounds', () => {
    const { result, reasons } = sizePump(
      { ...SUBMERSIBLE, flowLph: 400_000, pipeInnerDiameterMm: 250, staticLevelM: 150 },
      null,
    );
    expect(result.power.standardHp).toBeNull();
    expect(result.solar).toBeNull();
    expect(reasons).toEqual(['above_largest_standard_hp']);
  });

  it('names each reason once when several parts fail', () => {
    const { reasons } = sizePump(
      { ...SUBMERSIBLE, flowLph: 400_000, pipeInnerDiameterMm: 250, staticLevelM: 150 },
      PUMP,
    );
    expect(reasons).toEqual(['above_largest_standard_hp', 'head_above_curve']);
  });

  it('takes the constants it is given', () => {
    const defaults = { ...WORKSHOP_DEFAULTS.sizing, fittingsLossFraction: 0 };
    expect(sizePump(SUBMERSIBLE, null, defaults).result.head.fittingsM).toBe(0);
  });
});

describe('sizeRooftop', () => {
  it('sizes at the default constants and keeps them with the result', () => {
    const { result, inBounds } = sizeRooftop({
      monthlyUnitsKwh: 300,
      roofAreaSqm: 40,
      sanctionedLoadKw: 5,
    });
    expect(result.constants).toEqual({
      peakSunHours: WORKSHOP_DEFAULTS.sizing.peakSunHours,
      performanceRatio: WORKSHOP_DEFAULTS.sizing.performanceRatio,
      roofAreaPerKwSqm: WORKSHOP_DEFAULTS.sizing.roofAreaPerKwSqm,
      moduleWp: WORKSHOP_DEFAULTS.sizing.moduleWp,
    });
    expect(result.rooftop.moduleCount).toBeGreaterThan(0);
    expect(inBounds).toBe(true);
    expect(RooftopSizingResultSchema.parse(result)).toEqual(result);
  });

  it('carries the rooftop reasons to the sizing', () => {
    const { inBounds, reasons } = sizeRooftop({
      monthlyUnitsKwh: 0,
      roofAreaSqm: 40,
      sanctionedLoadKw: 5,
    });
    expect({ inBounds, reasons }).toEqual({ inBounds: false, reasons: ['no_consumption'] });
  });
});
