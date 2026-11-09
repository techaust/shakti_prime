import { describe, expect, it } from 'vitest';
import { maskInputIdentity, maskTypedIdentity } from './input-masking';
import { isAadhaarNumber } from './identity-numbers';

/** A valid Aadhaar number (its Verhoeff check digit is 4). */
const AADHAAR = '234567890124';
/** The same eleven digits with a wrong check digit: not an Aadhaar number. */
const NOT_AADHAAR = '234567890123';
/** Devanagari digits, written as escapes: 2345 6789 0124. */
const DEVANAGARI =
  '२३४५ ६७८९ ०१२४';

const masked = (text: string): string => maskTypedIdentity(text).text;

describe('masking an Aadhaar number typed into a command input', () => {
  it('uses valid numbers in its examples', () => {
    expect(isAadhaarNumber(AADHAAR)).toBe(true);
    expect(isAadhaarNumber(NOT_AADHAAR)).toBe(false);
  });

  it.each([
    ['written plain', AADHAAR, 'XXXXXXXX0124'],
    ['grouped in fours', '2345 6789 0124', 'XXXX XXXX 0124'],
    ['with hyphens', '2345-6789-0124', 'XXXX-XXXX-0124'],
    ['with dots', '2345.6789.0124', 'XXXX.XXXX.0124'],
    ['in Devanagari digits', DEVANAGARI, `XXXX XXXX ${DEVANAGARI.slice(-4)}`],
    [
      'inside a sentence',
      'Customer gave Aadhaar 2345 6789 0124, asked us to call back.',
      'Customer gave Aadhaar XXXX XXXX 0124, asked us to call back.',
    ],
    ['touching letters', `UID${AADHAAR} seen`, 'UIDXXXXXXXX0124 seen'],
    ['after a label and a colon', 'Aadhaar: 2345 6789 0124.', 'Aadhaar: XXXX XXXX 0124.'],
  ])('masks one %s to its last four digits', (_, text, expected) => {
    expect(maskTypedIdentity(text)).toEqual({ text: expected, masked: 1 });
  });

  it('masks every number of a text and counts them', () => {
    const text = `First ${AADHAAR}; second 2345 6789 0124 and one more 2345-6789-0124`;
    expect(maskTypedIdentity(text)).toEqual({
      text: 'First XXXXXXXX0124; second XXXX XXXX 0124 and one more XXXX-XXXX-0124',
      masked: 3,
    });
  });

  it('masks the whole run that holds the number, a group joined to it included', () => {
    // As the imports mask it: what is joined to the number by a separator goes with it.
    expect(masked('Plot 12, 2345 6789 0124 is the card')).toBe(
      'Plot XX, XXXX XXXX 0124 is the card',
    );
    expect(masked('2345 6789 0124, 98765 43210')).toBe('XXXX XXXX XXXX, XXXXX X3210');
  });

  it('changes nothing the second time', () => {
    for (const text of [AADHAAR, '2345 6789 0124', DEVANAGARI, 'Plot 12, 2345 6789 0124']) {
      const once = masked(text);
      expect(maskTypedIdentity(once)).toEqual({ text: once, masked: 0 });
    }
  });

  it.each([
    ['a UUID whose last group is a valid Aadhaar number', `0190a1b2-c3d4-7e5f-8a9b-${AADHAAR}`],
    ['an idempotency key', '6f1c2d3e-4b5a-4c6d-8e7f-901234567890'],
    ['a money string', '125000.00'],
    ['a money string of twelve whole digits', `${AADHAAR}.00`],
    ['a money string with one decimal', `${AADHAAR}.5`],
    ['a date', '2026-11-09'],
    ['a timestamp', '2026-11-09T10:15:30.123Z'],
    ['a timestamp with its offset', '2026-11-09T15:45:30.123456+05:30'],
    ['an Indian phone in E.164', '+919876543210'],
    ['a phone of another country in E.164', `+${AADHAAR}`],
    ['a GSTIN', '08ABCDE1234F1Z5'],
    ['a PAN', 'ABCDE1234F'],
    ['an IFSC', 'SBIN0001234'],
    ['an HSN code', '85414300'],
    ['a twelve-digit number with an invalid check digit', NOT_AADHAAR],
    ['the same, grouped', '2345 6789 0123'],
    ['a number beginning 0 or 1', '1234 5678 9012'],
    ['an email address', 'ravi.kumar2026@shaktiprime.com'],
    ['a document number', 'SS/2026-27/000123'],
    ['a storage key', `1/quote_pdf/0190a1b2-c3d4-7e5f-8a9b-${AADHAAR}.pdf`],
    ['a bank account number of sixteen digits', '2345678901245678'],
    ['text without digits', 'Called, will visit on Monday.'],
  ])('keeps %s as it is', (_, text) => {
    expect(maskTypedIdentity(text)).toEqual({ text, masked: 0 });
  });
});

describe('masking a whole command input', () => {
  it('masks strings in objects and arrays at any depth and counts the numbers', () => {
    const input = {
      entityId: 1,
      body: `Aadhaar ${AADHAAR}`,
      contact: { name: 'Ramesh', notes: ['first visit', 'card 2345 6789 0124'] },
      lines: [{ remarks: { text: '2345-6789-0124' } }, { remarks: { text: 'none' } }],
    };
    const out = maskInputIdentity(input);
    expect(out.masked).toBe(3);
    expect(out.value).toEqual({
      entityId: 1,
      body: 'Aadhaar XXXXXXXX0124',
      contact: { name: 'Ramesh', notes: ['first visit', 'card XXXX XXXX 0124'] },
      lines: [{ remarks: { text: 'XXXX-XXXX-0124' } }, { remarks: { text: 'none' } }],
    });
    // The input itself is left as it came.
    expect(input.body).toBe(`Aadhaar ${AADHAAR}`);
  });

  it('passes numbers, booleans, dates, null and undefined through untouched', () => {
    const at = new Date('2026-11-09T10:00:00Z');
    const input = { n: Number(AADHAAR), b: true, at, none: null, gone: undefined, big: 12n };
    const out = maskInputIdentity(input);
    expect(out.masked).toBe(0);
    expect(out.value).toBe(input);
    expect(out.value.at).toBe(at);
    expect(maskInputIdentity(at).value).toBe(at);
    expect(maskInputIdentity(null).value).toBeNull();
  });

  it('returns what holds no Aadhaar number as it came', () => {
    const input = { a: { b: ['x', NOT_AADHAAR] }, c: '+919876543210' };
    const out = maskInputIdentity(input);
    expect(out.value).toBe(input);
    expect(out.value.a).toBe(input.a);
  });

  it('masks a string given alone', () => {
    expect(maskInputIdentity(AADHAAR)).toEqual({ value: 'XXXXXXXX0124', masked: 1 });
  });

  it('leaves the exempt fields whole, and everything under them, arrays passed through', () => {
    const input = {
      bankDetails: { accountNumber: AADHAAR, branch: `Branch ${AADHAAR}` },
      lines: [{ serial: AADHAAR, note: AADHAAR }],
      rows: [[AADHAAR], [AADHAAR]],
      bankDetailsNote: AADHAAR,
    };
    const out = maskInputIdentity(input, ['bankDetails.accountNumber', 'lines.serial', 'rows']);
    expect(out.value).toEqual({
      bankDetails: { accountNumber: AADHAAR, branch: 'Branch XXXXXXXX0124' },
      lines: [{ serial: AADHAAR, note: 'XXXXXXXX0124' }],
      rows: [[AADHAAR], [AADHAAR]],
      bankDetailsNote: 'XXXXXXXX0124',
    });
    expect(out.masked).toBe(3);
  });

  it('keeps a key named __proto__ an own key of the copy', () => {
    const input = JSON.parse(`{"__proto__": {"note": "${AADHAAR}"}, "x": "${AADHAAR}"}`) as Record<
      string,
      unknown
    >;
    const out = maskInputIdentity(input).value;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({
      note: 'XXXXXXXX0124',
    });
  });

  it('changes nothing the second time', () => {
    const once = maskInputIdentity({ a: [AADHAAR, { b: DEVANAGARI }] }).value;
    const twice = maskInputIdentity(once);
    expect(twice.value).toBe(once);
    expect(twice.masked).toBe(0);
  });
});
