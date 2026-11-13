import { describe, expect, it } from 'vitest';
import { callPurpose, CUSTOMER_REQUEST_CHANNELS, type PurposeFacts } from './call-purpose';

const cold: PurposeFacts = {
  sourceChannel: 'import',
  hasOpenCallback: false,
  hasOrder: false,
  hasServiceConsent: false,
};

describe('callPurpose (BLUEPRINT §7.7, design phase2 §5.2)', () => {
  it('makes every call promotional without a service consent for calls, whatever the lead', () => {
    for (const facts of [
      cold,
      { ...cold, sourceChannel: 'website' as const },
      { ...cold, hasOpenCallback: true },
      { ...cold, hasOrder: true },
    ]) {
      expect(callPurpose(facts)).toEqual({
        purpose: 'promotional',
        why: 'promotional_no_consent',
      });
    }
  });

  it('makes a consented call service when the customer asked: an order, a callback, an enquiry', () => {
    const consented = { ...cold, hasServiceConsent: true };
    expect(callPurpose({ ...consented, hasOrder: true, hasOpenCallback: true })).toEqual({
      purpose: 'service',
      why: 'service_order',
    });
    expect(callPurpose({ ...consented, hasOpenCallback: true })).toEqual({
      purpose: 'service',
      why: 'service_callback',
    });
    for (const channel of CUSTOMER_REQUEST_CHANNELS) {
      expect(callPurpose({ ...consented, sourceChannel: channel })).toEqual({
        purpose: 'service',
        why: 'service_enquiry',
      });
    }
  });

  it('keeps a consented call promotional when the company reached out first', () => {
    for (const sourceChannel of ['referral', 'import', 'manual', null] as const) {
      expect(callPurpose({ ...cold, hasServiceConsent: true, sourceChannel })).toEqual({
        purpose: 'promotional',
        why: 'promotional_not_requested',
      });
    }
  });
});
