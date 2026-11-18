import { createHmac, timingSafeEqual } from 'node:crypto';

// The vendor wrappers' plumbing lives in `@shakti/voice`, shared with the voice worker; the web
// app's wrappers keep importing it from here, beside the signature helpers only the web app uses.
export {
  asArray,
  asNumber,
  asObject,
  asString,
  at,
  defaultHttpDeps,
  jsonBody,
  ProviderError,
  providerFetch,
  type HttpDeps,
  type JsonObject,
  type ProviderFailure,
  type ProviderName,
} from '@shakti/voice';

/** HMAC-SHA256 as lowercase hex. */
export function hmacSha256Hex(secret: string, data: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Compares two strings in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
