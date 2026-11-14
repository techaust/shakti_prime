import { createHash, randomBytes } from 'node:crypto';

/**
 * Website ingest keys (docs/06-api.md §3.3): 32 random bytes, written in base64url so a website
 * can send the key in `X-Ingest-Key` as it is. Only the key's SHA-256 is stored
 * (`ingest_keys.key_hash`), with its last four characters to tell keys apart; the key itself is
 * shown to the Executive once, when it is made, and never kept, logged or audited.
 */

const KEY_BYTES = 32;

/** The SHA-256 of a key in lower-case hexadecimal, as `ingest_keys.key_hash` keeps it. */
export function hashIngestKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A new key, its hash and its last four characters. */
export function newIngestKey(): { key: string; keyHash: string; keyHint: string } {
  const key = randomBytes(KEY_BYTES).toString('base64url');
  return { key, keyHash: hashIngestKey(key), keyHint: key.slice(-4) };
}
