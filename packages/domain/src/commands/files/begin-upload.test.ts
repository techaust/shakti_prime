import { describe, expect, it } from 'vitest';
import { customerDocumentName } from './begin-upload';

// A customer document's name keeps only the last four digits of any number that could identify
// the customer (SECURITY §5). Every number here is made up.
describe('customerDocumentName', () => {
  it('keeps the last four digits of an Aadhaar-shaped number', () => {
    expect(customerDocumentName('aadhaar 2345 6789 0124.jpg')).toBe('aadhaar XXXX XXXX 0124.jpg');
  });

  it('keeps the last four digits of a bank account number of 9 to 18 digits', () => {
    expect(customerDocumentName('SBI acct 12345678901234.pdf')).toBe('SBI acct XXXXXXXXXX1234.pdf');
    expect(customerDocumentName('passbook 123456789.jpg')).toBe('passbook XXXXX6789.jpg');
    expect(customerDocumentName('account 123456789012345678.pdf')).toBe(
      'account XXXXXXXXXXXXXX5678.pdf',
    );
  });

  it('leaves a short number as it is', () => {
    expect(customerDocumentName('bill 2026 page 12345678.pdf')).toBe('bill 2026 page 12345678.pdf');
  });
});
