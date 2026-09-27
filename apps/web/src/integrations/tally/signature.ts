import {
  API_HEADERS,
  CONNECTOR_CLOCK_SKEW_SECONDS,
  ConnectorHeaders,
  connectorSigningString,
  isConnectorTimestampFresh,
} from '@shakti/contracts';
import { createHash } from 'node:crypto';
import { hmacSha256Hex, safeEqual } from '../http';

/**
 * Request signing between the Tally connector and the BOS (docs/API.md §2 and §3.5, SECURITY §2).
 * Every call carries `X-Connector-Id` (a UUID), `X-Timestamp` (Unix seconds, ten digits) and
 * `X-Signature` (the lowercase hex HMAC-SHA256 under the connector's key) over the string the
 * published connector contract builds with `connectorSigningString()`:
 *
 *     METHOD \n PATH-WITH-QUERY \n TIMESTAMP \n hex(SHA-256(raw body))
 *
 * A timestamp more than five minutes from the BOS clock is refused (`isConnectorTimestampFresh()`),
 * so a captured request cannot be replayed later; within the window, the `Idempotency-Key` on every
 * batch makes a replay a no-op. A connector may hold two keys during a rotation; either verifies.
 */

export const CONNECTOR_SKEW_SECONDS = CONNECTOR_CLOCK_SKEW_SECONDS;

export const CONNECTOR_HEADERS = {
  id: API_HEADERS.connectorId,
  timestamp: API_HEADERS.timestamp,
  signature: API_HEADERS.signature,
} as const;

export function canonicalRequest(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  body: string | Uint8Array,
): string {
  return connectorSigningString({
    method,
    pathWithQuery,
    timestamp,
    bodySha256Hex: createHash('sha256').update(body).digest('hex'),
  });
}

/** What the connector sends in `X-Signature`. */
export function signConnectorRequest(
  key: string,
  method: string,
  pathWithQuery: string,
  timestamp: string,
  body: string | Uint8Array,
): string {
  return hmacSha256Hex(key, canonicalRequest(method, pathWithQuery, timestamp, body));
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
  const headers = ConnectorHeaders.safeParse({
    [CONNECTOR_HEADERS.id]: request.headers.get(CONNECTOR_HEADERS.id) ?? undefined,
    [CONNECTOR_HEADERS.timestamp]: request.headers.get(CONNECTOR_HEADERS.timestamp) ?? undefined,
    [CONNECTOR_HEADERS.signature]: request.headers.get(CONNECTOR_HEADERS.signature) ?? undefined,
  });
  if (!headers.success) return { ok: false, problem: 'missing_headers' };
  const {
    [CONNECTOR_HEADERS.id]: connectorId,
    [CONNECTOR_HEADERS.timestamp]: timestamp,
    [CONNECTOR_HEADERS.signature]: signature,
  } = headers.data;
  const keys = keysFor(connectorId).filter((k) => k !== '');
  if (keys.length === 0) return { ok: false, problem: 'unknown_connector' };
  if (!isConnectorTimestampFresh(timestamp, Math.floor(now.getTime() / 1000))) {
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
