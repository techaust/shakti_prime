import { ProviderError, type ProviderName } from '../http';

/**
 * ADR 0014: no Devanagari in the product's own text. A speech vendor asked for Roman script (Sarvam's
 * `translit` mode) can still answer a word in Devanagari; the adapter refuses such a transcript, so
 * nothing past the adapter ever holds it. The error names no text.
 */

/**
 * Any character used in Devanagari, the shared danda included: the copy lint's
 * `\p{Script=Devanagari}` widened to the script's extensions.
 */
export const DEVANAGARI = /\p{Script_Extensions=Devanagari}/u;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

/** Answers `text` when it holds no Devanagari; otherwise throws `invalid_response`. */
export function romanOnly(provider: ProviderName, text: string, status = 200): string {
  if (hasDevanagari(text)) {
    throw new ProviderError(provider, 'invalid_response', {
      status,
      vendorCode: 'not_roman_script',
    });
  }
  return text;
}
