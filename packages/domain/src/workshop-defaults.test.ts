import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from './workshop-defaults';

// These are the defaults the user approved with design §6 to §8 until the workshop answers
// (docs/design/backend-weeks-3-5.md §11). A change here is a workshop decision: update this test
// and regenerate the state-machine documents with it.
describe('workshop defaults', () => {
  it('hold the approved values', () => {
    expect(WORKSHOP_DEFAULTS).toEqual({
      tax: {
        placeOfSupplyOrder: ['site', 'account_gstin', 'entity'],
        roundDocumentToRupee: true,
        compositeSegments: ['residential_rooftop', 'commercial_epc'],
      },
      opportunity: { handoverLockHours: 48, reopenWindowDays: 30 },
      quote: { validityDays: 15 },
      credit: { exposureCountsConfirmedOrders: true },
      dispatch: { ewayBillThresholdPaise: 5_000_000n },
      sizing: {
        hazenWilliamsC: { hdpe: 140, gi: 120 },
        fittingsLossFraction: 0.1,
        efficiency: {
          submersible: { pump: 0.55, motor: 0.78 },
          surface: { pump: 0.6, motor: 0.82 },
        },
        solarArrayOversize: 1.3,
        moduleWp: 540,
        peakSunHours: 5.5,
        performanceRatio: 0.75,
        roofAreaPerKwSqm: 10,
        motorMarginFraction: 0.1,
        standardHp: [0.5, 1, 1.5, 2, 3, 5, 7.5, 10, 12.5, 15, 20, 25, 30],
        dutyFlowTolerance: 0.1,
        dutyFlowOvershootFactor: 1.5,
        surfaceMaxSuctionLiftM: 7,
        maxPipeVelocityMps: 2,
        dcrSchemes: ['pm_surya_ghar', 'pm_kusum'],
      },
    });
  });

  it('lists the standard HP ratings in ascending order, each once', () => {
    const ratings = WORKSHOP_DEFAULTS.sizing.standardHp;
    expect([...ratings].sort((a, b) => a - b)).toEqual(ratings);
    expect(new Set(ratings).size).toBe(ratings.length);
  });

  it('keeps every sizing efficiency and ratio a fraction above 0 and at most 1', () => {
    const { efficiency, performanceRatio } = WORKSHOP_DEFAULTS.sizing;
    for (const value of [
      performanceRatio,
      ...Object.values(efficiency).flatMap((pair) => [pair.pump, pair.motor]),
    ]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('always ends the place-of-supply order with the entity, so a document always has one', () => {
    expect(WORKSHOP_DEFAULTS.tax.placeOfSupplyOrder.at(-1)).toBe('entity');
  });
});
