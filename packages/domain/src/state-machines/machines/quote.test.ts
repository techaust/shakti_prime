import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { transition } from '../define-machine';
import { everything } from '../test-support';
import { quoteMachine, quoteValidUntil, type QuoteRecord } from './quote';

describe('quoteValidUntil (end of day IST, 15 calendar days after creation)', () => {
  it.each([
    ['a morning quote', '2026-06-01T10:00:00+05:30', '2026-06-16T23:59:59.999+05:30'],
    ['created at midnight IST', '2026-06-01T00:00:00+05:30', '2026-06-16T23:59:59.999+05:30'],
    [
      'created one millisecond before midnight IST',
      '2026-06-01T23:59:59.999+05:30',
      '2026-06-16T23:59:59.999+05:30',
    ],
    [
      '18:29 UTC is still the same IST day',
      '2026-06-01T18:29:59.999Z',
      '2026-06-16T23:59:59.999+05:30',
    ],
    ['18:30 UTC is the next IST day', '2026-06-01T18:30:00.000Z', '2026-06-17T23:59:59.999+05:30'],
    ['across a month end', '2026-01-20T12:00:00+05:30', '2026-02-04T23:59:59.999+05:30'],
    ['across a leap day', '2028-02-20T12:00:00+05:30', '2028-03-06T23:59:59.999+05:30'],
    ['across the financial year', '2027-03-25T12:00:00+05:30', '2027-04-09T23:59:59.999+05:30'],
  ])('%s', (_label, created, expected) => {
    expect(quoteValidUntil(new Date(created)).toISOString()).toBe(new Date(expected).toISOString());
  });

  it('ends at 18:29:59.999 UTC', () => {
    expect(quoteValidUntil(new Date('2026-06-01T10:00:00+05:30')).toISOString()).toBe(
      '2026-06-16T18:29:59.999Z',
    );
  });
});

describe('accepting against the validity', () => {
  const created = new Date('2026-06-01T10:00:00+05:30');
  const record: QuoteRecord = {
    state: 'sent',
    segment: 'farmer_pumps',
    priceListId: newId(),
    sizingComplete: true,
    pumpCurveInBounds: true,
    dcrRuleMet: true,
    pdfFileId: newId(),
    validUntil: quoteValidUntil(created),
  };
  const accept = (now: string) =>
    transition(quoteMachine, record, 'accept', {
      actor: everything(),
      now: new Date(now),
      params: { acceptedVia: 'whatsapp_reply' },
    });

  it('accepts on the last day up to the last millisecond in IST', () => {
    expect(accept('2026-06-16T23:59:59.999+05:30').to).toBe('accepted');
  });

  it('refuses from the first millisecond of the next IST day', () => {
    expect(() => accept('2026-06-17T00:00:00.000+05:30')).toThrow(
      expect.objectContaining({ code: 'conflict', details: { reason: 'quote_expired' } }),
    );
  });

  it('lets the expiry job expire it only after the last millisecond', () => {
    const job = { kind: 'system', job: 'quote-expiry' } as const;
    expect(() =>
      transition(quoteMachine, record, 'expire', {
        actor: job,
        now: new Date('2026-06-16T23:59:59.999+05:30'),
        params: {},
      }),
    ).toThrow(expect.objectContaining({ details: { reason: 'quote_still_valid' } }));
    expect(
      transition(quoteMachine, record, 'expire', {
        actor: job,
        now: new Date('2026-06-17T00:00:00.000+05:30'),
        params: {},
      }).to,
    ).toBe('expired');
  });

  it('refuses acceptance of a quote with no validity recorded', () => {
    expect(() =>
      transition(quoteMachine, { ...record, validUntil: null }, 'accept', {
        actor: everything(),
        now: created,
        params: { acceptedVia: 'signed_upload' },
      }),
    ).toThrow(expect.objectContaining({ details: { reason: 'quote_expired' } }));
  });
});
