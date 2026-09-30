import { PumpSizingResultSchema, RooftopSizingResultSchema } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import type { CurvePoint } from './duty-point';
import { sizePump, sizeRooftop } from './size';

const CURVE: readonly CurvePoint[] = [
  { headM: 90, flowLph: 0 },
  { headM: 50, flowLph: 16_000 },
  { headM: 20, flowLph: 24_000 },
];

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
    const { result, inBounds, reasons } = sizePump(SUBMERSIBLE, CURVE);
    const { sizing } = WORKSHOP_DEFAULTS;
    expect(result.constants).toEqual({
      hazenWilliamsC: sizing.hazenWilliamsC.hdpe,
      fittingsLossFraction: sizing.fittingsLossFraction,
      pumpEfficiency: sizing.efficiency.submersible.pump,
      motorEfficiency: sizing.efficiency.submersible.motor,
      standardHp: sizing.standardHp,
      arrayOversize: sizing.solarArrayOversize,
      moduleWp: sizing.moduleWp,
    });
    // Head example 1: 44.39 m at the textbook HDPE roughness and 10% fittings.
    expect(result.head.tdhM).toBeCloseTo(44.3948, 4);
    expect(result.power.standardHp).not.toBeNull();
    expect(result.solar?.moduleCount).toBeGreaterThan(0);
    expect(result.dutyPoint?.dutyFlowLph).toBeGreaterThan(0);
    expect({ inBounds, reasons }).toEqual({ inBounds: true, reasons: [] });
    expect(PumpSizingResultSchema.parse(result)).toEqual(result);
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
  });

  it('a head above the chosen pump’s shut-off is out of bounds and names why', () => {
    const { inBounds, reasons, result } = sizePump({ ...SUBMERSIBLE, staticLevelM: 100 }, CURVE);
    expect(result.dutyPoint?.reasons).toEqual(['head_above_shutoff']);
    expect({ inBounds, reasons }).toEqual({ inBounds: false, reasons: ['head_above_shutoff'] });
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
      CURVE,
    );
    expect(reasons).toEqual(['above_largest_standard_hp', 'head_above_shutoff']);
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
