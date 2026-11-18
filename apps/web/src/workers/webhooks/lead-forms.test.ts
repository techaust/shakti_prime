import type { MetaLeadDetails } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../integrations/http';
import { fetchRefusal, metaAnswers } from './lead-forms';

describe('fetchRefusal', () => {
  it('blames the Page token only for an expired or invalid token', () => {
    expect(
      fetchRefusal(new ProviderError('meta_leadgen', 'http', { status: 400, vendorCode: '190' })),
    ).toBe('page_token_refused');
    expect(
      fetchRefusal(new ProviderError('meta_leadgen', 'http', { status: 400, vendorCode: '102' })),
    ).toBe('page_token_refused');
    expect(fetchRefusal(new ProviderError('meta_leadgen', 'http', { status: 401 }))).toBe(
      'page_token_refused',
    );
  });

  it('names a lead it cannot read, and any other refusal, apart', () => {
    expect(
      fetchRefusal(new ProviderError('meta_leadgen', 'invalid_response', { status: 200 })),
    ).toBe('lead_unreadable');
    expect(
      fetchRefusal(new ProviderError('meta_leadgen', 'http', { status: 404, vendorCode: '100' })),
    ).toBe('lead_fetch_refused');
    expect(
      fetchRefusal(new ProviderError('meta_leadgen', 'http', { status: 403, vendorCode: '200' })),
    ).toBe('lead_fetch_refused');
  });
});

describe('metaAnswers', () => {
  it('joins a question’s values and reads each consent box as yes or no', () => {
    const lead = {
      id: '1',
      created_time: '2026-11-15T05:00:00+0000',
      field_data: [{ name: 'interest', values: ['pump', 'solar'] }],
      custom_disclaimer_responses: [
        { checkbox_key: 'call_consent', is_checked: '1' },
        { checkbox_key: 'promo', is_checked: '' },
      ],
    } as MetaLeadDetails;
    expect(metaAnswers(lead)).toEqual([
      { key: 'interest', label: null, value: 'pump, solar' },
      { key: 'call_consent', label: null, value: 'yes' },
      { key: 'promo', label: null, value: 'no' },
    ]);
  });
});
