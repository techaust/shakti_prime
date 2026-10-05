import { describe, expect, it } from 'vitest';
import { pumpSpecsOf } from './pump-specs';

describe('pumpSpecsOf', () => {
  it('reads the rating and the type of a pump', () => {
    expect(pumpSpecsOf({ hp: 5, kw: 3.7, pumpType: 'submersible', maxHeadM: 90 })).toEqual({
      ratedHp: 5,
      pumpType: 'submersible',
    });
  });

  it.each([
    ['no specifications', {}],
    ['a null', null],
    ['a list', [5]],
    ['a text rating', { hp: '5', pumpType: 'monoblock' }],
    ['a zero rating', { hp: 0 }],
    ['a negative rating', { hp: -1 }],
    ['an endless rating', { hp: Number.POSITIVE_INFINITY }],
    ['a rating that is not a number', { hp: Number.NaN }],
  ])('reads %s as not given', (_label, specs) => {
    expect(pumpSpecsOf(specs)).toEqual({ ratedHp: null, pumpType: null });
  });

  it('reads a surface pump with a fractional rating', () => {
    expect(pumpSpecsOf({ hp: 0.5, pumpType: 'surface' })).toEqual({
      ratedHp: 0.5,
      pumpType: 'surface',
    });
  });
});
