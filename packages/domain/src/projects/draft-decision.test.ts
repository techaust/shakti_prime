import { describe, expect, it } from 'vitest';
import {
  draftDecision,
  flowOf,
  installSegment,
  orderConfirmed,
  type OrderFacts,
} from './draft-decision';

const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  orderState: 'confirmed',
  accountId: '01990000-0000-7000-8000-000000000001',
  siteId: '01990000-0000-7000-8000-000000000002',
  segment: 'farmer_pumps',
  scheme: 'none',
  entityCode: 'SS',
  projects: 0,
  liveProjectId: null,
  ...over,
});

describe('draftDecision (phase 4 §2, question 1 (a))', () => {
  it('drafts a confirmed order of each install segment with a site, with its scheme and flow', () => {
    for (const segment of ['farmer_pumps', 'residential_rooftop', 'commercial_epc'] as const) {
      expect(draftDecision(facts({ segment }))).toEqual({
        draft: true,
        segment,
        scheme: 'none',
        flow: 'standard',
      });
    }
    expect(
      draftDecision(facts({ segment: 'residential_rooftop', scheme: 'pm_surya_ghar' })),
    ).toEqual({
      draft: true,
      segment: 'residential_rooftop',
      scheme: 'pm_surya_ghar',
      flow: 'surya_ghar',
    });
    expect(draftDecision(facts({ scheme: 'pm_kusum' }))).toMatchObject({ flow: 'standard' });
  });

  it("never drafts a dealer's sale, a lead of no segment or an order without a site", () => {
    expect(draftDecision(facts({ segment: 'dealer_wholesale' }))).toEqual({
      draft: false,
      because: 'not_install_segment',
    });
    expect(draftDecision(facts({ segment: null }))).toEqual({
      draft: false,
      because: 'not_install_segment',
    });
    expect(draftDecision(facts({ siteId: null }))).toEqual({ draft: false, because: 'no_site' });
  });

  it('drafts once per order, and only from confirmation until cancellation', () => {
    expect(draftDecision(facts({ projects: 1 }))).toEqual({
      draft: false,
      because: 'already_drafted',
    });
    for (const orderState of ['draft', 'cancelled']) {
      expect(draftDecision(facts({ orderState }))).toEqual({
        draft: false,
        because: 'order_not_confirmed',
      });
    }
    expect(draftDecision(undefined)).toEqual({ draft: false, because: 'order_not_confirmed' });
    for (const state of ['confirmed', 'partially_dispatched', 'dispatched', 'invoiced', 'closed']) {
      expect(orderConfirmed(state)).toBe(true);
    }
  });

  it('reads the segment and the flow', () => {
    expect(installSegment('dealer_wholesale')).toBeNull();
    expect(installSegment('commercial_epc')).toBe('commercial_epc');
    expect(flowOf('pm_surya_ghar')).toBe('surya_ghar');
    expect(flowOf('none')).toBe('standard');
  });
});
