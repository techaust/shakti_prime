import { describe, expect, it } from 'vitest';
import { findIdentityNumbers, isAadhaarNumber, maskIdentityNumbers } from './identity-numbers';
import { verhoeffCheckDigit, verhoeffValid } from './verhoeff';

// Every number here is generated with a correct or a deliberately wrong check digit. None is a
// real Aadhaar or bank account number.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function madeUpAadhaar(random: () => number): string {
  let body = String(2 + Math.floor(random() * 8));
  while (body.length < 11) body += String(Math.floor(random() * 10));
  return body + verhoeffCheckDigit(body);
}

function withWrongCheckDigit(valid: string): string {
  const last = Number(valid.charAt(11));
  return valid.slice(0, 11) + String((last + 1) % 10);
}

const spaced = (d: string) => `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;

describe('isAadhaarNumber', () => {
  it('accepts a twelve-digit number with a correct check digit', () => {
    const random = seeded(1);
    for (let i = 0; i < 50; i++) expect(isAadhaarNumber(madeUpAadhaar(random))).toBe(true);
  });

  it('refuses a wrong check digit, a leading 0 or 1, and the wrong length', () => {
    const random = seeded(2);
    const valid = madeUpAadhaar(random);
    expect(isAadhaarNumber(withWrongCheckDigit(valid))).toBe(false);
    const leadingOne = `1${valid.slice(1, 11)}`;
    expect(isAadhaarNumber(leadingOne + verhoeffCheckDigit(leadingOne))).toBe(false);
    expect(isAadhaarNumber(valid.slice(1))).toBe(false);
  });
});

describe('maskIdentityNumbers', () => {
  const random = seeded(42);

  it('hides the first eight digits of a spaced Aadhaar number and keeps the last four', () => {
    const number = madeUpAadhaar(random);
    const out = maskIdentityNumbers(`Aadhaar No: ${spaced(number)}\nDOB: 04-11-1987`);
    expect(out.text).toBe(`Aadhaar No: XXXX XXXX ${number.slice(8)}\nDOB: 04-11-1987`);
    expect(out.aadhaarLastFour).toEqual([number.slice(8)]);
    expect(out.counts.aadhaar).toBe(1);
    expect(out.text).not.toContain(number.slice(0, 8));
  });

  it('masks the unspaced and hyphenated layouts', () => {
    const a = madeUpAadhaar(random);
    const b = madeUpAadhaar(random);
    const hyphen = `${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8)}`;
    const out = maskIdentityNumbers(`number ${a} and ${hyphen}`);
    expect(out.text).toBe(`number XXXXXXXX${a.slice(8)} and XXXX-XXXX-${b.slice(8)}`);
    expect(out.aadhaarLastFour).toEqual([a.slice(8), b.slice(8)]);
  });

  it('masks a spaced number whose check digit fails, so a misread digit leaks nothing', () => {
    const misread = withWrongCheckDigit(madeUpAadhaar(random));
    expect(verhoeffValid(misread)).toBe(false);
    const out = maskIdentityNumbers(spaced(misread));
    expect(out.text).toBe(`XXXX XXXX ${misread.slice(8)}`);
    expect(out.counts.aadhaar_unverified).toBe(1);
    expect(out.counts.aadhaar).toBe(0);
  });

  it('leaves other twelve-digit numbers, phone numbers and dates alone', () => {
    const consumer = withWrongCheckDigit(madeUpAadhaar(random));
    const text = `Consumer number ${consumer}\nMobile 98290 41736\nBill date 12-08-2026`;
    const out = maskIdentityNumbers(text);
    expect(out.text).toBe(text);
    expect(out.aadhaarLastFour).toEqual([]);
  });

  it('does not take twelve digits out of a longer run or a sixteen-digit Virtual ID', () => {
    const number = madeUpAadhaar(random);
    const longer = `Ref ${number}7`;
    const vid = `VID ${spaced(number)} 4821`;
    expect(maskIdentityNumbers(longer).text).toBe(longer);
    expect(maskIdentityNumbers(vid).text).toBe(vid);
  });

  it('masks a bank account number next to an account label, on the same or the next line', () => {
    const out = maskIdentityNumbers(
      'Savings A/c No: 50100234871936\nAccount Number\n3847261950\nMobile 9829041736',
    );
    expect(out.text).toBe(
      'Savings A/c No: XXXXXXXXXX1936\nAccount Number\nXXXXXX1950\nMobile 9829041736',
    );
    expect(out.bankAccountLastFour).toEqual(['1936', '1950']);
    expect(out.counts.bank_account).toBe(2);
  });

  it('does not treat a long number as a bank account without a label', () => {
    const text = 'Invoice 202608150012345';
    expect(maskIdentityNumbers(text).text).toBe(text);
  });

  it('reports an Aadhaar number on an account line as Aadhaar, not twice', () => {
    const number = madeUpAadhaar(random);
    const spans = findIdentityNumbers(`Account holder Aadhaar ${number}`);
    expect(spans.map((s) => s.kind)).toEqual(['aadhaar']);
  });
});
