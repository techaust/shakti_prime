import { describe, expect, it } from 'vitest';
import { LeadIngestInput } from './ingest';

const base = {
  entityId: 1,
  channel: 'meta_ads',
  sourceId: '01990000-0000-7000-8000-000000000a01',
  externalId: '1234567890123456',
  contact: { name: 'Ramesh Kumar', phone: '098290 12345' },
} as const;

describe('LeadIngestInput', () => {
  it('normalises the phone and keeps the provider ids whole', () => {
    const parsed = LeadIngestInput.parse({
      ...base,
      attribution: { campaignId: '23851234567890123', adId: '23851234567890124' },
    });
    expect(parsed.contact.phone).toBe('+919829012345');
    expect(parsed.attribution?.campaignId).toBe('23851234567890123');
  });

  it('takes a WhatsApp lead with its click id and a pipeline, and no consent', () => {
    const whatsapp = {
      entityId: 2,
      channel: 'whatsapp',
      pipelineKey: 'farmer_pumps',
      externalId: 'wamid.HBgMOTE5ODI5MDEyMzQ1FQIAEhgg',
      contact: { name: 'R', phone: '+919829012345' },
      attribution: { ctwaClid: 'ARAkLkA8rmlFeiCktEJQ', referralSourceType: 'ad' },
    };
    expect(LeadIngestInput.safeParse(whatsapp).success).toBe(true);
    const withConsent = {
      ...whatsapp,
      consent: {
        channels: ['whatsapp'],
        purpose: 'service',
        textVersion: 'v1',
        givenAt: '2026-11-14T05:00:00.000Z',
      },
    };
    expect(LeadIngestInput.safeParse(withConsent).success).toBe(false);
  });

  it('needs a source or a pipeline', () => {
    expect(LeadIngestInput.safeParse({ ...base, sourceId: undefined }).success).toBe(false);
  });

  it('takes each consent channel once', () => {
    const consent = {
      channels: ['call', 'call'],
      purpose: 'service',
      textVersion: 'v1',
      givenAt: '2026-11-14T05:00:00.000Z',
    };
    expect(LeadIngestInput.safeParse({ ...base, consent }).success).toBe(false);
    expect(
      LeadIngestInput.safeParse({
        ...base,
        consent: { ...consent, channels: ['call', 'whatsapp'] },
      }).success,
    ).toBe(true);
  });

  it('refuses a qualification fact out of range and an unknown field', () => {
    expect(LeadIngestInput.safeParse({ ...base, qualification: { pumpDepthFt: -3 } }).success).toBe(
      false,
    );
    expect(LeadIngestInput.safeParse({ ...base, ownerId: base.sourceId }).success).toBe(false);
  });
});
