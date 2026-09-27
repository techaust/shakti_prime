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
    ['+91 (0)141 2345678', '+911412345678'],
    ['0091 98765 43210', '+919876543210'],
    ['+91 098765 43210', '+919876543210'],
    ['98765.43210', '+919876543210'],
    ['9123456789', '+919123456789'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s becomes %s', (input, expected) => {
    expect(normaliseIndianPhone(input)).toBe(expected);
  });

  it.each([
    ['12345'],
    ['abcdefghij'],
    ['0000000000'],
    ['+0123456789'],
    ['98765432101'],
    // AUDIT M23: +91 numbers follow the Indian rules too
    ['+91 98765 4321'],
    ['+9198765432101'],
    ['+91 0000000000'],
    ['+91 98765 4321x'],
  ])('rejects %s', (input) => {
    expect(normaliseIndianPhone(input)).toBeNull();
  });
});

describe('PhoneInputSchema', () => {
  it('outputs E.164 and fails on junk', () => {
    expect(PhoneInputSchema.parse(' 98765 43210 ')).toBe('+919876543210');
    expect(PhoneInputSchema.safeParse('hello there').success).toBe(false);
    expect(E164Schema.safeParse('+919876543210').success).toBe(true);
  });
});
