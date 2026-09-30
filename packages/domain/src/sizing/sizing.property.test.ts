import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { pumpDutyPoint, type CurvePoint } from './duty-point';
import { totalDynamicHead, type HeadInput } from './head';
import { nextStandardHp, pumpPower } from './power';
import { rooftopSize } from './rooftop';
import { dcrRule, sanctionedLoadRule } from './rules';
import { solarArrayForPump } from './solar-pump';

// Property tests: invariants that hold for every input, checked on many generated cases. A seeded
// generator (mulberry32) keeps each run the same, so a failure names a case that repeats.
const RUNS = 500;

function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    between: (min: number, max: number): number => min + next() * (max - min),
    int: (min: number, max: number): number => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T,
    chance: (): boolean => next() < 0.5,
  };
}

function forAll(seed: number, check: (random: ReturnType<typeof generator>) => void): void {
  const random = generator(seed);
  for (let run = 0; run < RUNS; run += 1) check(random);
}

const TOLERANCE = 1e-9;

function firstOf<T>(values: readonly T[]): T {
  const [value] = values;
  if (value === undefined) throw new Error('empty list');
  return value;
}

function lastOf<T>(values: readonly T[]): T {
  const value = values.at(-1);
  if (value === undefined) throw new Error('empty list');
  return value;
}
const { sizing } = WORKSHOP_DEFAULTS;

function headInput(random: ReturnType<typeof generator>): HeadInput {
  return {
    staticLevelM: random.between(0, 300),
    drawdownM: random.between(0, 50),
    deliveryHeightM: random.between(0, 20),
    pipeLengthM: random.between(0, 1000),
    pipeInnerDiameterMm: random.between(20, 200),
    flowLph: random.between(0, 200_000),
    fittingsLossFraction: random.between(0, 0.5),
    hazenWilliamsC: random.pick([sizing.hazenWilliamsC.hdpe, sizing.hazenWilliamsC.gi]),
  };
}

describe('totalDynamicHead properties', () => {
  it('the head is the sum of its parts and never less than the lift', () => {
    forAll(1, (random) => {
      const input = headInput(random);
      const result = totalDynamicHead(input);
      const sum = result.staticHeadM + result.drawdownM + result.frictionM + result.fittingsM;
      expect(Math.abs(result.tdhM - sum)).toBeLessThan(TOLERANCE * Math.max(1, sum));
      expect(result.tdhM).toBeGreaterThanOrEqual(
        input.staticLevelM + input.deliveryHeightM + input.drawdownM - TOLERANCE,
      );
      expect(result.inBounds).toBe(true);
    });
  });

  it('more flow, a longer pipe or a narrower bore never lowers the head', () => {
    forAll(2, (random) => {
      const input = headInput(random);
      const base = totalDynamicHead(input).tdhM;
      const factor = random.between(1, 3);
      expect(
        totalDynamicHead({ ...input, flowLph: input.flowLph * factor }).tdhM,
      ).toBeGreaterThanOrEqual(base);
      expect(
        totalDynamicHead({ ...input, pipeLengthM: input.pipeLengthM * factor }).tdhM,
      ).toBeGreaterThanOrEqual(base);
      expect(
        totalDynamicHead({ ...input, pipeInnerDiameterMm: input.pipeInnerDiameterMm / factor })
          .tdhM,
      ).toBeGreaterThanOrEqual(base);
    });
  });
});

describe('pumpPower properties', () => {
  it('the rating is the smallest standard one that covers the shaft power with its margin', () => {
    forAll(3, (random) => {
      const type = random.pick(['submersible', 'surface'] as const);
      const motorMarginFraction = random.pick([0, sizing.motorMarginFraction, 0.25]);
      const result = pumpPower({
        flowLph: random.between(0, 150_000),
        tdhM: random.between(0, 250),
        pumpEfficiency: sizing.efficiency[type].pump,
        motorEfficiency: sizing.efficiency[type].motor,
        motorMarginFraction,
        standardHp: sizing.standardHp,
      });
      expect(result.motorInputKw).toBeGreaterThanOrEqual(result.shaftKw);
      expect(result.shaftKw).toBeGreaterThanOrEqual(result.hydraulicKw);
      expect(result.requiredHp).toBeGreaterThanOrEqual(result.shaftHp);
      const rating = result.standardHp;
      if (rating === null) {
        expect(result.requiredHp).toBeGreaterThan(sizing.standardHp.at(-1) ?? 0);
        expect(result.reasons).toEqual(['above_largest_standard_hp']);
      } else {
        expect(rating).toBeGreaterThanOrEqual(result.requiredHp - 1e-6);
        const smaller = sizing.standardHp.filter((hp) => hp < rating);
        for (const hp of smaller) expect(hp).toBeLessThan(result.requiredHp);
        expect(result.inBounds).toBe(true);
      }
    });
  });

  it('a larger shaft power never takes a smaller rating', () => {
    forAll(4, (random) => {
      const low = random.between(0, 40);
      const high = low + random.between(0, 10);
      const a = nextStandardHp(low, sizing.standardHp);
      const b = nextStandardHp(high, sizing.standardHp);
      if (a !== null && b !== null) expect(b).toBeGreaterThanOrEqual(a);
      if (a === null) expect(b).toBeNull();
    });
  });
});

describe('solarArrayForPump properties', () => {
  it('the array covers the need with less than one module to spare', () => {
    forAll(5, (random) => {
      const moduleWp = random.pick([330, 440, 540, 550, 600]);
      const result = solarArrayForPump({
        motorKw: random.between(0, 25),
        arrayOversize: random.between(1, 1.6),
        moduleWp,
      });
      expect(result.arrayKwp).toBeGreaterThanOrEqual(result.requiredKwp - 1e-6);
      expect(result.arrayKwp - moduleWp / 1000).toBeLessThan(result.requiredKwp + 1e-6);
      expect(Number.isInteger(result.moduleCount)).toBe(true);
    });
  });
});

describe('rooftopSize properties', () => {
  it('never exceeds the roof or the sanctioned load, and meets the need when the need binds', () => {
    forAll(6, (random) => {
      const result = rooftopSize({
        monthlyUnitsKwh: random.chance() ? random.between(0, 3000) : random.int(0, 3000),
        peakSunHours: sizing.peakSunHours,
        performanceRatio: sizing.performanceRatio,
        roofAreaSqm: random.between(0, 300),
        areaPerKwSqm: sizing.roofAreaPerKwSqm,
        sanctionedLoadKw: random.between(0, 20),
        moduleWp: sizing.moduleWp,
      });
      expect(result.recommendedKwp).toBeLessThanOrEqual(result.roofKwp + 1e-6);
      expect(
        sanctionedLoadRule({
          systemKw: result.recommendedKwp,
          sanctionedLoadKw: result.sanctionedKwp,
        }).inBounds,
      ).toBe(true);
      if (result.boundBy === 'need') {
        expect(result.recommendedKwp).toBeGreaterThanOrEqual(result.neededKwp - 1e-6);
      }
      expect(result.inBounds).toBe(result.moduleCount > 0);
      expect(result.inBounds).toBe(result.reasons.length === 0);
    });
  });
});

function curve(random: ReturnType<typeof generator>): CurvePoint[] {
  const points: CurvePoint[] = [];
  let head = random.between(5, 30);
  let flow = random.between(10_000, 80_000);
  const count = random.int(2, 8);
  for (let i = 0; i < count; i += 1) {
    points.push({ headM: head, flowLph: flow });
    head += random.between(1, 30);
    flow = Math.max(0, flow - random.between(0, 15_000));
  }
  return points;
}

describe('pumpDutyPoint properties', () => {
  it('inside the curve the flow lies between the neighbouring points and falls as head rises', () => {
    forAll(7, (random) => {
      const points = curve(random);
      const low = firstOf(points).headM;
      const high = lastOf(points).headM;
      const a = random.between(low, high);
      const b = random.between(a, high);
      const atA = pumpDutyPoint(points, a);
      const atB = pumpDutyPoint(points, b);
      for (const result of [atA, atB]) {
        expect(result.inBounds).toBe(result.dutyFlowLph !== null);
        expect(result.reasons.length === 0).toBe(result.inBounds);
      }
      if (atA.dutyFlowLph !== null && atB.dutyFlowLph !== null) {
        expect(atB.dutyFlowLph).toBeLessThanOrEqual(atA.dutyFlowLph + 1e-6);
        expect(atA.dutyFlowLph).toBeLessThanOrEqual(firstOf(points).flowLph + 1e-6);
        expect(atB.dutyFlowLph).toBeGreaterThanOrEqual(lastOf(points).flowLph - 1e-6);
      }
    });
  });

  it('outside the curve it is always out of bounds', () => {
    forAll(8, (random) => {
      const points = curve(random);
      const above = pumpDutyPoint(points, lastOf(points).headM + random.between(0.001, 50));
      const below = pumpDutyPoint(
        points,
        Math.max(0, firstOf(points).headM - random.between(0.001, 5)),
      );
      expect(above.reasons).toEqual(['head_above_curve']);
      if (firstOf(points).headM > 0.001) expect(below.inBounds).toBe(false);
    });
  });
});

describe('dcrRule properties', () => {
  it('passes exactly when the scheme needs no DCR, or there are modules and all are DCR', () => {
    forAll(9, (random) => {
      const scheme = random.pick(['none', 'pm_surya_ghar', 'pm_kusum'] as const);
      const modules = Array.from({ length: random.int(0, 4) }, () => ({
        isDcr: random.chance(),
        quantity: random.int(0, 10),
      }));
      const counted = modules.filter((line) => line.quantity > 0);
      const expected =
        !sizing.dcrSchemes.includes(scheme) ||
        (counted.length > 0 && counted.every((line) => line.isDcr));
      expect(dcrRule({ scheme, modules }).inBounds).toBe(expected);
    });
  });
});
