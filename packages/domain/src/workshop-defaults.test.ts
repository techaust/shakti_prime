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
      numbering: {
        docCodes: {
          quote: 'Q',
          sales_order: 'SO',
          proforma: 'PI',
          challan: 'DC',
          purchase_order: 'PO',
        },
        separator: '/',
        serialDigits: 4,
      },
      pricing: { tierByAccountType: {}, kitPricing: 'fixed' },
      credit: { exposureCountsConfirmedOrders: true },
      dispatch: { ewayBillThresholdPaise: 5_000_000n },
      crm: {
        dispositions: [
          { key: 1, code: 'interested', label: 'Interested', nextAction: 'callback' },
          { key: 2, code: 'call_back_later', label: 'Call back later', nextAction: 'callback' },
          { key: 3, code: 'not_reachable', label: 'Not reachable', nextAction: 'retry' },
          { key: 4, code: 'switched_off', label: 'Switched off', nextAction: 'retry' },
          { key: 5, code: 'wrong_number', label: 'Wrong number', nextAction: 'wrong_number' },
          { key: 6, code: 'not_interested', label: 'Not interested', nextAction: 'not_interested' },
          { key: 7, code: 'already_bought', label: 'Already bought', nextAction: 'not_interested' },
          { key: 8, code: 'qualified', label: 'Qualified', nextAction: 'qualified' },
        ],
        scoreBase: 50,
        scoreRules: [],
        firstContactSlaMinutes: null,
      },
      // The owner's defaults of 05-10-2026 for CALL-3 and CALL-5, for the sales head to confirm.
      calling: { attemptDays: [0, 1, 2], nurtureCallDays: [7, 30, 90] },
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
        sanctionedLoadRatio: 1,
        dcrSchemes: ['pm_surya_ghar', 'pm_kusum'],
      },
    });
  });

  it('gives the default call outcomes nine number keys at most, each key and code once', () => {
    const list = WORKSHOP_DEFAULTS.crm.dispositions;
    expect(list.length).toBeLessThanOrEqual(9);
    expect(new Set(list.map((d) => d.key)).size).toBe(list.length);
    expect(new Set(list.map((d) => d.code)).size).toBe(list.length);
    for (const d of list) expect(d.key).toBeGreaterThanOrEqual(1);
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
