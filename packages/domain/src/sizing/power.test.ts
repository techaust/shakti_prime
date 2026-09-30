import { describe, expect, it } from 'vitest';
import { nextStandardHp, pumpPower, type PowerInput } from './power';

// The ratings list here shows the method; the list in use is the workshop default.
const RATINGS = [0.5, 1, 1.5, 2, 3, 5, 7.5, 10, 12.5, 15, 20, 25, 30];

// Worked example 1: the submersible from the head example 1.
//   18,000 litres an hour (0.005 m³/s) against 40 m.
//   Hydraulic power = ρ · g · Q · H = 1000 · 9.80665 · 0.005 · 40 = 1,961.33 W = 1.9613 kW.
//   Shaft power at a pump efficiency of 0.55 = 1.9613 / 0.55 = 3.5661 kW = 3.5661 / 0.7457 = 4.782 HP.
//   Motor input at a motor efficiency of 0.78 = 3.5661 / 0.78 = 4.5719 kW.
//   The smallest standard rating at or above 4.782 HP is 5 HP (3.7285 kW).
//
// Worked example 2: a surface pump lifting 36,000 litres an hour (0.01 m³/s) against 75 m.
//   Hydraulic = 1000 · 9.80665 · 0.01 · 75 = 7,354.99 W = 7.355 kW.
//   Shaft at 0.60 = 12.2583 kW = 16.439 HP; motor input at 0.82 = 14.9492 kW.
//   16.439 HP is above 15 HP, so the rating is 20 HP.

const EXAMPLE_1: PowerInput = {
  flowLph: 18_000,
  tdhM: 40,
  pumpEfficiency: 0.55,
  motorEfficiency: 0.78,
  standardHp: RATINGS,
};

describe('pumpPower', () => {
  it('worked example 1: 18,000 litres an hour against 40 m takes 5 HP', () => {
    const result = pumpPower(EXAMPLE_1);
    expect(result.hydraulicKw).toBeCloseTo(1.96133, 5);
    expect(result.shaftKw).toBeCloseTo(3.56605, 5);
    expect(result.shaftHp).toBeCloseTo(4.78216, 5);
    expect(result.motorInputKw).toBeCloseTo(4.57186, 5);
    expect(result.standardHp).toBe(5);
    expect(result.standardKw).toBeCloseTo(3.7285, 4);
    expect(result).toMatchObject({ inBounds: true, reasons: [] });
  });

  it('worked example 2: 36,000 litres an hour against 75 m takes 20 HP', () => {
    const result = pumpPower({
      flowLph: 36_000,
      tdhM: 75,
      pumpEfficiency: 0.6,
      motorEfficiency: 0.82,
      standardHp: RATINGS,
    });
    expect(result.hydraulicKw).toBeCloseTo(7.35499, 5);
    expect(result.shaftHp).toBeCloseTo(16.43867, 5);
    expect(result.motorInputKw).toBeCloseTo(14.94916, 5);
    expect(result.standardHp).toBe(20);
  });

  it('above the largest rating is out of bounds and names why', () => {
    const result = pumpPower({ ...EXAMPLE_1, flowLph: 360_000, tdhM: 100 });
    expect(result.standardHp).toBeNull();
    expect(result.standardKw).toBeNull();
    expect(result).toMatchObject({ inBounds: false, reasons: ['above_largest_standard_hp'] });
  });

  it('no flow needs no power and takes the smallest rating', () => {
    const result = pumpPower({ ...EXAMPLE_1, flowLph: 0 });
    expect(result.hydraulicKw).toBe(0);
    expect(result.standardHp).toBe(0.5);
  });

  it('perfect efficiencies make the shaft and motor power equal the hydraulic power', () => {
    const result = pumpPower({ ...EXAMPLE_1, pumpEfficiency: 1, motorEfficiency: 1 });
    expect(result.shaftKw).toBe(result.hydraulicKw);
    expect(result.motorInputKw).toBe(result.hydraulicKw);
  });

  it.each([
    ['a pump efficiency of 0', { pumpEfficiency: 0 }],
    ['a motor efficiency above 1', { motorEfficiency: 1.1 }],
    ['a negative head', { tdhM: -5 }],
    ['no ratings', { standardHp: [] }],
  ])('refuses %s', (_label, over) => {
    expect(() => pumpPower({ ...EXAMPLE_1, ...over })).toThrow(RangeError);
  });
});

describe('nextStandardHp', () => {
  it.each([
    [0, 0.5],
    [0.5, 0.5],
    [0.5000001, 0.5],
    [0.51, 1],
    [4.99, 5],
    [5, 5],
    [5.01, 7.5],
    [30, 30],
    [30.01, null],
  ])('%s HP takes %s', (hp, rating) => {
    expect(nextStandardHp(hp, RATINGS)).toBe(rating);
  });

  it('reads an unsorted list in order', () => {
    expect(nextStandardHp(2.5, [10, 3, 1, 5])).toBe(3);
  });
});
