import { createHash, randomBytes } from 'node:crypto';

/**
 * A Tally connector's key (docs/03-roadmap-appendix/phase5.md §6.3, docs/06-api.md §3.5): 32
 * random bytes in base64url, made on the server when an Executive registers or rotates a
 * connector, shown once and never kept, logged or audited. The BOS keeps only its SHA-256
 * (`tally_connectors.key_hash`, lower-case hexadecimal) and its last four characters.
 *
 * The connector signs every call with HMAC-SHA256 keyed by that same SHA-256 in hexadecimal
 * (`connectorSigningKey()`), so the BOS verifies a signature from the hash it holds and the key
 * itself exists only in the connector's encrypted settings.
 */

const KEY_BYTES = 32;

/** The SHA-256 of a key in lower-case hexadecimal: what the BOS stores and the HMAC key. */
export function connectorSigningKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A new key, its hash and its last four characters. */
export function newConnectorKey(): { key: string; keyHash: string; keyHint: string } {
  const key = randomBytes(KEY_BYTES).toString('base64url');
  return { key, keyHash: connectorSigningKey(key), keyHint: key.slice(-4) };
}
