// Text on its way to a language model: `@shakti/contracts/masking` (model-text.ts), shared with
// the voice worker, re-exported here so every caller in the domain reads it as before.
export {
  asciiDigits,
  labelUntrusted,
  maskForModel,
  MODEL_TEXT_LIMIT,
} from '@shakti/contracts/masking';
