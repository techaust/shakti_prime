import { describe, expect, it } from 'vitest';
import { KW_PER_HP } from './bounds';
import { solarArrayForPump } from './solar-pump';

// Worked example 1: a 5 HP solar pump.
//   Motor rating = 5 · 0.7457 = 3.7285 kW; at an oversize of 1.3 the array needs
//   3.7285 · 1.3 = 4.847 kWp = 4,847 Wp; in 540 Wp modules that is 4,847 / 540 = 8.976,
//   so 9 modules, 9 · 540 = 4,860 Wp = 4.86 kWp.
//
// Worked example 2: a 3 HP solar pump.
//   3 · 0.7457 · 1.3 = 2.9082 kWp; 2,908.2 / 540 = 5.386, so 6 modules = 3.24 kWp.

describe('solarArrayForPump', () => {
  it('worked example 1: 5 HP takes nine 540 Wp modules', () => {
    const result = solarArrayForPump({ motorKw: 5 * KW_PER_HP, arrayOversize: 1.3, moduleWp: 540 });
    expect(result.requiredKwp).toBeCloseTo(4.84705, 5);
    expect(result.moduleCount).toBe(9);
    expect(result.arrayKwp).toBeCloseTo(4.86, 9);
    expect(result).toMatchObject({ inBounds: true, reasons: [] });
  });

  it('worked example 2: 3 HP takes six 540 Wp modules', () => {
    const result = solarArrayForPump({ motorKw: 3 * KW_PER_HP, arrayOversize: 1.3, moduleWp: 540 });
    expect(result.requiredKwp).toBeCloseTo(2.90823, 5);
    expect(result.moduleCount).toBe(6);
    expect(result.arrayKwp).toBeCloseTo(3.24, 9);
  });

  it('an exact fit takes no extra module despite floating-point noise', () => {
    // 2.2 kWp in 550 Wp modules is 4.000000000000001 in binary floating point.
    const result = solarArrayForPump({ motorKw: 2.2, arrayOversize: 1, moduleWp: 550 });
    expect(result.moduleCount).toBe(4);
    expect(result.arrayKwp).toBeCloseTo(2.2, 9);
  });

  it('a motor of no power needs no modules', () => {
    expect(solarArrayForPump({ motorKw: 0, arrayOversize: 1.3, moduleWp: 540 })).toMatchObject({
      requiredKwp: 0,
      moduleCount: 0,
      arrayKwp: 0,
    });
  });

  it.each([
    ['an oversize of 0', { arrayOversize: 0 }],
    ['a module of 0 Wp', { moduleWp: 0 }],
    ['a negative motor rating', { motorKw: -1 }],
  ])('refuses %s', (_label, over) => {
    expect(() =>
      solarArrayForPump({ motorKw: 3, arrayOversize: 1.3, moduleWp: 540, ...over }),
    ).toThrow(RangeError);
  });
});
