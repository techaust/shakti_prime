// How personal numbers are found in text: `@shakti/contracts/masking` (number-shapes.ts), shared
// with the voice worker, re-exported here so every caller in the domain reads it as before.
export {
  ALONE_AFTER,
  ALONE_BEFORE,
  asciiDigits,
  DIGIT_RUN,
  findPersonalNumbers,
  isPhone,
  lastFourOnly,
  normalise,
  pass,
  replaceNumbers,
  SEP,
  setAsideIds,
  setAsideSafeShapes,
  whole,
  type FoundNumber,
  type Normalised,
  type Span,
} from '@shakti/contracts/masking';
