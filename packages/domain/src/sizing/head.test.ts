import { describe, expect, it } from 'vitest';
import { hazenWilliamsLossM, totalDynamicHead, type HeadInput } from './head';

// Worked example 1: a 5 HP-class submersible in HDPE pipe.
//   Water at rest 30 m down, drawdown 5 m, outlet 2 m above ground, 50 m of 50 mm HDPE (C = 140),
//   18,000 litres an hour, fittings 10% of the pipe friction.
//   Q = 18,000 / 3,600,000 = 0.005 m³/s; d = 0.05 m.
//   hf = 10.67 · 50 · 0.005^1.852 / (140^1.852 · 0.05^4.8704)
//      = 533.5 · 5.46e-5 / (9,467 · 4.59e-7) ≈ 6.7226 m
//   fittings = 0.1 · 6.7226 = 0.6723 m; static head = 30 + 2 = 32 m.
//   TDH = 32 + 5 + 6.7226 + 0.6723 ≈ 44.39 m; velocity = 0.005 / (π · 0.025²) ≈ 2.55 m/s.
//
// Worked example 2: a deep borewell in GI pipe.
//   Water at rest 60 m down, drawdown 8 m, outlet 3 m up, 120 m of 65 mm GI (C = 120),
//   36,000 litres an hour (0.01 m³/s), fittings 10%.
//   hf = 10.67 · 120 · 0.01^1.852 / (120^1.852 · 0.065^4.8704) ≈ 21.592 m; fittings ≈ 2.159 m.
//   TDH = 63 + 8 + 21.592 + 2.159 ≈ 94.75 m; velocity = 0.01 / (π · 0.0325²) ≈ 3.01 m/s.

const EXAMPLE_1: HeadInput = {
  staticLevelM: 30,
  drawdownM: 5,
  deliveryHeightM: 2,
  pipeLengthM: 50,
  pipeInnerDiameterMm: 50,
  flowLph: 18_000,
  fittingsLossFraction: 0.1,
  hazenWilliamsC: 140,
};

const EXAMPLE_2: HeadInput = {
  staticLevelM: 60,
  drawdownM: 8,
  deliveryHeightM: 3,
  pipeLengthM: 120,
  pipeInnerDiameterMm: 65,
  flowLph: 36_000,
  fittingsLossFraction: 0.1,
  hazenWilliamsC: 120,
};

describe('totalDynamicHead', () => {
  it('worked example 1: 30 m water, 50 m of 50 mm HDPE at 18,000 litres an hour', () => {
    const result = totalDynamicHead(EXAMPLE_1);
    expect(result.staticHeadM).toBe(32);
    expect(result.drawdownM).toBe(5);
    expect(result.frictionM).toBeCloseTo(6.7226, 4);
    expect(result.fittingsM).toBeCloseTo(0.6723, 4);
    expect(result.tdhM).toBeCloseTo(44.3948, 4);
    expect(result.pipeVelocityMps).toBeCloseTo(2.5465, 4);
    expect(result).toMatchObject({ inBounds: true, reasons: [] });
  });

  it('worked example 2: 60 m water, 120 m of 65 mm GI at 36,000 litres an hour', () => {
    const result = totalDynamicHead(EXAMPLE_2);
    expect(result.staticHeadM).toBe(63);
    expect(result.frictionM).toBeCloseTo(21.5918, 4);
    expect(result.fittingsM).toBeCloseTo(2.1592, 4);
    expect(result.tdhM).toBeCloseTo(94.751, 3);
    expect(result.pipeVelocityMps).toBeCloseTo(3.0136, 4);
  });

  it.each<[string, Partial<HeadInput>, number]>([
    ['no flow has no friction', { flowLph: 0 }, 37],
    ['no pipe has no friction', { pipeLengthM: 0 }, 37],
    [
      'water and outlet at ground level with no flow',
      { staticLevelM: 0, deliveryHeightM: 0, drawdownM: 0, flowLph: 0 },
      0,
    ],
  ])('boundary: %s', (_label, over, tdh) => {
    const result = totalDynamicHead({ ...EXAMPLE_1, ...over });
    expect(result.frictionM).toBe(0);
    expect(result.fittingsM).toBe(0);
    expect(result.tdhM).toBe(tdh);
  });

  it('no fittings loss adds nothing beyond the pipe friction', () => {
    const result = totalDynamicHead({ ...EXAMPLE_1, fittingsLossFraction: 0 });
    expect(result.fittingsM).toBe(0);
    expect(result.tdhM).toBeCloseTo(32 + 5 + result.frictionM, 9);
  });

  it('doubling the flow multiplies the friction by 2^1.852', () => {
    const once = totalDynamicHead(EXAMPLE_1).frictionM;
    const twice = totalDynamicHead({ ...EXAMPLE_1, flowLph: 36_000 }).frictionM;
    expect(twice / once).toBeCloseTo(2 ** 1.852, 9);
  });

  it('a smoother pipe (higher C) loses less head', () => {
    const gi = totalDynamicHead({ ...EXAMPLE_1, hazenWilliamsC: 120 }).frictionM;
    const hdpe = totalDynamicHead({ ...EXAMPLE_1, hazenWilliamsC: 140 }).frictionM;
    expect(hdpe).toBeLessThan(gi);
  });

  it.each([
    ['a negative water level', { staticLevelM: -1 }],
    ['a pipe with no bore', { pipeInnerDiameterMm: 0 }],
    ['a roughness of zero', { hazenWilliamsC: 0 }],
    ['a flow that is not a number', { flowLph: Number.NaN }],
    ['an endless pipe', { pipeLengthM: Number.POSITIVE_INFINITY }],
  ])('refuses %s', (_label, over) => {
    expect(() => totalDynamicHead({ ...EXAMPLE_1, ...over })).toThrow(RangeError);
  });
});

describe('hazenWilliamsLossM', () => {
  it('is linear in the pipe length', () => {
    expect(hazenWilliamsLossM(100, 0.005, 140, 0.05)).toBeCloseTo(
      2 * hazenWilliamsLossM(50, 0.005, 140, 0.05),
      12,
    );
  });
});
