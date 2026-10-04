import { describe, expect, it } from 'vitest';
import { suctionLift } from './suction';

// Worked example 1: an open well for a surface pump.
//   The water rests 4 m below ground and falls 1.5 m while pumping, so the pump draws it up
//   4 + 1.5 = 5.5 m. At most 7 m is allowed: in bounds.
//
// Worked example 2: a borewell offered a surface pump.
//   The water rests 12 m down and falls 3 m: 12 + 3 = 15 m, more than twice the 7 m a surface
//   pump can draw (suction_lift_exceeded). The site needs a submersible.

describe('suctionLift', () => {
  it('worked example 1: 5.5 m of lift is within 7 m', () => {
    expect(suctionLift({ staticLevelM: 4, drawdownM: 1.5, maxSuctionLiftM: 7 })).toEqual({
      suctionLiftM: 5.5,
      maxSuctionLiftM: 7,
      inBounds: true,
      reasons: [],
    });
  });

  it('worked example 2: 15 m of lift is beyond a surface pump', () => {
    expect(suctionLift({ staticLevelM: 12, drawdownM: 3, maxSuctionLiftM: 7 })).toMatchObject({
      suctionLiftM: 15,
      inBounds: false,
      reasons: ['suction_lift_exceeded'],
    });
  });

  it.each([
    ['exactly the limit', 5, 2, true],
    ['just over the limit', 5, 2.01, false],
    ['water at ground level', 0, 0, true],
  ])('%s', (_label, staticLevelM, drawdownM, inBounds) => {
    expect(suctionLift({ staticLevelM, drawdownM, maxSuctionLiftM: 7 }).inBounds).toBe(inBounds);
  });

  it.each([
    ['a negative level', { staticLevelM: -1 }],
    ['a limit of 0', { maxSuctionLiftM: 0 }],
  ])('refuses %s', (_label, over) => {
    expect(() =>
      suctionLift({ staticLevelM: 4, drawdownM: 1, maxSuctionLiftM: 7, ...over }),
    ).toThrow(RangeError);
  });
});
