import { API_HEADERS, connectorSigningString } from '@shakti/contracts';
import { createHash, createHmac } from 'node:crypto';

/**
 * Signs a call to the BOS as `apps/web/src/integrations/tally/signature.ts` verifies it (docs/06-api.md
 * §2, §3.5): HMAC-SHA256 under the connector's key, lowercase hex, over the contract's
 * `connectorSigningString()` of the method, the path with its query, the Unix-seconds timestamp and
 * the SHA-256 of the exact body bytes sent.
 */
export function signRequest(
  key: string,
  request: { method: string; pathWithQuery: string; timestamp: string; body: string },
): string {
  const signingString = connectorSigningString({
    method: request.method,
    pathWithQuery: request.pathWithQuery,
    timestamp: request.timestamp,
    bodySha256Hex: createHash('sha256').update(request.body, 'utf8').digest('hex'),
  });
  return createHmac('sha256', key).update(signingString, 'utf8').digest('hex');
}

/** The three signing headers, with the time as ten-digit Unix seconds. */
export function signedHeaders(
  connectorId: string,
  key: string,
  request: { method: string; pathWithQuery: string; body: string },
  now: Date,
): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    [API_HEADERS.connectorId]: connectorId,
    [API_HEADERS.timestamp]: timestamp,
    [API_HEADERS.signature]: signRequest(key, { ...request, timestamp }),
  };
}
