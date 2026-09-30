import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('ignores the order of keys at every depth', () => {
    expect(canonicalJson({ unit: 'kw', min: 3, max: 10 })).toBe(
      canonicalJson({ max: 10, min: 3, unit: 'kw' }),
    );
    expect(canonicalJson(['source', { b: 1, a: { d: 2, c: 3 } }, 5])).toBe(
      canonicalJson(['source', { a: { c: 3, d: 2 }, b: 1 }, 5]),
    );
  });

  it('keeps the order of lists and tells different values apart', () => {
    expect(canonicalJson({ districts: ['Pune', 'Nashik'] })).not.toBe(
      canonicalJson({ districts: ['Nashik', 'Pune'] }),
    );
    expect(canonicalJson({ minDays: 1 })).not.toBe(canonicalJson({ minDays: 2 }));
    expect(canonicalJson(null)).toBe('null');
  });
});
