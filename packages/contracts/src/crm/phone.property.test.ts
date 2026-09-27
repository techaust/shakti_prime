import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { E164_REGEX, normaliseIndianPhone } from './phone';

// Property tests (AUDIT L31): the same line written any of the ways people write it is stored
// one way, and nothing the normaliser accepts is outside E.164.
const national = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
  )
  .map(([first, rest]) => `${String(first)}${rest.join('')}`);

const spacing = fc.constantFrom('', ' ', '-', ' - ');

describe('normaliseIndianPhone properties', () => {
  it('every written form of one Indian number is stored the same way', () => {
    fc.assert(
      fc.property(national, spacing, (digits, gap) => {
        const split = `${digits.slice(0, 5)}${gap}${digits.slice(5)}`;
        const forms = [
          digits,
          `0${split}`,
          `91${digits}`,
          `+91 ${split}`,
          `+91${gap}0${split}`,
          `0091 ${split}`,
          `(${digits.slice(0, 3)}) ${digits.slice(3)}`,
        ];
        for (const form of forms) expect(normaliseIndianPhone(form)).toBe(`+91${digits}`);
      }),
    );
  });

  it('never answers anything but E.164 or null', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (raw) => {
        const out = normaliseIndianPhone(raw);
        expect(out === null || E164_REGEX.test(out)).toBe(true);
      }),
    );
  });
});
