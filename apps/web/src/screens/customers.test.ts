import { describe, expect, it } from 'vitest';
import { companyParam, customerHref, dueFromLocal, localFromIso } from './customers';

describe('customer screen helpers', () => {
  it('links Account 360 in the lead’s company', () => {
    expect(customerHref('0199aaaa-0000-7000-8000-000000000001', 2)).toBe(
      '/customers/0199aaaa-0000-7000-8000-000000000001?company=2',
    );
  });

  it('reads only a whole company number from the address', () => {
    expect(companyParam('3')).toBe(3);
    expect(companyParam(['4', '5'])).toBe(4);
    for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '123456']) {
      expect(companyParam(bad)).toBeUndefined();
    }
  });

  it('reads a typed due time as India time and back', () => {
    expect(dueFromLocal('2026-10-01T09:30')).toBe('2026-10-01T04:00:00.000Z');
    // Midnight in India is the previous day in UTC.
    expect(dueFromLocal('2026-10-01T00:00')).toBe('2026-09-30T18:30:00.000Z');
    expect(dueFromLocal('')).toBeUndefined();
    expect(dueFromLocal('2026-10-01')).toBeUndefined();
    expect(localFromIso('2026-10-01T04:00:00.000Z')).toBe('2026-10-01T09:30');
  });
});
