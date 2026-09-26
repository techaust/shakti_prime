import { describe, expect, it } from 'vitest';
import { E164Schema, normaliseIndianPhone, PhoneInputSchema } from './phone';

describe('normaliseIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+14155552671', '+14155552671'],
    ['0141-2345678', '+911412345678'],
  ])('%s becomes %s', (input, expected) => {
    expect(normaliseIndianPhone(input)).toBe(expected);
  });

  it.each([['12345'], ['abcdefghij'], ['0000000000'], ['+0123456789'], ['98765432101']])(
    'rejects %s',
    (input) => {
      expect(normaliseIndianPhone(input)).toBeNull();
    },
  );
});

describe('PhoneInputSchema', () => {
  it('outputs E.164 and fails on junk', () => {
    expect(PhoneInputSchema.parse(' 98765 43210 ')).toBe('+919876543210');
    expect(PhoneInputSchema.safeParse('hello there').success).toBe(false);
    expect(E164Schema.safeParse('+919876543210').success).toBe(true);
  });
});
