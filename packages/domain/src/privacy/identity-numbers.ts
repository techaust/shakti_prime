// Aadhaar and bank account numbers in text: `@shakti/contracts/masking` (identity-numbers.ts),
// shared with the voice worker, re-exported here so every caller in the domain reads it as before.
export {
  AADHAAR_VISIBLE_FROM,
  findIdentityNumbers,
  isAadhaarNumber,
  maskedDigitIndices,
  maskIdentityNumbers,
  maskLine,
  normalizeOcrDigits,
  summarizeSpans,
  type IdentityNumberKind,
  type IdentityNumberSpan,
  type LineMask,
  type MaskedText,
} from '@shakti/contracts/masking';
