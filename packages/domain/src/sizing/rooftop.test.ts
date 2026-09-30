import { describe, expect, it } from 'vitest';
import { rooftopSize, type RooftopInput } from './rooftop';

// The sun hours, ratio, area and module here show the method; the values in use are the
// workshop defaults.
//
// Worked example 1: a household using 300 units a month, bound by its need.
//   Daily units = 300 · 12 / 365 = 9.863 kWh. At 5.5 sun hours and a performance ratio of 0.75,
//   one kWp gives 5.5 · 0.75 = 4.125 kWh a day, so the need is 9.863 / 4.125 = 2.391 kWp,
//   2,391 Wp / 540 = 4.43, rounded up to 5 modules.
//   The roof of 40 m² at 10 m² per kWp holds 4 kWp = 7.41, so 7 modules; the sanctioned load of
//   5 kW allows 9.26, so 9 modules. The least is 5 modules = 2.7 kWp, set by the need.
//
// Worked example 2: a household using 900 units a month on a 45 m² roof, bound by the roof.
//   Daily units = 29.589 kWh; need = 29.589 / 4.125 = 7.173 kWp = 13.28, so 14 modules.
//   Roof = 45 / 10 = 4.5 kWp = 8.33, so 8 modules; sanctioned 7 kW = 12.96, so 12 modules.
//   The least is 8 modules = 4.32 kWp, set by the roof.

const EXAMPLE_1: RooftopInput = {
  monthlyUnitsKwh: 300,
  peakSunHours: 5.5,
  performanceRatio: 0.75,
  roofAreaSqm: 40,
  areaPerKwSqm: 10,
  sanctionedLoadKw: 5,
  moduleWp: 540,
};

describe('rooftopSize', () => {
  it('worked example 1: 300 units a month takes five modules, set by the need', () => {
    const result = rooftopSize(EXAMPLE_1);
    expect(result.neededKwp).toBeCloseTo(2.39103, 5);
    expect(result.roofKwp).toBe(4);
    expect(result.sanctionedKwp).toBe(5);
    expect(result.moduleCount).toBe(5);
    expect(result.recommendedKwp).toBeCloseTo(2.7, 9);
    expect(result.boundBy).toBe('need');
    expect(result).toMatchObject({ inBounds: true, reasons: [] });
  });

  it('worked example 2: 900 units a month on 45 m² takes eight modules, set by the roof', () => {
    const result = rooftopSize({
      ...EXAMPLE_1,
      monthlyUnitsKwh: 900,
      roofAreaSqm: 45,
      sanctionedLoadKw: 7,
    });
    expect(result.neededKwp).toBeCloseTo(7.1731, 4);
    expect(result.moduleCount).toBe(8);
    expect(result.recommendedKwp).toBeCloseTo(4.32, 9);
    expect(result.boundBy).toBe('roof');
    expect(result.inBounds).toBe(true);
  });

  it('a sanctioned load below the need and the roof sets the size', () => {
    const result = rooftopSize({
      ...EXAMPLE_1,
      monthlyUnitsKwh: 900,
      roofAreaSqm: 200,
      sanctionedLoadKw: 3,
    });
    // 3 kW / 540 Wp = 5.56, so 5 modules.
    expect(result.moduleCount).toBe(5);
    expect(result.boundBy).toBe('sanctioned_load');
  });

  it('the need wins a tie, since it is met', () => {
    // Need 2.391 kWp → 5 modules; a sanctioned load of 2.7 kW allows exactly 5.
    const result = rooftopSize({ ...EXAMPLE_1, sanctionedLoadKw: 2.7 });
    expect(result.moduleCount).toBe(5);
    expect(result.boundBy).toBe('need');
  });

  it('no consumption is out of bounds', () => {
    const result = rooftopSize({ ...EXAMPLE_1, monthlyUnitsKwh: 0 });
    expect(result.moduleCount).toBe(0);
    expect(result).toMatchObject({ inBounds: false, reasons: ['no_consumption'] });
  });

  it('a roof too small for one module is out of bounds', () => {
    // 5 m² at 10 m² per kWp holds 0.5 kWp, under one 540 Wp module.
    const result = rooftopSize({ ...EXAMPLE_1, roofAreaSqm: 5 });
    expect(result).toMatchObject({ moduleCount: 0, boundBy: 'roof', inBounds: false });
    expect(result.reasons).toEqual(['roof_too_small']);
  });

  it('a roof that holds exactly one module is in bounds', () => {
    const result = rooftopSize({ ...EXAMPLE_1, roofAreaSqm: 5.4 });
    expect(result).toMatchObject({ moduleCount: 1, boundBy: 'roof', inBounds: true });
  });

  it('a sanctioned load too small for one module is out of bounds', () => {
    const result = rooftopSize({ ...EXAMPLE_1, sanctionedLoadKw: 0.5 });
    expect(result.reasons).toEqual(['sanctioned_load_too_small']);
  });

  it.each([
    ['no sun', { peakSunHours: 0 }],
    ['a performance ratio above 1', { performanceRatio: 1.2 }],
    ['no area per kWp', { areaPerKwSqm: 0 }],
    ['a negative roof', { roofAreaSqm: -1 }],
  ])('refuses %s', (_label, over) => {
    expect(() => rooftopSize({ ...EXAMPLE_1, ...over })).toThrow(RangeError);
  });
});
