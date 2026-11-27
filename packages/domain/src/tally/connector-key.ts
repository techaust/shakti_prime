import { randomBytes } from 'node:crypto';
import type { CipherContext, FieldCipher, FieldEnvelope } from '../privacy/field-cipher';

/**
 * A Tally connector's key (docs/03-roadmap-appendix/phase5.md §6.3, docs/06-api.md §3.5): 32
 * random bytes in base64url, made on the server when an Executive registers or rotates a
 * connector, shown once, and signed with as it is (HMAC-SHA256). The BOS keeps it only sealed by
 * the field cipher (KMS on a hosted environment, as a company's bank account is), in
 * `tally_connectors.key_sealed` and, during a rotation, `next_key_sealed`; it is never logged,
 * audited or answered again. Its last four characters tell keys apart on screen.
 */

const KEY_BYTES = 32;

/** A new key and its last four characters. */
export function newConnectorKey(): { key: string; keyHint: string } {
  const key = randomBytes(KEY_BYTES).toString('base64url');
  return { key, keyHint: key.slice(-4) };
}

/**
 * Where a connector's keys are sealed. A connector belongs to no company (it may serve several),
 * so its company in the seal is 0; the row is its own, so a sealed key copied to another connector
 * does not open there. Both of a connector's keys share one context, because retiring the old key
 * moves the next one into `key_sealed` as it was sealed.
 */
export function connectorKeyContext(connectorId: string): CipherContext {
  return { table: 'tally_connectors', column: 'key', entityId: 0, rowId: connectorId };
}

/** Seals a key for its connector's row. */
export function sealConnectorKey(
  cipher: FieldCipher,
  connectorId: string,
  key: string,
): Promise<FieldEnvelope> {
  return cipher.encrypt(key, connectorKeyContext(connectorId));
}

/** Opens a connector's sealed keys, current first; throws when one was altered or moved. */
export function openConnectorKeys(
  cipher: FieldCipher,
  connectorId: string,
  sealed: readonly FieldEnvelope[],
): Promise<string[]> {
  return Promise.all(sealed.map((s) => cipher.decrypt(s, connectorKeyContext(connectorId))));
}
