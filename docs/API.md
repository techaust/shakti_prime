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
| Idempotency | `Idempotency-Key` header (UUID) required on every mutating call from the field app and the connector; keys are stored in `idempotency_keys` for 7 days (Redis in front from the mobile API onwards) and replay the original response; a repeat with a different body answers `conflict` (reason `idempotency_mismatch`); a call that failed stores no key, so its retry runs again |
| Pagination | Cursor: `?cursor=<opaque>&limit=<1..200>`; responses carry `nextCursor` |
| Rate limits | Per token via Upstash Redis; `429` with `Retry-After`; defaults 600 req/min per user token, 60 req/min per ingest key |
| Errors | One envelope: `{ "error": { "code": "forbidden", "message": "…", "details": {...}, "requestId": "…" } }`; codes from `packages/contracts/errors` |
| Request ID | One rule for every route, server action, auth event and error log line (`apps/web/src/request-id.ts`): Vercel's `x-vercel-id` when present (a new id when it is not safe to echo), else the caller's `X-Request-Id` when it matches `[\w.:-]{1,128}` (QStash, a monitor, a local run), else a new id, so on a hosted deployment a caller cannot choose the id an audit row or a log line carries; echoed in the response and the logs |
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
| Provider webhooks | Provider signature verification before any processing: Meta `X-Hub-Signature-256`, the Google Lead Form key, and for Exotel, which sends no signature header, a StatusCallback address per call that carries the BOS call id, an expiry and an HMAC-SHA256 of both under `EXOTEL_CALLBACK_SECRET` (`apps/web/src/integrations/exotel/status-callback.ts`) |
| Workers | QStash signature (`Upstash-Signature`) verified with the current and next signing keys |

Every authenticated call runs inside `withRequestContext()` with the caller's principal and entity scope.

## 3. Endpoint catalogue
Every route below is an entry of `API_ENDPOINTS` in `packages/contracts/src/api/endpoints.ts`, which names its request, query and response schemas and its error codes; schema files are under `packages/contracts/src/api/`. `packages/contracts/src/api/fixtures.ts` holds a recorded example for each route, and `endpoints.test.ts` fails when a route here and the catalogue differ. Every authenticated route can also answer `rate_limited` (429 with `Retry-After`) and `internal`; the Errors column lists the rest, with `details.reason` where the caller acts on it.

### 3.1 Auth and session
| Method | Path | Auth | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/auth/mobile/token` | credentials | Issue access + refresh tokens for the field app | `mobile-auth.ts`: `MobileTokenRequest` (email, password, `totpCode?` or `backupCode?`, `device`) | `MobileTokenResponse`: `{ tokenType, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, userId }`; access claims `MobileAccessClaims` (`aud: shakti-mobile`, `sid` = device, `bos_role`, ≤ 15 min) | `validation_failed`; `unauthorized` (`invalid_credentials`, `totp_required`, `totp_invalid`, `account_locked`); `forbidden` (`account_suspended`, `app_update_required`) |
| POST | `/auth/mobile/refresh` | refresh token | Rotate tokens | `MobileRefreshRequest` (`refreshToken`, `deviceId`, `appVersion`) | `MobileRefreshResponse` (the same pair, both tokens new) | `validation_failed`; `unauthorized` (`refresh_expired`, `refresh_reused` revokes the family, `device_revoked`); `forbidden` (`app_update_required`) |
| POST | `/auth/mobile/revoke` | bearer | Revoke this device | `MobileRevokeRequest` (empty) | `MobileRevokeResponse`: `{ revoked: true, deviceId }` | `unauthorized` |
| GET | `/me` | bearer | Principal, roles per entity, permissions, feature flags, minimum app version | `me.ts` | `MeResponse`: `{ principal, roles: [{ entityId, entityCode, roleKey, teamId }], permissions, featureFlags, minimumAppVersion, latestAppVersion, serverTime }` | `unauthorized` |
| POST | `/realtime/token` | session (bearer with the mobile API, Phase 4) | BOS-signed ES256 JWT for Supabase Realtime (≤ 15 min); built for the session, with `/.well-known/jwks.json` and `/.well-known/openid-configuration`; a call with no `Origin` or another site's is refused; 20 tokens per person in 5 minutes | `realtime.ts`: `RealtimeTokenRequest` (empty) | `RealtimeTokenResponse`: `{ token, expiresAt, channels }`; claims `RealtimeClaims` (`sub`, `entity_ids`, `bos_role`, `aud: shakti-realtime`, `role: authenticated`, `exp` ≤ 15 min, ADR 0003) | `validation_failed` (a body with any field, or over 64 bytes, refused unread before the session is looked up when its declared length says so); `unauthorized`; `forbidden` (no `Origin`, another site's, or no company in scope); `rate_limited` (with `Retry-After`); `integration_unavailable` (signing keys or the issuer not configured, or the store that counts tokens unavailable) |
| POST | `/voice/session` | session (Executive, GM) | Create a voice session, return LiveKit room token and the user-scoped BOS token | `voice.ts`: `VoiceSessionRequest` (`mode`, `consentRecording`, `entityId?`) | `VoiceSessionResponse`: `{ sessionId, livekit: { url, roomName, participantToken, expiresAt }, bosToken: { token, expiresAt }, limits }`; worker claims `VoiceTokenClaims` (`aud: shakti-voice`, `sid` = session, ≤ 5 min) | `validation_failed`; `unauthorized`; `forbidden` (`voice_cap_reached`); `integration_unavailable` |

### 3.2 Field app sync
| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| GET | `/sync/pull?since=<cursor>` | Engineer's schedule, jobs, checklists, surveys, reference data changed since the cursor; returns `nextCursor` | `sync.ts`: `SyncPullQuery` (`since?`, `limit` 1..1000) | `SyncPullResponse`: `{ changes: [{ op: upsert, collection, id, updatedAt, record } \| { op: delete, collection, id, updatedAt }], nextCursor, hasMore, serverTime }` | `validation_failed` (`cursor_expired`: the app starts a full pull); `unauthorized`; `forbidden` (`app_update_required`) |
| POST | `/sync/push` | Batch of commands `{ commands: [{ id, name, input, idempotencyKey, clientTime }] }`; applied in order; returns per-command result or conflict | `SyncPushRequest` (1..100 commands, one key each) | `SyncPushResponse`: `{ results: [{ idempotencyKey, id, status: applied \| replayed \| conflict \| rejected \| held, … }], serverTime }`; a conflict carries `reason` and the server's record for the conflict screen | `validation_failed`; `unauthorized`; `forbidden` (`app_update_required`); `conflict` (`idempotency_mismatch` for the batch key) |
| POST | `/files/presign` | Pre-signed PUT for a photo, receipt or signature (`purpose`, `contentType`, `size`) | `files.ts`: `FilePresignRequest` (`id`, `entityId`, `purpose`, `contentType`, `size` ≤ 15 MB, `sha256?`) | `FilePresignResponse`: `{ fileId, method: PUT, uploadUrl, headers, expiresAt }` | `validation_failed`; `unauthorized`; `forbidden`; `conflict` (`idempotency_mismatch`); `integration_unavailable` |
| POST | `/files/:id/complete` | Marks the upload complete; triggers scan and masking | `FileCompleteParams`, `FileCompleteRequest` (`size`, `sha256?`) | `FileCompleteResponse`: `{ fileId, status: scanning \| ready }` | `validation_failed` (`upload_missing`, `size_mismatch`); `unauthorized`; `forbidden`; `not_found`; `conflict` |
| POST | `/attendance/check-in` | Geofenced or site check-in with selfie file ID | `attendance.ts`: `CheckInRequest` (`id`, `entityId`, `type`, `at`, `geo`, `selfieFileId`, `siteId` for a site check-in, `projectId?`) | `CheckInResponse`: `{ id, recordedAt, withinGeofence, distanceM, needsReview }`; outside the geofence is recorded for review, not refused | `validation_failed`; `unauthorized`; `forbidden`; `not_found` (selfie or site); `conflict` |
| POST | `/expenses` | Create an expense claim with receipt file IDs | `expenses.ts`: `CreateExpenseRequest` (`id`, `entityId`, `projectId` or null for overhead, `lines` with category, date, amount, receipts) | `CreateExpenseResponse`: `{ id, state: submitted, total, overLimitLineIds }` | `validation_failed`; `unauthorized`; `forbidden`; `not_found` (project or receipt); `conflict` |

### 3.3 Ingest (entity websites, partners)
| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| POST | `/ingest/leads` | `{ entityCode, name, phone, pin?, segment?, message?, utm?, consent: { purpose, text, givenAt }, turnstileToken }` → lead created or attached; returns `leadId` | `ingest.ts`: `IngestLeadRequest` (phone normalised to E.164 on parse) | `IngestLeadResponse`: `{ leadId, outcome: created \| attached }` | `validation_failed`; `unauthorized` (key); `forbidden` (`turnstile_failed`, key of another entity) |
| GET | `/ingest/health` | Key validity and rate-limit status | none | `IngestHealthResponse`: `{ keyValid, entityCode, rateLimit: { limit, remaining, resetAt } }` | `unauthorized` |

### 3.4 Provider webhooks
Provider payloads are loose schemas: unknown keys are kept, and only the fields the workers act on are required, so a field a provider adds never fails parsing while a changed field the BOS relies on does. Each POST answers `WebhookAck` (`{ received: true }`) once the raw payload is stored, and `unauthorized` when the signature or key check fails.

| Method | Path | Provider | Notes | Contract |
|---|---|---|---|---|
| GET/POST | `/webhooks/meta/whatsapp` | Meta WhatsApp Cloud API | Verification handshake on GET; messages, statuses, template updates on POST | `webhooks-meta.ts`: `MetaVerifyQuery` (GET answers the challenge as text, `forbidden` on a wrong verify token); `WhatsAppWebhook` (`messages`, `statuses`, `message_template_status_update`, `phone_number_quality_update`; other fields acknowledged); `MetaSignatureHeaderSchema` |
| POST | `/webhooks/meta/leadgen` | Meta Lead Ads | Lead ID → fetched with the page token → normalised | `MetaLeadgenWebhook`; the fetched lead parses with `MetaLeadDetails` |
| POST | `/webhooks/google/leadform` | Google Lead Form | Key in payload | `webhooks-google.ts`: `GoogleLeadFormWebhook` (`google_key` compared in constant time; `is_test` stored, no lead) |
| POST | `/webhooks/exotel/call-status` | Exotel | Call state, duration, recording URL | `webhooks-exotel.ts`: `ExotelCallStatusWebhook` (`CustomField` carries `calls.id`); authenticated by the signed per-call callback address (§2) and the CallSid the dial returned |
| POST | `/webhooks/exotel/incoming` | Exotel | Inbound call → screen-pop event | `ExotelIncomingWebhook` (Passthru applet) |
| POST | `/webhooks/livekit` | LiveKit | Room and participant events | `webhooks-livekit.ts`: `LiveKitWebhook`; `Authorization` JWT from the API secret with the body's SHA-256 |

Pipeline for every webhook: verify signature → insert `webhook_inbox` (unique on provider event ID) → `200` within 2 s → QStash worker → commands. Duplicates and out-of-order events are handled by the worker using the provider event ID and timestamps.

### 3.5 Tally connector
Contracts in `connector.ts`. Every call carries `ConnectorHeaders`; the signature is HMAC-SHA256, as lowercase hex, over `connectorSigningString()` (method, path with query, Unix-seconds timestamp and the body's SHA-256, one per line), and a timestamp outside `CONNECTOR_CLOCK_SKEW_SECONDS` (300) answers `unauthorized`.

| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| POST | `/connector/tally/heartbeat` | `{ connectorVersion, tallyVersion, companies: [{ name, lastAlterId }] }`; a 30-minute silence raises an alert | `ConnectorHeartbeatRequest` (adds `reachable` per company and `queueDepth`) | `ConnectorHeartbeatResponse`: `{ serverTime, latestVersion, updateAvailable }` | `validation_failed`; `unauthorized` |
| POST | `/connector/tally/batches` | `{ company, entityCode, vouchers: [...], ledgers: [...], maxAlterId }` with `Idempotency-Key`; vouchers keyed by GUID; purchase vouchers stored restricted | `ConnectorBatchRequest` (adds `fromAlterId`; `TallyVoucher`, `TallyLedger`; ≤ 500 vouchers) | `ConnectorBatchResponse`: `{ company, accepted: { vouchersNew, vouchersChanged, vouchersUnchanged, ledgers }, lastAlterId }` | `validation_failed`; `unauthorized`; `forbidden` (company not mapped to the entity); `conflict` (`cursor_mismatch`, `idempotency_mismatch`) |
| POST | `/connector/tally/snapshot` | Daily `{ company, voucherGuids: [...], asOf }`; server computes tombstones | `ConnectorSnapshotRequest` (adds `entityCode` and `fromDate`, the first voucher date covered) | `ConnectorSnapshotResponse`: `{ company, known, tombstoned, missingOnServer }` | `validation_failed`; `unauthorized`; `forbidden`; `conflict` (`idempotency_mismatch`) |
| GET | `/connector/tally/cursor?company=` | Last accepted `alterId` per company so the connector can resume | `ConnectorCursorQuery` | `ConnectorCursorResponse`: `{ company, lastAlterId, updatedAt }` | `validation_failed`; `unauthorized`; `forbidden` |
| GET | `/connector/release` | Latest signed release manifest for self-update | none | `ConnectorReleaseResponse`: `{ version, minimumVersion, url, sha256, signature, publishedAt }` | `unauthorized` |

### 3.6 Workers (QStash only)
Every worker refuses a body over 4 KiB with `400 validation_failed` and QStash's no-retry header (`Upstash-NonRetryable-Error`) before the signature, reading no further than that (`apps/web/src/request-body.ts`); verifies the QStash signature (`Upstash-Signature`) with the current and next signing keys; runs the command as its principal (a named agent principal or `system:workers`, never with a cost permission); and returns `200` on success or a retryable `5xx`. An event worker also checks the body's `eventId` in Redis (`evt:{id}`, 7 days) and answers `duplicate` without running when it has seen it; that check arrives in Phase 1 with the first subscribed worker, since the two built routes, the publisher and the import commit, receive no event. Bodies carry ids, codes and counts only. Contracts in `worker-jobs.ts` unless the row says otherwise; each answer is `{ eventId, outcome: duplicate }` or `{ eventId, outcome: done, … }` with the fields listed. Errors for every worker: `unauthorized` (signature), `validation_failed` (body, not retried), `integration_unavailable` (retried); the import commit worker also answers `403 forbidden` with the no-retry header when the person who asked is suspended or has lost the import permission in that company.

| Method | Path | Purpose | Contract | Response |
|---|---|---|---|---|
| POST | `/workers/outbox/publish` | The outbox publisher (built): leases up to 100 due events for 120 seconds, sends each to its QStash URL group and records the outcomes under the lease; each lease counts an attempt and a release gives it back; a failed event is due again after its backoff, the rows of a run whose delivery throws are released at once, and only the rows of a run that dies before it records anything wait for their lease to run out, after which a row whose attempts are spent is dead-lettered (`no_outcome`) by the next lease, whose run counts it in `deadLettered` and logs it in the warning `outbox.no_outcome_dead_lettered` (the run's request id, the count and at most 20 ids); the function stops after 60 seconds (`maxDuration`) | `workers.ts`, no body | `OutboxPublishResponse`: `{ claimed, published, skipped, failed, deadLettered }` |
| POST | `/workers/outbox/:type` | One outbox event delivered to the worker subscribed to its type (QStash URL group `evt-<type>`) | `OutboxEventParams` (`type` from the event catalogue); body `OutboxEventDelivery` (the publisher's `DeliveredEvent`) | `OutboxEventResult`: `{ eventId, outcome }` |
| POST | `/workers/messaging/send` | Check and send one `message.requested` (§6) | `MessagingSendJob` (`eventId`, `entityId`, `message`: `MessageRequested` in `messaging.ts`) | `MessagingSendResult`: `status: sent` with `providerMessageId`, or `status: refused` with `refusal` (`MESSAGING_REFUSALS`) |
| POST | `/workers/files/scan` | Malware scan of a completed upload | `FileScanJob` (`eventId`, `fileId`) | `FileScanResult`: `{ fileId, verdict: clean \| infected \| unreadable }` |
| POST | `/workers/files/mask` | OCR masking before the kept copy is stored and before any classifier | `FileMaskJob` (`eventId`, `fileId`, `expect`: `aadhaar`, `bank_account`) | `FileMaskResult`: `{ fileId, status: masked \| clean \| needs_review \| rejected, regionsMasked }` |
| POST | `/workers/pdf/render` | Render a document version or a label sheet with headless Chromium (ADR 0009) | `PdfRenderJob` (`eventId`, `entityId`, `target`: a `document` with type, id and version, or `labels` with kind, size and 1..500 ids) | `PdfRenderResult`: `{ fileId, pages, bytes }` |
| POST | `/workers/imports/commit` | Commit batches of an import job (built): as the person who asked, starting batches for 30 seconds (a batch keeps to 20 seconds: with less left than the slowest measured set-based batch, 17.2 seconds, it goes straight to row by row, and row by row it stops between rows once its time is spent), with the route's request id on every batch's audit rows and log lines, then hands the rest to a new QStash message whose deduplication id names the job and its committed rows; a retryable `503`, logged as a warning, when a lock wait runs out (another run of the same job holding its row, or a row a batch needs held elsewhere) or a statement is cut off, with nothing of that batch committed and the job not failed; `403` with QStash's no-retry header when that person is suspended or has lost the import permission in that company | `workers.ts`: `ImportCommitWorkerBody` | `ImportCommitWorkerResponse` |
| POST | `/workers/agents/:agent` | Wake one agent with the event that concerns it | `AgentRunParams` (`agent`: `AGENT_NAMES`); body `AgentRunJob` (`DeliveredEvent`) | `AgentRunResult`: `{ runId, suggested, awaitingApproval, applied, stopped: kill_switch \| spend_cap \| null }` |
| POST | `/workers/stt/transcribe` | Transcribe a call recording or a voice session | `SttTranscribeJob` (`eventId`, `entityId`, `source`: a call or a voice session, `audioFileId`, `languageHint`) | `SttTranscribeResult`: `{ transcriptFileId, audioSeconds }` |
| POST | `/workers/embeddings/index` | Chunk and embed one vault file with its entity and sensitivity | `EmbeddingsIndexJob` (`eventId`, `knowledgeFileId`, `entityId` or null, `sensitivity`) | `EmbeddingsIndexResult`: `{ knowledgeFileId, chunks, replaced }` |
| POST | `/workers/notify` | Write a notification for up to 500 people and push it under their preferences and quiet hours | `NotifyJob` (`eventId`, `entityId`, `type`, `recipientIds`, `subject`: type and id) | `NotifyResult`: `{ created, pushed, heldForQuietHours }` |

### 3.7 Operations
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness (built); `HealthResponse` in `health.ts` |
| GET | `/health/ready` | none | Readiness (built): checks `database`, `auth_database`, `key_value` (a write and read back), `config` and `outbox` (down when a due event has waited more than five minutes since it became due: the publisher is not running); 200 with `ReadyResponse` (`{ status, time }`) in `health.ts` when all are `ok`, otherwise 503 `integration_unavailable` naming no check, the failing ones logged as `health.not_ready` with the request id; 20 calls a minute per address (one shared count when the address is unreadable), then 429 with `Retry-After` |
| GET | `/admin/integrations?cursor=&limit=` | session (admin.integrations.write) | Integration Health: webhook inbox stats per provider, dead-lettered events (paged by the cursor), connector heartbeat, WhatsApp quality and tier, AI spend per agent; `IntegrationHealthQuery` and `IntegrationHealthResponse` in `admin-integrations.ts`; errors `validation_failed`, `unauthorized`, `forbidden` |
| POST | `/admin/integrations/replay` | session (admin.integrations.write) | Replay a dead-lettered event (`integrations.dlq.replay`): back in the queue with its attempts reset, audited; `IntegrationReplayRequest` (`eventId`) and `IntegrationReplayResponse` (`{ eventId, requeued, attempts: 0 }`) in `admin-integrations.ts`; errors `validation_failed`, `unauthorized`, `forbidden`, `not_found`, `conflict` (`not_dead_lettered`); the command and its server action `replayDeadLetter` are built (migration 0044), the route comes with the Integration Health page |

### 3.8 Public signing keys (outside `/api/v1`)
Served at the site root for Supabase Realtime, which trusts the BOS as a third-party token issuer (ADR 0003); both are built.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | none | The BOS public ES256 signing keys that verify Realtime tokens |
| GET | `/.well-known/openid-configuration` | none | The issuer's discovery document, naming the key list |

## 4. Server actions (web)
- Live in `apps/web/src/actions/<module>.ts`, one exported function per command or query, each a thin wrapper: resolve the caller from the session → `parseInput()` with the contract → `executeCommand()` or `executeQuery()` (which open `withRequestContext()`) → answer the `ActionResult` envelope (`apps/web/src/actions/result.ts`): `{ ok: true, data }` with the DTO, or `{ ok: false, error, field?, reference? }` naming a catalogue sentence, because Next.js masks errors thrown from a server action in production. The Better Auth actions in `actions/auth.ts` answer a `{ error }` form state instead.
- No business logic in actions. No direct database access in components.
- Reads for pages use typed query functions in `packages/domain/src/queries`, called through `executeQuery()`.

## 5. Contracts
`packages/contracts` layout:
```
src/
  api/                             route request/response schemas for /api/v1, the endpoint catalogue and fixtures
  audit/                           audit outcomes, auth audit events and the audit log DTO
  auth/                            user status, theme and other identity enumerations
  catalogue/                       item, price-tier and money enumerations
  commands/<module>/<file>.ts      command input + output schemas, named after the command or its group
  crm/                             CRM enumerations and phone normalisation
  dto/                             shared DTOs (never include restricted fields unless suffixed `WithCost`)
  events/                          outbox event catalogue and payloads
  imports/                         import kinds, statuses and other import enumerations
  numbering/                       document types numbered from `document_sequences`
  tax/                             shapes that cross the tax engine's boundary
  templates/                       WhatsApp and email templates, caller scripts and voice prompts
  errors.ts                        error codes
  ids.ts, principal.ts, roles.ts, permissions.ts   IDs, the principal, staff roles and the permission catalogue
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
Commands never call Meta directly. They emit `message.requested` with `{ threadId, kind: 'template' | 'session', templateName?, params?, bodyMasked?, fileId? }` (`MessageRequested` in `packages/contracts/src/api/messaging.ts`: a template message names its approved template and parameters, a session message its masked body; the type joins the event catalogue with the messaging worker in Phase 2). The messaging worker enforces: opt-out, 24-hour window for session messages, template approval status, portfolio tier budget (service messages first), deterministic output filter, per-conversation rate limit; then sends and records `provider_message_id`. Status webhooks update `whatsapp_messages.status`.

## 7. Compatibility and deprecation
- Additive changes (new optional fields, new endpoints) ship without a version bump.
- Removing or changing a field requires `/api/v2` and a deprecation notice in the `Deprecation` and `Sunset` headers on `/api/v1` responses for 6 months.
- Contract tests with recorded payloads for Meta, Exotel, Google and Tally run in CI; a provider payload change that breaks parsing fails the build, not production.
