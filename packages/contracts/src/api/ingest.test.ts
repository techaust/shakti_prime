import { describe, expect, it } from 'vitest';
import { API_FIXTURES } from './fixtures';
import { IngestLeadRequest } from './ingest';

const lead = API_FIXTURES['ingest.leads'].request as Record<string, unknown>;

describe('website lead ingest', () => {
  it('stores the phone as E.164 whatever the visitor typed', () => {
    expect(IngestLeadRequest.parse(lead).phone).toBe('+919829000017');
  });

  it('takes a lead with no consent box, and refuses a box without its tick, wording or time', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, consent: undefined }).success).toBe(true);
    const text = 'I agree to be called about my enquiry.';
    const givenAt = '2026-09-27T04:12:09Z';
    expect(IngestLeadRequest.safeParse({ ...lead, consent: { text, givenAt } }).success).toBe(
      false,
    );
    expect(
      IngestLeadRequest.safeParse({ ...lead, consent: { ticked: true, text: 'yes', givenAt } })
        .success,
    ).toBe(false);
    expect(
      IngestLeadRequest.safeParse({ ...lead, consent: { ticked: false, text, givenAt } }).success,
    ).toBe(true);
  });

  it('refuses a field the contract does not name', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, ownerId: 'someone' }).success).toBe(false);
  });

  it('needs the Turnstile answer and a known segment', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, turnstileToken: '' }).success).toBe(false);
    expect(IngestLeadRequest.safeParse({ ...lead, segment: 'wind' }).success).toBe(false);
  });
});
