import { describe, expect, it } from 'vitest';
import { BELL_POLL_MS, noticeHref } from './notices';

const account = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a10';
const quote = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a11';

describe('where a notice takes its person (docs/design/phase1.md §8.1)', () => {
  it('opens the screen each kind of notice is acted on', () => {
    expect(noticeHref({ type: 'call_due', entityId: 2, accountId: account, quoteId: null })).toBe(
      '/calling',
    );
    expect(
      noticeHref({ type: 'quote_expiring', entityId: 2, accountId: account, quoteId: quote }),
    ).toBe(`/quotes/2/${quote}`);
    const toCustomer = [
      'lead_assigned',
      'duplicate_found',
      'first_call_late',
      'enquiry_routed',
    ] as const;
    for (const type of toCustomer) {
      expect(noticeHref({ type, entityId: 3, accountId: account, quoteId: null })).toBe(
        `/customers/${account}?company=3`,
      );
    }
  });

  it('falls back to a screen everyone has when the record is not named', () => {
    expect(noticeHref({ type: 'lead_assigned', entityId: 1, accountId: null, quoteId: null })).toBe(
      '/home',
    );
    expect(
      noticeHref({ type: 'quote_expiring', entityId: 1, accountId: null, quoteId: null }),
    ).toBe('/quotes');
  });

  it('asks for the count every 15 seconds (DECISIONS 29-09-2026)', () => {
    expect(BELL_POLL_MS).toBe(15_000);
  });
});
