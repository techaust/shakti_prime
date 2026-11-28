import { describe, expect, it } from 'vitest';
import { acceptedAnswer, codeAnswer, statusAnswer } from './answers';
import { milestoneValues } from './milestones';

// The platform's own words on a chat (docs/03-roadmap-appendix/phase2.md §7.1): fixed sentences
// from the catalogue with the customer's records filled in, amounts and dates by the print
// formatters from the stored values.

const at = (iso: string) => new Date(iso);

describe('the STATUS answer (WA-03)', () => {
  it('lists the quotes, orders and projects it is given, newest first as given, in plain words', () => {
    expect(
      statusAnswer([
        {
          kind: 'quote',
          ref: 'SMP/Q/2026-27/0007',
          state: 'sent',
          grandTotal: '67200.00',
          validUntil: at('2026-12-01T18:29:59Z'),
          createdAt: at('2026-11-17T05:00:00Z'),
          step: null,
        },
        {
          kind: 'quote',
          ref: 'SMP/Q/2026-27/0003',
          state: 'expired',
          grandTotal: '125000.5',
          validUntil: at('2026-10-01T18:29:59Z'),
          createdAt: at('2026-09-17T05:00:00Z'),
          step: null,
        },
        {
          kind: 'order',
          ref: 'SMP/SO/2026-27/0002',
          state: 'confirmed',
          grandTotal: '268800.00',
          validUntil: null,
          createdAt: at('2026-11-10T05:00:00Z'),
          step: null,
        },
        {
          kind: 'project',
          ref: 'SMP/PRJ/2026-27/0004',
          state: 'active',
          grandTotal: null,
          validUntil: null,
          createdAt: at('2026-11-11T05:00:00Z'),
          step: { key: 'install', title: null },
        },
        {
          kind: 'project',
          ref: 'SMP/PRJ/2026-27/0002',
          state: 'on_hold',
          grandTotal: null,
          validUntil: null,
          createdAt: at('2026-10-11T05:00:00Z'),
          step: { key: 'net_meter', title: 'Net meter fitted' },
        },
        {
          kind: 'project',
          ref: 'SMP/PRJ/2026-27/0001',
          state: 'active',
          grandTotal: null,
          validUntil: null,
          createdAt: at('2026-09-11T05:00:00Z'),
          step: { key: 'net_meter', title: 'Net meter fitted' },
        },
      ]),
    ).toBe(
      [
        'Your quotes, orders and projects with us:',
        'Quote SMP/Q/2026-27/0007: waiting for your answer, ₹67,200.00, valid until 01-12-2026',
        'Quote SMP/Q/2026-27/0003: no longer valid, ₹1,25,000.50',
        'Order SMP/SO/2026-27/0002: confirmed, ₹2,68,800.00',
        'Project SMP/PRJ/2026-27/0004: in progress, next step installation',
        'Project SMP/PRJ/2026-27/0002: on hold',
        'Project SMP/PRJ/2026-27/0001: in progress, next step Net meter fitted',
      ].join('\n'),
    );
  });

  it('says plainly when the number has nothing', () => {
    expect(statusAnswer([])).toBe(
      'We found no quotes, orders or projects for this number. Write your question here and our team will help.',
    );
  });
});

describe('the answers to a press and a code', () => {
  it('names the quote and its order, and promises nothing more (review 9)', () => {
    // No confirmation is promised: it reaches the customer only when the company maps one.
    expect(acceptedAnswer('SMP/Q/1', 'SMP/SO/1', false)).toBe(
      'Thank you. Quote SMP/Q/1 is accepted and your order number is SMP/SO/1.',
    );
    expect(acceptedAnswer('SMP/Q/1', 'SMP/SO/1', true)).toBe(
      'Quote SMP/Q/1 is already accepted. Your order number is SMP/SO/1.',
    );
  });

  it('counts the tries left, and says what to do once none are', () => {
    expect(codeAnswer({ outcome: 'wrong', triesLeft: 2 })).toBe(
      'That code does not match. You can try 2 more times.',
    );
    expect(codeAnswer({ outcome: 'wrong', triesLeft: 1 })).toBe(
      'That code does not match. You can try once more.',
    );
    expect(codeAnswer({ outcome: 'locked' })).toBe(
      'That code did not match 3 times. Press Accept on the quote again for a new code.',
    );
    expect(codeAnswer({ outcome: 'expired' })).toBe(
      'That code is no longer valid. Press Accept on the quote again for a new code.',
    );
  });
});

describe('a milestone’s values (WA-01)', () => {
  const subject = {
    accountId: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a10',
    ref: 'SMP/Q/2026-27/0007',
    grandTotal: '67200.00',
    validUntil: at('2026-12-01T18:29:59Z'),
    state: 'sent',
    threadId: null,
    alreadySent: false,
  };

  it('gives a quote its number, total and the date it is valid until, an order its number and total', () => {
    expect(milestoneValues('quote_sent', subject)).toEqual([
      'SMP/Q/2026-27/0007',
      '₹67,200.00',
      '01-12-2026',
    ]);
    expect(
      milestoneValues('order_confirmed', { ...subject, ref: 'SMP/SO/1', validUntil: null }),
    ).toEqual(['SMP/SO/1', '₹67,200.00']);
  });
});
