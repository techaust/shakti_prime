import { describe, expect, it } from 'vitest';
import { documentPrefix, financialYear, formatDocumentNo, istCalendarDate } from './financial-year';

describe('financialYear', () => {
  it('turns over at midnight IST on 1 April, not at midnight UTC', () => {
    expect(financialYear(new Date('2026-03-31T18:29:59Z'))).toBe('2025-26');
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('2026-27');
  });

  it('covers January to March with the previous calendar year', () => {
    expect(financialYear(new Date('2026-09-27T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-01-15T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-04-01T00:00:00Z'))).toBe('2027-28');
  });

  it('writes the century turnover with two digits', () => {
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });
});

describe('istCalendarDate', () => {
  it('is the IST date in the form Postgres date columns use', () => {
    expect(istCalendarDate(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
    expect(istCalendarDate(new Date('2026-03-31T18:29:59Z'))).toBe('2026-03-31');
  });
});

describe('document numbers', () => {
  it('prefixes by entity and document type', () => {
    expect(documentPrefix('SS', 'quote')).toBe('SS/Q');
    expect(documentPrefix('SMP', 'sales_order')).toBe('SMP/SO');
    expect(documentPrefix('ASH', 'proforma')).toBe('ASH/PI');
    expect(documentPrefix('RCREF', 'challan')).toBe('RCREF/DC');
    expect(documentPrefix('SS', 'purchase_order')).toBe('SS/PO');
  });

  it('pads the running number to four digits and grows beyond', () => {
    expect(formatDocumentNo('SS/Q', '2026-27', 7)).toBe('SS/Q/2026-27/0007');
    expect(formatDocumentNo('SS/Q', '2026-27', 12345)).toBe('SS/Q/2026-27/12345');
  });
});
