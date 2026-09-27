import { describe, expect, it } from 'vitest';
import { verhoeffCheckDigit, verhoeffValid } from './verhoeff';

// Made-up numbers only: every twelve-digit value below is generated in the test, never copied
// from a real card.
function randomDigits(length: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(Math.floor(random() * 10));
  return out;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Verhoeff', () => {
  it('matches the published worked example', () => {
    expect(verhoeffCheckDigit('236')).toBe('3');
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
  });

  it('accepts every number built with its own check digit', () => {
    const random = seeded(7);
    for (let i = 0; i < 500; i++) {
      const body = randomDigits(11, random);
      expect(verhoeffValid(body + verhoeffCheckDigit(body))).toBe(true);
    }
  });

  it('catches every single-digit change', () => {
    const random = seeded(11);
    for (let i = 0; i < 100; i++) {
      const body = randomDigits(11, random);
      const valid = body + verhoeffCheckDigit(body);
      for (let pos = 0; pos < valid.length; pos++) {
        for (let d = 0; d <= 9; d++) {
          if (String(d) === valid.charAt(pos)) continue;
          const changed = valid.slice(0, pos) + String(d) + valid.slice(pos + 1);
          expect(verhoeffValid(changed)).toBe(false);
        }
      }
    }
  });

  it('catches every swap of two different neighbouring digits', () => {
    const random = seeded(13);
    for (let i = 0; i < 100; i++) {
      const body = randomDigits(11, random);
      const valid = body + verhoeffCheckDigit(body);
      for (let pos = 0; pos < valid.length - 1; pos++) {
        const a = valid.charAt(pos);
        const b = valid.charAt(pos + 1);
        if (a === b) continue;
        const swapped = valid.slice(0, pos) + b + a + valid.slice(pos + 2);
        expect(verhoeffValid(swapped)).toBe(false);
      }
    }
  });

  it('refuses anything that is not digits', () => {
    expect(verhoeffValid('')).toBe(false);
    expect(verhoeffValid('2363 ')).toBe(false);
    expect(verhoeffValid('23a3')).toBe(false);
    expect(() => verhoeffCheckDigit('12-3')).toThrow(RangeError);
  });
});
