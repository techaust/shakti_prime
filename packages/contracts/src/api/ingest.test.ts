import { describe, expect, it } from 'vitest';
import { API_FIXTURES } from './fixtures';
import { IngestLeadRequest } from './ingest';

const lead = API_FIXTURES['ingest.leads'].request as Record<string, unknown>;

describe('website lead ingest', () => {
  it('stores the phone as E.164 whatever the visitor typed', () => {
    expect(IngestLeadRequest.parse(lead).phone).toBe('+919829000017');
  });

  it('refuses a lead without the consent wording and time', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, consent: undefined }).success).toBe(false);
    const consent = { purpose: 'service', text: 'yes', givenAt: '2026-09-27T04:12:09Z' };
    expect(IngestLeadRequest.safeParse({ ...lead, consent }).success).toBe(false);
  });

  it('refuses a field the contract does not name', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, ownerId: 'someone' }).success).toBe(false);
  });

  it('needs the Turnstile answer and a known segment', () => {
    expect(IngestLeadRequest.safeParse({ ...lead, turnstileToken: '' }).success).toBe(false);
    expect(IngestLeadRequest.safeParse({ ...lead, segment: 'wind' }).success).toBe(false);
  });
});
