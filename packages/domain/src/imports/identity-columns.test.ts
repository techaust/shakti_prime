import { describe, expect, it } from 'vitest';
import { asciiDigits } from '../privacy/number-shapes';
import { verhoeffCheckDigit } from '../privacy/verhoeff';
import { namesAadhaar, withoutIdentityNumbers } from './identity-columns';

/** A twelve-digit number in one run that is a mobile number with 91 and a valid Aadhaar number. */
const BOTH = `91987654321${verhoeffCheckDigit('91987654321')}`;

describe('the identity numbers of an import file (audit SEC-1)', () => {
  it('names a column of Aadhaar numbers by its header, however it is spelt', () => {
    for (const header of [
      'Aadhaar',
      'AADHAR NO.',
      'Adhaar card number',
      'aadhaar_number',
      'Aadhar-No',
      'UID',
      'UID No',
      'आधार नंबर',
      'આધાર કાર્ડ',
    ]) {
      expect(namesAadhaar(header)).toBe(true);
    }
    for (const header of ['Name', 'Mobile', 'Guide', 'Village', 'Fluid level', 'Notes']) {
      expect(namesAadhaar(header)).toBe(false);
    }
  });

  it('leaves out a column whose header names Aadhaar, even when it is empty', () => {
    const out = withoutIdentityNumbers(
      ['Name', 'Aadhaar', 'Mobile'],
      [
        ['Ram', '', '9876543210'],
        ['Sita', '2345 6789 0123', '9812345678'],
      ],
    );
    expect(out).toEqual({
      columns: ['Name', 'Mobile'],
      rows: [
        ['Ram', '9876543210'],
        ['Sita', '9812345678'],
      ],
      leftOutColumns: ['Aadhaar'],
      maskedValues: 0,
    });
  });

  it('leaves out a column half or more of whose filled cells hold an Aadhaar number, in any shape', () => {
    const out = withoutIdentityNumbers(
      ['Name', 'ID', 'Village'],
      [
        ['Ram', '2345.6789.0123', 'Sikar'],
        ['Sita', '२३४५ ६७८९ ०१२३', 'Churu'],
        ['Gopal', 'V-12', 'Idar'],
        ['Meera', '', 'Idar'],
      ],
    );
    expect(out.columns).toEqual(['Name', 'Village']);
    expect(out.leftOutColumns).toEqual(['ID']);
    expect(JSON.stringify(out)).not.toMatch(/2345|6789|0123/);
  });

  it('keeps only the last four digits of an Aadhaar number inside another cell', () => {
    const out = withoutIdentityNumbers(
      ['Name', 'Address', 'Notes'],
      [
        ['Ram', 'H 4, Sikar, UID 2345 6789 0123', 'Card २३४५-६७८९-०१२३ seen'],
        ['Sita', 'Ward 3, Churu', 'Pump 5 HP on 13-10-2026, ₹1,45,000'],
        ['Gopal', 'Idar', ''],
      ],
    );
    expect(out.leftOutColumns).toEqual([]);
    expect(out.rows).toEqual([
      ['Ram', 'H 4, Sikar, UID XXXX XXXX 0123', 'Card XXXX-XXXX-०१२३ seen'],
      ['Sita', 'Ward 3, Churu', 'Pump 5 HP on 13-10-2026, ₹1,45,000'],
      ['Gopal', 'Idar'],
    ]);
    expect(out.maskedValues).toBe(2);
    expect(asciiDigits(JSON.stringify(out.rows))).not.toMatch(/2345|6789/);
  });

  it('keeps a mobile number written with 91 in a phone column, and masks the same digits elsewhere', () => {
    const out = withoutIdentityNumbers(
      ['Name', 'Mobile', 'Notes'],
      [
        ['Ram', BOTH, `ref ${BOTH}`],
        ['Sita', '919812345678', ''],
      ],
    );
    expect(out.columns).toEqual(['Name', 'Mobile', 'Notes']);
    expect(out.rows[0]).toEqual(['Ram', BOTH, `ref XXXXXXXX${BOTH.slice(-4)}`]);
    expect(out.rows[1]).toEqual(['Sita', '919812345678']);
  });

  it('keeps phone numbers, PIN codes, dates and amounts as written', () => {
    const rows = [['Ram', '98765 43210', '302001', '13-10-2026', '₹1,45,000', 'SP-7.5-100-2026']];
    const out = withoutIdentityNumbers(['Name', 'Phone', 'PIN', 'Date', 'Budget', 'Product'], rows);
    expect(out.rows).toEqual(rows);
    expect(out.maskedValues).toBe(0);
  });

  it('changes nothing when applied again', () => {
    const once = withoutIdentityNumbers(
      ['Name', 'Aadhaar', 'Address'],
      [['Ram', '2345 6789 0123', 'card 3456 7890 1234']],
    );
    const twice = withoutIdentityNumbers(once.columns, once.rows);
    expect(twice).toEqual({ ...once, leftOutColumns: [], maskedValues: 0 });
  });
});
