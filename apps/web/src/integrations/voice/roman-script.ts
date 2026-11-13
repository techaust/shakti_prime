import { ProviderError, type ProviderName } from '../http';

/**
 * ADR 0014: no Devanagari in the product's own text, and transcripts in Roman script. A speech
 * vendor asked for Roman script (Sarvam's `translit` mode) can still answer a word in Devanagari,
 * or in another Indian script; the adapter refuses such a text, so nothing past the adapter ever
 * holds it. The error names no text.
 */

/**
 * Any character used in Devanagari, the shared danda included: the copy lint's
 * `\p{Script=Devanagari}` widened to the script's extensions.
 */
export const DEVANAGARI = /\p{Script_Extensions=Devanagari}/u;

/**
 * A letter, mark or digit of any script but Latin and the shared ones (Common, Inherited): Gurmukhi,
 * Gujarati, Urdu and the rest.
 */
const OTHER_SCRIPT =
  /(?=[\p{L}\p{M}\p{N}])[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

/** Roman script: Latin letters, digits, marks and punctuation, and nothing of Devanagari. */
export function isRomanScript(text: string): boolean {
  return !hasDevanagari(text) && !OTHER_SCRIPT.test(text);
}

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
