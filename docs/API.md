# API — Shakti Prime BOS

Blueprint reference: §4, §10. The BOS has two entry surfaces: **server actions** for the web app and **`/api/v1`** for the field app, the Tally connector, the voice agent, website ingest, provider webhooks and workers. Both call the same domain commands. `docs/BLUEPRINT.md` governs on any conflict.

## 1. Conventions
| Concern | Rule |
|---|---|
| Base URL | `https://shaktiprime.com/api/v1` |
| Versioning | Path version. Breaking changes ship as `/api/v2` with `/api/v1` supported for 6 months; the field app's minimum-version gate enforces upgrades |
| Contracts | Every request and response schema lives in `packages/contracts` as Zod; route handlers parse with them and never hand-roll validation |
| Content type | `application/json; charset=utf-8`; file bytes never pass through the API (pre-signed S3 URLs) |
| IDs | UUIDv7 strings |
| Time | ISO 8601 UTC in payloads; the client renders IST |
| Money | Strings with two decimals (`"12345.50"`) to avoid float drift; currency always INR |
| Idempotency | `Idempotency-Key` header (UUID) required on every mutating call from the field app and the connector; keys are stored in `idempotency_keys` for 7 days (Redis in front) and replay the original response; a repeat with a different body answers `conflict` |
| Pagination | Cursor: `?cursor=<opaque>&limit=<1..200>`; responses carry `nextCursor` |
| Rate limits | Per token via Upstash Redis; `429` with `Retry-After`; defaults 600 req/min per user token, 60 req/min per ingest key |
| Errors | One envelope: `{ "error": { "code": "forbidden", "message": "…", "details": {...}, "requestId": "…" } }`; codes from `packages/contracts/errors` |
| Request ID | `X-Request-Id` accepted or generated; echoed in the response and logs |
| Localisation | Messages in error envelopes are English; `Accept-Language` is not negotiated |

### Error codes
`validation_failed` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409, state machine or idempotency conflict), `rate_limited` (429), `integration_unavailable` (503), `internal` (500).

## 2. Authentication
| Caller | Mechanism |
|---|---|
| Web app (server actions) | Better Auth session cookie (HttpOnly, Secure, SameSite=Lax) with CSRF origin checks; TOTP step-up for Executive, GM, Accounts |
| Field app | `POST /auth/mobile/token` exchanges credentials (+ TOTP where required) for a 15-minute access token and a refresh token bound to the device; refresh tokens rotate; per-device revocation |
| Voice agent | The BOS mints a 5-minute user-scoped token when a voice session starts; the worker sends it as `Authorization: Bearer` so every command runs as the speaking user |
| Tally connector | Per-connector key; every request carries `X-Connector-Id`, `X-Timestamp` and `X-Signature` (HMAC-SHA256 over method, path, timestamp and body); 5-minute clock skew window |
| Website ingest | Per-entity ingest key in `X-Ingest-Key` plus a Cloudflare Turnstile token in the body |
| Provider webhooks | Provider signature verification (Meta `X-Hub-Signature-256`, Exotel signature, Google Lead Form key) before any processing |
| Workers | QStash signature (`Upstash-Signature`) verified with the current and next signing keys |

Every authenticated call runs inside `withRequestContext()` with the caller's principal and entity scope.

## 3. Endpoint catalogue

### 3.1 Auth and session
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/mobile/token` | credentials | Issue access + refresh tokens for the field app |
| POST | `/auth/mobile/refresh` | refresh token | Rotate tokens |
| POST | `/auth/mobile/revoke` | bearer | Revoke this device |
| GET | `/me` | bearer | Principal, roles per entity, permissions, feature flags, minimum app version |
| POST | `/realtime/token` | session or bearer | BOS-signed ES256 JWT for Supabase Realtime (≤ 15 min) |
| POST | `/voice/session` | session (Executive, GM) | Create a voice session, return LiveKit room token and the user-scoped BOS token |

### 3.2 Field app sync
| Method | Path | Purpose |
|---|---|---|
| GET | `/sync/pull?since=<cursor>` | Engineer's schedule, jobs, checklists, surveys, reference data changed since the cursor; returns `nextCursor` |
| POST | `/sync/push` | Batch of commands `{ commands: [{ id, name, input, idempotencyKey, clientTime }] }`; applied in order; returns per-command result or conflict |
| POST | `/files/presign` | Pre-signed PUT for a photo, receipt or signature (`purpose`, `contentType`, `size`) |
| POST | `/files/:id/complete` | Marks the upload complete; triggers scan and masking |
| POST | `/attendance/check-in` | Geofenced or site check-in with selfie file ID |
| POST | `/expenses` | Create an expense claim with receipt file IDs |

### 3.3 Ingest (entity websites, partners)
| Method | Path | Purpose |
|---|---|---|
| POST | `/ingest/leads` | `{ entityCode, name, phone, pin?, segment?, message?, utm?, consent: { purpose, text, givenAt }, turnstileToken }` → lead created or attached; returns `leadId` |
| GET | `/ingest/health` | Key validity and rate-limit status |

### 3.4 Provider webhooks
| Method | Path | Provider | Notes |
|---|---|---|---|
| GET/POST | `/webhooks/meta/whatsapp` | Meta WhatsApp Cloud API | Verification handshake on GET; messages, statuses, template updates on POST |
| POST | `/webhooks/meta/leadgen` | Meta Lead Ads | Lead ID → fetched with the page token → normalised |
| POST | `/webhooks/google/leadform` | Google Lead Form | Key in payload |
| POST | `/webhooks/exotel/call-status` | Exotel | Call state, duration, recording URL |
| POST | `/webhooks/exotel/incoming` | Exotel | Inbound call → screen-pop event |
| POST | `/webhooks/livekit` | LiveKit | Room and participant events |

Pipeline for every webhook: verify signature → insert `webhook_inbox` (unique on provider event ID) → `200` within 2 s → QStash worker → commands. Duplicates and out-of-order events are handled by the worker using the provider event ID and timestamps.

### 3.5 Tally connector
| Method | Path | Purpose |
|---|---|---|
| POST | `/connector/tally/heartbeat` | `{ connectorVersion, tallyVersion, companies: [{ name, lastAlterId }] }`; a 30-minute silence raises an alert |
| POST | `/connector/tally/batches` | `{ company, entityCode, vouchers: [...], ledgers: [...], maxAlterId }` with `Idempotency-Key`; vouchers keyed by GUID; purchase vouchers stored restricted |
| POST | `/connector/tally/snapshot` | Daily `{ company, voucherGuids: [...], asOf }`; server computes tombstones |
| GET | `/connector/tally/cursor?company=` | Last accepted `alterId` per company so the connector can resume |
| GET | `/connector/release` | Latest signed release manifest for self-update |

### 3.6 Workers (QStash only)
`/workers/outbox/:type`, `/workers/messaging/send`, `/workers/files/scan`, `/workers/files/mask`, `/workers/pdf/render`, `/workers/imports/commit`, `/workers/agents/:agent`, `/workers/stt/transcribe`, `/workers/embeddings/index`, `/workers/notify`. Each verifies the QStash signature, checks the event ID in Redis, runs the command and returns `200` on success or a retryable `5xx`.

### 3.7 Operations
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness |
| GET | `/health/ready` | none | DB check today; Redis and QStash join in week 3 |
| GET | `/admin/integrations` | session (admin.integrations.write) | Integration Health: webhook inbox stats, DLQ, connector heartbeat, WhatsApp quality and tier, AI spend |
| POST | `/admin/integrations/replay` | session | Replay a dead-lettered event |

## 4. Server actions (web)
- Live in `apps/web/src/actions/<module>.ts`, one exported function per command, each a thin wrapper: parse input with the contract → `withRequestContext()` → command → return DTO.
- No business logic in actions. No direct database access in components.
- Reads for pages use the same context helper through typed query functions in `apps/web/src/queries`.

## 5. Contracts
`packages/contracts` layout:
```
src/
  commands/<module>/<command>.ts   input + output schemas, named after the command
  dto/                             shared DTOs (never include restricted fields unless suffixed `WithCost`)
  events/                          outbox event names and payloads
  api/                             route request/response schemas for /api/v1
  errors.ts                        error codes
```
Example:
```ts
export const ConfirmSalesOrderInput = z.object({
  salesOrderId: z.string().uuid(),
  creditReleaseReason: z.string().min(10).optional(),
});
export const SalesOrderDto = z.object({
  id: z.string().uuid(), soNo: z.string(), state: SalesOrderState,
  accountId: z.string().uuid(), lines: z.array(SalesOrderLineDto), totals: MoneyTotals,
});
```

## 6. Messaging contracts (outbound WhatsApp)
Commands never call Meta directly. They emit `message.requested` with `{ threadId, kind: 'template' | 'session', templateName?, params?, bodyMasked?, fileId? }`. The messaging worker enforces: opt-out, 24-hour window for session messages, template approval status, portfolio tier budget (service messages first), deterministic output filter, per-conversation rate limit; then sends and records `provider_message_id`. Status webhooks update `whatsapp_messages.status`.

## 7. Compatibility and deprecation
- Additive changes (new optional fields, new endpoints) ship without a version bump.
- Removing or changing a field requires `/api/v2` and a deprecation notice in the `Deprecation` and `Sunset` headers on `/api/v1` responses for 6 months.
- Contract tests with recorded payloads for Meta, Exotel, Google and Tally run in CI; a provider payload change that breaks parsing fails the build, not production.
