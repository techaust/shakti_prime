import { describe, expect, it } from 'vitest';
import { pumpMatch, type PumpMatchInput } from './match';

// Worked example 1: a pump that suits the site.
//   The site needs 18,000 litres an hour; the sizing chose 7.5 HP.
//   With a 10% tolerance the pump must deliver at least 18,000 · (1 − 0.1) = 16,200 litres an
//   hour, and with an overshoot factor of 1.5 at most 18,000 · 1.5 = 27,000.
//   On its curve at the sized head the chosen pump delivers 17,683 litres an hour: between the
//   two, so the flow suits. Its specifications rate it 7.5 HP, the sized rating, so its motor
//   suits too. In bounds.
//
// Worked example 2: a pump too small on both counts.
//   The same site; the chosen pump delivers 9,122 litres an hour at the sized head, under 16,200
//   (duty_flow_short), and is rated 5 HP, under the sized 7.5 HP (pump_power_short).

const EXAMPLE_1: PumpMatchInput = {
  dutyFlowLph: 17_683,
  requiredFlowLph: 18_000,
  ratedHp: 7.5,
  sizedHp: 7.5,
  dutyFlowTolerance: 0.1,
  dutyFlowOvershootFactor: 1.5,
};

describe('pumpMatch', () => {
  it('worked example 1: a pump within the flow band at the sized rating suits', () => {
    const result = pumpMatch(EXAMPLE_1);
    expect(result.minFlowLph).toBeCloseTo(16_200, 6);
    expect(result.maxFlowLph).toBeCloseTo(27_000, 6);
    expect(result).toMatchObject({
      requiredFlowLph: 18_000,
      ratedHp: 7.5,
      inBounds: true,
      reasons: [],
    });
  });

  it('worked example 2: a pump short of flow and of power names both', () => {
    const result = pumpMatch({ ...EXAMPLE_1, dutyFlowLph: 9_122, ratedHp: 5 });
    expect(result).toMatchObject({
      inBounds: false,
      reasons: ['duty_flow_short', 'pump_power_short'],
    });
  });

  it.each([
    ['exactly the least flow', 16_200, []],
    ['just under the least flow', 16_199, ['duty_flow_short']],
    ['exactly the most flow', 27_000, []],
    ['just over the most flow', 27_001, ['duty_flow_excess']],
    ['the needed flow', 18_000, []],
  ])('%s', (_label, dutyFlowLph, reasons) => {
    expect(pumpMatch({ ...EXAMPLE_1, dutyFlowLph }).reasons).toEqual(reasons);
  });

  it('a pump rated above the sized rating suits; one below does not', () => {
    expect(pumpMatch({ ...EXAMPLE_1, ratedHp: 10 }).reasons).toEqual([]);
    expect(pumpMatch({ ...EXAMPLE_1, ratedHp: 7.4 }).reasons).toEqual(['pump_power_short']);
  });

  it('skips the power check when the rating or the sized rating is not known', () => {
    expect(pumpMatch({ ...EXAMPLE_1, ratedHp: null }).reasons).toEqual([]);
    expect(pumpMatch({ ...EXAMPLE_1, ratedHp: 1, sizedHp: null }).reasons).toEqual([]);
  });

  it('judges no flow off the curve, only the power', () => {
    expect(pumpMatch({ ...EXAMPLE_1, dutyFlowLph: null }).reasons).toEqual([]);
    expect(pumpMatch({ ...EXAMPLE_1, dutyFlowLph: null, ratedHp: 3 }).reasons).toEqual([
      'pump_power_short',
    ]);
  });

  it('with no tolerance any shortfall counts', () => {
    const exact = { ...EXAMPLE_1, dutyFlowTolerance: 0 };
    expect(pumpMatch({ ...exact, dutyFlowLph: 18_000 }).reasons).toEqual([]);
    expect(pumpMatch({ ...exact, dutyFlowLph: 17_999 }).reasons).toEqual(['duty_flow_short']);
  });

  it.each([
    ['a tolerance of 1', { dutyFlowTolerance: 1 }],
    ['a negative tolerance', { dutyFlowTolerance: -0.1 }],
    ['an overshoot factor under 1', { dutyFlowOvershootFactor: 0.9 }],
    ['a negative duty flow', { dutyFlowLph: -1 }],
  ])('refuses %s', (_label, over) => {
    expect(() => pumpMatch({ ...EXAMPLE_1, ...over })).toThrow(RangeError);
  });
});
