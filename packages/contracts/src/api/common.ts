import { z } from 'zod';

/**
 * Pieces shared by the `/api/v1` contracts (docs/API.md §1): headers, pagination, versions and
 * the token shapes the BOS itself signs.
 */

/** Headers the API reads or writes, lower-cased as the Fetch API reports them. */
export const API_HEADERS = {
  requestId: 'x-request-id',
  idempotencyKey: 'idempotency-key',
  appVersion: 'x-app-version',
  ingestKey: 'x-ingest-key',
  connectorId: 'x-connector-id',
  timestamp: 'x-timestamp',
  signature: 'x-signature',
  retryAfter: 'retry-after',
} as const;

/**
 * `details.reason` values the `/api/v1` routes give beside an error code (docs/API.md §3), for the
 * callers that act on them: the field app's update gate and conflict screen, the connector's
 * re-read, the website form, the Integration Health page's replay. The mobile sign-in reasons are
 * `MOBILE_AUTH_REASONS`.
 */
export const API_ERROR_REASONS = [
  'app_update_required',
  'voice_cap_reached',
  'cursor_expired',
  'file_type_not_allowed',
  'file_too_large',
  'files_unavailable',
  'file_missing',
  'file_upload_mismatch',
  'turnstile_failed',
  'cursor_mismatch',
  'idempotency_mismatch',
  'not_dead_lettered',
] as const;
export const ApiErrorReasonSchema = z.enum(API_ERROR_REASONS);
export type ApiErrorReason = z.infer<typeof ApiErrorReasonSchema>;

/** `?cursor=<opaque>&limit=<1..200>` on every list (docs/API.md §1). */
export const CursorSchema = z.string().min(1).max(512);
export const PageLimitSchema = z.coerce.number().int().min(1).max(200).default(50);

export const PageQuery = z
  .object({
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema,
  })
  .strict();
export type PageQuery = z.infer<typeof PageQuery>;

/** Semantic version of the field app, the connector or a release: `major.minor.patch`. */
export const SemverSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/);
export type Semver = z.infer<typeof SemverSchema>;

/** Compares two versions numerically; negative when `a` is older than `b`. */
export function compareSemver(a: Semver, b: Semver): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * What every provider webhook answers once the payload is stored in `webhook_inbox`, within 2 s
 * and before any processing (docs/API.md §3.4). A duplicate delivery gets the same answer.
 */
export const WebhookAck = z.object({ received: z.literal(true) }).strict();
export type WebhookAck = z.infer<typeof WebhookAck>;

/** A calendar date as the payload carries it (`YYYY-MM-DD`, read in IST). */
export const DateOnlySchema = z.iso.date();

/** Latitude and longitude from the device, with the fix's accuracy radius. */
export const GeoPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(10_000),
  })
  .strict();
export type GeoPoint = z.infer<typeof GeoPointSchema>;

/**
 * A JWT the BOS signs with its ES256 key pair (ADR 0003). The claims are checked by the verifier;
 * this only fixes the compact form and the algorithm in the header.
 */
export const BosJwtSchema = z.jwt({ alg: 'ES256' });

/**
 * The `aud` of every token the BOS signs. Each surface accepts only its own audience, so a token
 * minted for one purpose is refused everywhere else (ADR 0003).
 */
export const TOKEN_AUDIENCES = {
  realtime: 'shakti-realtime',
  mobile: 'shakti-mobile',
  voice: 'shakti-voice',
} as const;

/** Lifetimes in seconds (docs/API.md §2, docs/SECURITY.md §2). */
export const TOKEN_LIFETIMES = {
  realtimeMax: 15 * 60,
  mobileAccess: 15 * 60,
  mobileRefresh: 30 * 24 * 60 * 60,
  voice: 5 * 60,
} as const;

/** Standard claims shared by the BOS tokens. `iat` and `exp` are Unix seconds. */
export const BaseClaims = z.object({
  iss: z.url(),
  sub: z.uuidv7(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.uuid().optional(),
});

/** The rule that a token lives no longer than `maxSeconds` from its issue time. */
export function expiresWithin(
  maxSeconds: number,
): [(claims: { iat: number; exp: number }) => boolean, { message: string; path: string[] }] {
  return [
    (claims) => claims.exp > claims.iat && claims.exp - claims.iat <= maxSeconds,
    { message: `the token must expire within ${String(maxSeconds)} seconds`, path: ['exp'] },
  ];
}
