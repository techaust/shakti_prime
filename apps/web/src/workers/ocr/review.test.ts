import { describe, expect, it } from 'vitest';
import { reviewCause, type ReviewInput } from './review';

const base: ReviewInput = {
  expect: [],
  readText: 'Quotation for a solar pump set',
  aadhaarFound: false,
  bankFound: false,
  qrUncovered: 0,
};

describe('reviewCause', () => {
  it('keeps a photo of unknown kind with nothing to hide', () => {
    expect(reviewCause(base)).toBeUndefined();
  });

  it('holds an Aadhaar slot upload whose number was not found', () => {
    expect(reviewCause({ ...base, expect: ['aadhaar'] })).toBe('number_not_found');
  });

  it('holds a photo that reads like an Aadhaar card when no number was found', () => {
    expect(reviewCause({ ...base, readText: 'Government of India\nAadhaar' })).toBe(
      'number_not_found',
    );
  });

  it('holds a passbook slot upload whose account number was not found', () => {
    expect(reviewCause({ ...base, expect: ['bank_account'] })).toBe('number_not_found');
  });

  it('holds an Aadhaar upload with a QR-like mark that could not be covered', () => {
    expect(reviewCause({ ...base, expect: ['aadhaar'], aadhaarFound: true, qrUncovered: 1 })).toBe(
      'qr_not_covered',
    );
    expect(reviewCause({ ...base, readText: 'Aadhaar', aadhaarFound: true, qrUncovered: 2 })).toBe(
      'qr_not_covered',
    );
  });

  it('holds a photo of unknown kind with an Aadhaar number and an uncovered QR-like mark', () => {
    expect(reviewCause({ ...base, aadhaarFound: true, qrUncovered: 1 })).toBe('qr_not_covered');
  });

  it('keeps an Aadhaar upload whose number and QR codes were all covered', () => {
    expect(
      reviewCause({ ...base, expect: ['aadhaar'], aadhaarFound: true, qrUncovered: 0 }),
    ).toBeUndefined();
  });

  it('keeps a photo that does not read as Aadhaar even with a stray QR-like mark', () => {
    expect(reviewCause({ ...base, qrUncovered: 1 })).toBeUndefined();
  });
});
