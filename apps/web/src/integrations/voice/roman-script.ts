import { isRomanScript } from '@shakti/contracts';
import { ProviderError, type ProviderName } from '../http';

/**
 * ADR 0014: no Devanagari in the product's own text, and transcripts in Roman script. A speech
 * vendor asked for Roman script (Sarvam's `translit` mode) can still answer a word in Devanagari,
 * or in another Indian script; the adapter refuses such a text, so nothing past the adapter ever
 * holds it. The error names no text. The test itself lives in `@shakti/contracts`, where a person's
 * correction of a vault transcript is held to it too (K3).
 */

export { DEVANAGARI, hasDevanagari, isRomanScript } from '@shakti/contracts';

/** Answers `text` when it is in Roman script; otherwise throws `invalid_response`, naming no text. */
export function romanOnly(provider: ProviderName, text: string, status = 200): string {
  if (!isRomanScript(text)) {
    throw new ProviderError(provider, 'invalid_response', {
      status,
      vendorCode: 'not_roman_script',
    });
  }
  return text;
}
