import { createHash } from 'node:crypto';
import { hmacSha256Hex, safeEqual } from '../http';

/**
 * Request signing between the Tally connector and the BOS (docs/API.md §2 and §3.5, SECURITY §2).
 * Every call carries `X-Connector-Id`, `X-Timestamp` (Unix seconds) and `X-Signature`
 * (`v1=` and the lowercase hex HMAC-SHA256 under the connector's key) over the canonical string:
 *
 *     METHOD \n PATH-WITH-QUERY \n TIMESTAMP \n hex(SHA-256(raw body))
 *
 * A timestamp more than five minutes from the BOS clock is refused, so a captured request cannot be
 * replayed later; within the window, the `Idempotency-Key` on every batch makes a replay a no-op.
 * A connector may hold two keys during a rotation; either verifies.
 */

export const CONNECTOR_SKEW_SECONDS = 300;
export const SIGNATURE_VERSION = 'v1';

export const CONNECTOR_HEADERS = {
  id: 'x-connector-id',
  timestamp: 'x-timestamp',
  signature: 'x-signature',
} as const;

export function canonicalRequest(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  body: string | Uint8Array,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${bodyHash}`;
}

/** What the connector sends in `X-Signature`. */
export function signConnectorRequest(
  key: string,
  method: string,
  pathWithQuery: string,
  timestamp: string,
  body: string | Uint8Array,
): string {
  return `${SIGNATURE_VERSION}=${hmacSha256Hex(key, canonicalRequest(method, pathWithQuery, timestamp, body))}`;
}

export type ConnectorAuth =
  | { ok: true; connectorId: string }
  | {
      ok: false;
      problem: 'missing_headers' | 'unknown_connector' | 'stale_timestamp' | 'bad_signature';
    };

export interface SignedRequest {
  method: string;
  /** Path and query exactly as requested, for example `/api/v1/connector/tally/cursor?company=A`. */
  pathWithQuery: string;
  headers: Headers;
  body: string | Uint8Array;
}

/**
 * Verifies a connector call. `keysFor` answers the connector's current key, and its next one during
 * a rotation, or nothing for an unknown or disabled connector.
 */
export function verifyConnectorRequest(
  request: SignedRequest,
  keysFor: (connectorId: string) => readonly string[],
  now: Date,
): ConnectorAuth {
  const connectorId = request.headers.get(CONNECTOR_HEADERS.id) ?? '';
  const timestamp = request.headers.get(CONNECTOR_HEADERS.timestamp) ?? '';
  const signature = request.headers.get(CONNECTOR_HEADERS.signature) ?? '';
  if (connectorId === '' || !/^\d{9,11}$/.test(timestamp) || signature === '') {
    return { ok: false, problem: 'missing_headers' };
  }
  const keys = keysFor(connectorId).filter((k) => k !== '');
  if (keys.length === 0) return { ok: false, problem: 'unknown_connector' };
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > CONNECTOR_SKEW_SECONDS) {
    return { ok: false, problem: 'stale_timestamp' };
  }
  // Every key is tried so the time taken does not tell which one matched.
  let matched = false;
  for (const key of keys) {
    const expected = signConnectorRequest(
      key,
      request.method,
      request.pathWithQuery,
      timestamp,
      request.body,
    );
    if (safeEqual(signature, expected)) matched = true;
  }
  return matched ? { ok: true, connectorId } : { ok: false, problem: 'bad_signature' };
}
