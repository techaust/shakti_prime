import { describe, expect, it } from 'vitest';
import { filterOutbound } from './output-filter';

const rules = { linkHosts: ['shaktisupreme.in'], companyNumbers: ['+919000000001'] };

describe('filterOutbound (BLUEPRINT §9.4, design phase2 §6.1)', () => {
  it('passes plain text, a date, an amount and the company’s own site and number', () => {
    expect(
      filterOutbound(
        [
          'Your engineer visits on 28-11-2026 at 11:00.',
          'The quote is ₹1,24,500.',
          'See https://www.shaktisupreme.in/pumps or call +91 90000 00001.',
        ],
        rules,
      ),
    ).toEqual({ ok: true });
  });

  it('refuses a message longer than WhatsApp takes', () => {
    expect(filterOutbound(['x'.repeat(4097)], rules)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('refuses a link to any other site, written in any of its usual shapes', () => {
    for (const text of ['https://bit.ly/abc', 'www.example-shop.com', 'visit cheap-pumps.in/offer']) {
      expect(filterOutbound([text], rules)).toEqual({ ok: false, reason: 'link' });
    }
    expect(filterOutbound(['https://shaktisupreme.in'], { ...rules, linkHosts: [] })).toEqual({
      ok: false,
      reason: 'link',
    });
  });

  it('refuses an identity or bank account number, masked or not', () => {
    for (const text of [
      'Aadhaar 2345 6789 0124',
      'Your number XXXX XXXX 0124 is noted',
      'Account number 123456789012',
    ]) {
      expect(filterOutbound([text], rules)).toEqual({ ok: false, reason: 'identity_number' });
    }
  });

  it('refuses a phone number other than the company’s own', () => {
    expect(filterOutbound(['Call me on 98123 45678'], rules)).toEqual({ ok: false, reason: 'phone' });
  });
});
