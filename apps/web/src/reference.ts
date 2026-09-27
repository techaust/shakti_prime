/** Letters and digits that cannot be misread for one another when read out on the phone. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_LENGTH = 6;

/**
 * The reference for an error Next.js reports by digest (DESIGN.md §11), for example `8F3K2Q`.
 * The error screen shows it and `onRequestError` logs it; both derive it from the same digest,
 * in the browser and on the server alike, so support finds the log line from what the screen
 * shows. Plain arithmetic (FNV-1a), no platform crypto, so it runs in both places.
 */
export function referenceFromDigest(digest: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < digest.length; i += 1) {
    hash ^= digest.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    hash = Math.imul(hash ^ (i + 1), 0x01000193) >>> 0;
    out += REFERENCE_ALPHABET.charAt(hash % REFERENCE_ALPHABET.length);
  }
  return out;
}
