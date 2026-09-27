import { describe, expect, it } from 'vitest';
import { divideHalfUp, fromPaise, moneyFromPaise, toPaise, toScaled } from './paise';

describe('paise', () => {
  it.each([
    ['0.00', 0n],
    ['0.01', 1n],
    ['1234.50', 123450n],
    ['999999999999.99', 99999999999999n],
    ['-0.49', -49n],
  ])('reads %s as %s paise', (money, paise) => {
    expect(toPaise(money)).toBe(paise);
    expect(fromPaise(paise)).toBe(money);
  });

  it('refuses anything but a two-decimal string', () => {
    for (const bad of ['1', '1.5', '1.505', 'abc', '']) {
      expect(() => toPaise(bad)).toThrow(expect.objectContaining({ code: 'internal' }));
    }
  });

  it('refuses a negative amount where only money is allowed', () => {
    expect(() => moneyFromPaise(-1n)).toThrow(expect.objectContaining({ code: 'internal' }));
  });

  it.each([
    ['2', 3, 2000n],
    ['2.5', 3, 2500n],
    ['0.333', 3, 333n],
    ['18.00', 2, 1800n],
    ['0.25', 2, 25n],
  ])('scales %s to %i decimals', (value, scale, expected) => {
    expect(toScaled(value, scale)).toBe(expected);
  });

  it('refuses more decimals than the scale', () => {
    expect(() => toScaled('1.2345', 3)).toThrow(expect.objectContaining({ code: 'internal' }));
  });

  it.each([
    [5n, 10n, 1n], // 0.5 rounds up
    [4n, 10n, 0n], // 0.4 rounds down
    [15n, 10n, 2n], // 1.5 rounds up
    [149n, 100n, 1n],
    [150n, 100n, 2n],
    [0n, 7n, 0n],
  ])('divides %s by %s half-up to %s', (n, d, q) => {
    expect(divideHalfUp(n, d)).toBe(q);
  });
});
