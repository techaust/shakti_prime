import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from './workshop-defaults';

// These are the defaults the user approved with design §6 to §8 until the workshop answers
// (docs/design/backend-weeks-3-5.md §12). A change here is a workshop decision: update this test
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
    });
  });

  it('always ends the place-of-supply order with the entity, so a document always has one', () => {
    expect(WORKSHOP_DEFAULTS.tax.placeOfSupplyOrder.at(-1)).toBe('entity');
  });
});
