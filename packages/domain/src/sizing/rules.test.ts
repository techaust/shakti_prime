import { describe, expect, it } from 'vitest';
import { dcrRule, sanctionedLoadRule } from './rules';

// Worked example 1 (DCR): a PM Surya Ghar rooftop with five DCR modules passes; the same system
//   with one line of two imported (non-DCR) modules fails with `dcr_modules_required`, because
//   the scheme's subsidy requires every module to be DCR.
//
// Worked example 2 (sanctioned load): a 2.7 kWp system on a 3 kW connection passes (2.7 ≤ 3);
//   a 3.24 kWp system on the same connection fails with `sanctioned_load_exceeded` (3.24 > 3).

describe('dcrRule', () => {
  it('worked example 1: every module DCR under PM Surya Ghar passes', () => {
    expect(dcrRule({ scheme: 'pm_surya_ghar', modules: [{ isDcr: true, quantity: 5 }] })).toEqual({
      required: true,
      inBounds: true,
      reasons: [],
    });
  });

  it('worked example 1: one line of non-DCR modules fails', () => {
    expect(
      dcrRule({
        scheme: 'pm_surya_ghar',
        modules: [
          { isDcr: true, quantity: 3 },
          { isDcr: false, quantity: 2 },
        ],
      }),
    ).toEqual({ required: true, inBounds: false, reasons: ['dcr_modules_required'] });
  });

  it('PM-KUSUM requires DCR too', () => {
    expect(
      dcrRule({ scheme: 'pm_kusum', modules: [{ isDcr: false, quantity: 9 }] }).reasons,
    ).toEqual(['dcr_modules_required']);
  });

  it('a sale under no scheme passes whatever the modules', () => {
    expect(dcrRule({ scheme: 'none', modules: [{ isDcr: false, quantity: 9 }] })).toEqual({
      required: false,
      inBounds: true,
      reasons: [],
    });
    expect(dcrRule({ scheme: 'none', modules: [] }).inBounds).toBe(true);
  });

  it('a scheme that requires DCR fails with no modules', () => {
    expect(dcrRule({ scheme: 'pm_kusum', modules: [] }).reasons).toEqual(['no_modules']);
  });

  it('a line of no modules counts as none', () => {
    expect(
      dcrRule({
        scheme: 'pm_surya_ghar',
        modules: [
          { isDcr: false, quantity: 0 },
          { isDcr: true, quantity: 4 },
        ],
      }).inBounds,
    ).toBe(true);
  });

  it('follows the scheme list it is given', () => {
    expect(
      dcrRule({ scheme: 'pm_kusum', modules: [{ isDcr: false, quantity: 1 }], dcrSchemes: [] })
        .inBounds,
    ).toBe(true);
  });

  it('refuses a negative quantity', () => {
    expect(() => dcrRule({ scheme: 'none', modules: [{ isDcr: true, quantity: -1 }] })).toThrow(
      RangeError,
    );
  });
});

describe('sanctionedLoadRule', () => {
  it.each([
    ['worked example 2: 2.7 kWp on 3 kW passes', 2.7, 3, []],
    ['exactly the sanctioned load passes', 3, 3, []],
    ['floating-point noise above the load passes', 0.1 + 0.2, 0.3, []],
    ['worked example 2: 3.24 kWp on 3 kW fails', 3.24, 3, ['sanctioned_load_exceeded']],
    ['a system on a connection of no load fails', 1, 0, ['sanctioned_load_exceeded']],
  ])('%s', (_label, systemKw, sanctionedLoadKw, reasons) => {
    const result = sanctionedLoadRule({ systemKw, sanctionedLoadKw });
    expect(result.reasons).toEqual(reasons);
    expect(result.inBounds).toBe(reasons.length === 0);
  });

  it('compares the DC size against the load times the ratio', () => {
    // At a ratio of 1.2, a 3 kW connection allows 3.6 kWp: 3.24 kWp passes, 3.78 kWp does not.
    expect(sanctionedLoadRule({ systemKw: 3.24, sanctionedLoadKw: 3, ratio: 1.2 }).reasons).toEqual(
      [],
    );
    expect(sanctionedLoadRule({ systemKw: 3.78, sanctionedLoadKw: 3, ratio: 1.2 }).reasons).toEqual(
      ['sanctioned_load_exceeded'],
    );
    // Left out, the ratio is the workshop default of 1.0.
    expect(sanctionedLoadRule({ systemKw: 3, sanctionedLoadKw: 3 }).inBounds).toBe(true);
    expect(sanctionedLoadRule({ systemKw: 3, sanctionedLoadKw: 3, ratio: 0.9 }).inBounds).toBe(
      false,
    );
  });

  it('refuses a load that is not a number, or a ratio of 0', () => {
    expect(() => sanctionedLoadRule({ systemKw: 1, sanctionedLoadKw: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => sanctionedLoadRule({ systemKw: 1, sanctionedLoadKw: 3, ratio: 0 })).toThrow(
      RangeError,
    );
  });
});
