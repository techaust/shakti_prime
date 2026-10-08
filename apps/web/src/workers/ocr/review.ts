// When a masked photo must go back to a person instead of being kept (docs/04-architecture-appendix/ocr.md). Pure,
// so the rule is tested without the OCR engine.

export type ExpectedNumber = 'aadhaar' | 'bank_account';

/**
 * Why nothing can be kept: `number_not_found` when the photo reads like an Aadhaar card (or the
 * slot expects a number) and the number was not located; `qr_not_covered` when an Aadhaar photo
 * shows a QR-like mark that could not be located well enough to cover.
 */
export type ReviewCause = 'number_not_found' | 'qr_not_covered';

// Words that mark a photo as an Aadhaar card or letter, including the ways a blurred photo
// is misread ("Aadhasr", "Andhaer", "Government of Indie").
export const AADHAAR_HINTS =
  /\b(?:aadh|adhaa|andha[ae])[a-z]*|uidai|unique\s+identif|gov[a-z]*\s+of\s+ind|\bvid\b|enrolment/i;

export interface ReviewInput {
  /** The numbers the upload slot says the document carries. */
  expect: readonly ExpectedNumber[];
  /** Everything the OCR read, in memory only. */
  readText: string;
  aadhaarFound: boolean;
  bankFound: boolean;
  /** Finder marks of a QR code left uncovered by the QR scan. */
  qrUncovered: number;
}

export function reviewCause(input: ReviewInput): ReviewCause | undefined {
  const aadhaar = input.expect.includes('aadhaar') || AADHAAR_HINTS.test(input.readText);
  if (aadhaar && !input.aadhaarFound) return 'number_not_found';
  if (input.expect.includes('bank_account') && !input.bankFound) return 'number_not_found';
  // An Aadhaar card or letter whose QR code (which can hold the full number) cannot be covered
  // with confidence is not kept, whatever the code holds. A photo on which an Aadhaar number
  // was found counts as one even when its words were not read.
  if ((aadhaar || input.aadhaarFound) && input.qrUncovered > 0) return 'qr_not_covered';
  return undefined;
}
