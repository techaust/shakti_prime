/**
 * ADR 0014: no Devanagari in the product's own text, and transcripts in Roman script. The speech
 * adapters refuse a vendor's transcript that is not in Roman script (`apps/web/src/integrations/
 * voice/roman-script.ts`), and a person's correction of a vault transcript is held to the same rule.
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
