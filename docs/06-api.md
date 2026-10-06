# API — Shakti Prime BOS

Blueprint reference: §4, §10. The BOS has two entry surfaces: **server actions** for the web app and **`/api/v1`** for the field app, the Tally connector, the voice agent, website ingest, provider webhooks and workers. Both call the same domain commands. `docs/01-blueprint.md` governs on any conflict.

## Contents
1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Endpoint catalogue](#3-endpoint-catalogue): [3.1 Auth and session](#31-auth-and-session), [3.2 Field app sync](#32-field-app-sync), [3.2a Uploads](#32a-uploads), [3.3 Ingest](#33-ingest-entity-websites-partners), [3.4 Provider webhooks](#34-provider-webhooks), [3.5 Tally connector](#35-tally-connector), [3.6 Workers](#36-workers-qstash-only), [3.7 Operations](#37-operations), [3.8 Public signing keys](#38-public-signing-keys-outside-apiv1), [3.9 Better Auth](#39-better-auth-outside-apiv1)
4. [Server actions (web)](#4-server-actions-web)
5. [Contracts](#5-contracts)
6. [Messaging contracts (outbound WhatsApp)](#6-messaging-contracts-outbound-whatsapp)
7. [Compatibility and deprecation](#7-compatibility-and-deprecation)

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
| Rate limits | Per token via Upstash Redis, with the bearer tokens (Phase 4); the built routes keep their own caps, named in their rows; `429` with `Retry-After`; defaults 600 req/min per user token, 60 req/min per ingest key |
| Errors | One envelope: `{ "error": { "code": "forbidden", "message": "…", "details": {...}, "requestId": "…" } }`; codes from `packages/contracts/src/errors.ts` |
| Request ID | One rule for every route, server action, auth event and error log line (`apps/web/src/request-id.ts`): Vercel's `x-vercel-id` when present (a new id when it is not safe to echo), else the caller's `X-Request-Id` when it matches `[\w.:-]{1,128}` (QStash, a monitor, a local run), else a new id, so on a hosted deployment a caller cannot choose the id an audit row or a log line carries; echoed in the response and the logs |
| Localisation | Messages in error envelopes are English; `Accept-Language` is not negotiated |

### Error codes
`validation_failed` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409, state machine or idempotency conflict), `rate_limited` (429), `integration_unavailable` (503), `internal` (500).

## 2. Authentication
| Caller | Mechanism |
|---|---|
| Web app (server actions, built) | Better Auth session cookie (HttpOnly, Secure, SameSite=Lax) with CSRF origin checks; TOTP step-up for Executive, GM, Accounts |
| Field app (Phase 4) | `POST /auth/mobile/token` exchanges credentials (+ TOTP where required) for a 15-minute access token and a refresh token bound to the device; refresh tokens rotate; per-device revocation |
| Voice agent (Phase 2) | The BOS mints a 5-minute user-scoped token when a voice session starts; the worker sends it as `Authorization: Bearer` so every command runs as the speaking user |
| Tally connector (Phase 5) | Per-connector key; every request carries `X-Connector-Id`, `X-Timestamp` and `X-Signature` (HMAC-SHA256 over method, path, timestamp and body); 5-minute clock skew window |
| Website ingest (Phase 2) | Per-entity ingest key in `X-Ingest-Key` plus a Cloudflare Turnstile token in the body |
| Provider webhooks (Phase 2) | Provider signature verification before any processing: Meta `X-Hub-Signature-256`, the Google Lead Form key, and for Exotel, which sends no signature header, a StatusCallback address per call that carries the BOS call id, an expiry and an HMAC-SHA256 of both under `EXOTEL_CALLBACK_SECRET` (`apps/web/src/integrations/exotel/status-callback.ts`) |
| Workers (built) | QStash signature (`Upstash-Signature`) verified with the current and next signing keys |

Every authenticated call runs inside `withRequestContext()` with the caller's principal and entity scope.

## 3. Endpoint catalogue
Every `/api/v1` route below except four is an entry of `API_ENDPOINTS` in `packages/contracts/src/api/endpoints.ts`, which names its request, query and response schemas and its error codes; schema files are under `packages/contracts/src/api/`. The four exceptions are the signed schedule targets of §3.6, `/workers/files/sweep`, `/workers/crm/rescore`, `/workers/crm/duplicates` and `/workers/quotes/expire`, which sit outside the catalogue and have their bodies and answers in `workers.ts`. `packages/contracts/src/api/fixtures.ts` holds a recorded example for each route, and `endpoints.test.ts` fails when a route here and the catalogue differ (the four exceptions are not compared). Every authenticated route can also answer `rate_limited` (429 with `Retry-After`) and `internal`; the Errors column lists the rest, with `details.reason` where the caller acts on it.

A row marked **(built)** is served today; every other row is the contract for the phase that builds it, named under each heading. The routes outside `/api/v1` are in §3.8 and §3.9.

### 3.1 Auth and session
The mobile token routes and `/me` come with the field app (Phase 4), `/voice/session` with live voice (Phase 2). The web app signs in through Better Auth (§3.9).

| Method | Path | Auth | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/auth/mobile/token` | credentials | Issue access + refresh tokens for the field app | `mobile-auth.ts`: `MobileTokenRequest` (email, password, `totpCode?` or `backupCode?`, `device`) | `MobileTokenResponse`: `{ tokenType, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, userId }`; access claims `MobileAccessClaims` (`aud: shakti-mobile`, `sid` = device, `bos_role`, ≤ 15 min) | `validation_failed`; `unauthorized` (`invalid_credentials`, `totp_required`, `totp_invalid`, `account_locked`); `forbidden` (`account_suspended`, `app_update_required`) |
| POST | `/auth/mobile/refresh` | refresh token | Rotate tokens | `MobileRefreshRequest` (`refreshToken`, `deviceId`, `appVersion`) | `MobileRefreshResponse` (the same pair, both tokens new) | `validation_failed`; `unauthorized` (`refresh_expired`, `refresh_reused` revokes the family, `device_revoked`); `forbidden` (`app_update_required`) |
| POST | `/auth/mobile/revoke` | bearer | Revoke this device | `MobileRevokeRequest` (empty) | `MobileRevokeResponse`: `{ revoked: true, deviceId }` | `unauthorized` |
| GET | `/me` | bearer | Principal, roles per entity, permissions, feature flags, minimum app version | `me.ts` | `MeResponse`: `{ principal, roles: [{ entityId, entityCode, roleKey, teamId }], permissions, featureFlags, minimumAppVersion, latestAppVersion, serverTime }` | `unauthorized` |
| POST | `/realtime/token` | session (bearer with the mobile API, Phase 4) | (built) BOS-signed ES256 JWT for Supabase Realtime (≤ 15 min), for the session, with `/.well-known/jwks.json` and `/.well-known/openid-configuration`; a call with no `Origin` or another site's is refused; 20 tokens per person in 5 minutes | `realtime.ts`: `RealtimeTokenRequest` (empty) | `RealtimeTokenResponse`: `{ token, expiresAt, channels }`; claims `RealtimeClaims` (`sub`, `entity_ids`, `bos_role`, `aud: shakti-realtime`, `role: authenticated`, `exp` ≤ 15 min, ADR 0003) | `validation_failed` (a body with any field, or over 64 bytes, refused unread before the session is looked up when its declared length says so); `unauthorized`; `forbidden` (no `Origin`, another site's, or no company in scope); `rate_limited` (with `Retry-After`); `integration_unavailable` (signing keys or the issuer not configured, or the store that counts tokens unavailable) |
| POST | `/voice/session` | session (Executive, GM) | Create a voice session, return LiveKit room token and the user-scoped BOS token | `voice.ts`: `VoiceSessionRequest` (`mode`, `consentRecording`, `entityId?`) | `VoiceSessionResponse`: `{ sessionId, livekit: { url, roomName, participantToken, expiresAt }, bosToken: { token, expiresAt }, limits }`; worker claims `VoiceTokenClaims` (`aud: shakti-voice`, `sid` = session, ≤ 5 min) | `validation_failed`; `unauthorized`; `forbidden` (`voice_cap_reached`); `integration_unavailable` |

### 3.2 Field app sync
Phase 4, with the field app (ADR 0012). Uploads are in §3.2a.

| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| GET | `/sync/pull?since=<cursor>` | Engineer's schedule, jobs, checklists, surveys, reference data changed since the cursor; returns `nextCursor` | `sync.ts`: `SyncPullQuery` (`since?`, `limit` 1..1000) | `SyncPullResponse`: `{ changes: [{ op: upsert, collection, id, updatedAt, record } \| { op: delete, collection, id, updatedAt }], nextCursor, hasMore, serverTime }` | `validation_failed` (`cursor_expired`: the app starts a full pull); `unauthorized`; `forbidden` (`app_update_required`) |
| POST | `/sync/push` | Batch of commands `{ commands: [{ id, name, input, idempotencyKey, clientTime }] }`; applied in order; returns per-command result or conflict | `SyncPushRequest` (1..100 commands, one key each) | `SyncPushResponse`: `{ results: [{ idempotencyKey, id, status: applied \| replayed \| conflict \| rejected \| held, … }], serverTime }`; a conflict carries `reason` and the server's record for the conflict screen | `validation_failed`; `unauthorized`; `forbidden` (`app_update_required`); `conflict` (`idempotency_mismatch` for the batch key) |
| POST | `/attendance/check-in` | Geofenced or site check-in with selfie file ID | `attendance.ts`: `CheckInRequest` (`id`, `entityId`, `type`, `at`, `geo`, `selfieFileId`, `siteId` for a site check-in, `projectId?`) | `CheckInResponse`: `{ id, recordedAt, withinGeofence, distanceM, needsReview }`; outside the geofence is recorded for review, not refused | `validation_failed`; `unauthorized`; `forbidden`; `not_found` (selfie or site); `conflict` |
| POST | `/expenses` | Create an expense claim with receipt file IDs | `expenses.ts`: `CreateExpenseRequest` (`id`, `entityId`, `projectId` or null for overhead, `lines` with category, date, amount, receipts) | `CreateExpenseResponse`: `{ id, state: submitted, total, overLimitLineIds }` | `validation_failed`; `unauthorized`; `forbidden`; `not_found` (project or receipt); `conflict` |

### 3.2a Uploads
The two calls of an upload ([ARCHITECTURE §9](04-architecture.md#9-files-masking-and-print)): the screens reach the same commands through the server actions in `apps/web/src/actions/files.ts`, and the field app through these routes from Phase 4. File bytes never pass through the API.

| Method | Path | Auth | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/files/presign` | session (bearer with the mobile API, Phase 4) | (built) Records an upload (`files.upload.begin`) and answers a 15-minute pre-signed PUT with the type, length, SHA-256 and encryption bound into the signature; at most 60 calls in five minutes per person | `files.ts`: `FilePresignRequest` (`entityId`, `purpose`, `name`, `contentType`, `size` ≤ 15 MB and the purpose's limit, `sha256`); `Idempotency-Key` | `FilePresignResponse`: `{ fileId, method: PUT, uploadUrl, headers, expiresAt }` | `validation_failed` (`file_type_not_allowed`, `file_too_large`); `unauthorized`; `forbidden`; `rate_limited`; `conflict` (`idempotency_mismatch`); `integration_unavailable` (`files_unavailable`) |
| POST | `/files/:id/complete` | session (bearer with the mobile API, Phase 4) | (built) The bytes landed: the store's size and SHA-256 must be the declared ones (`files.upload.complete`); the file waits for its checks and is usable once a later read shows `ready` | `FileCompleteParams`, `FileCompleteRequest` (`purpose`); `Idempotency-Key` | `FileCompleteResponse`: `{ fileId, status: scanning }` | `validation_failed`; `unauthorized`; `forbidden`; `rate_limited`; `not_found` (`file_missing`); `conflict` (`file_upload_mismatch`); `integration_unavailable` |

An import file (purpose `import`: a CSV or an `.xlsx` workbook, at most 10 MB) takes the same two calls, as every file does; no file reaches a server action as a form, so the server actions keep Next.js's default body limit. Once its checks leave it `ready` (its bytes are the format its type declares, and a workbook's archive is one the reader may open), the import screen's action `startImport` reads it back from the store, a workbook through ExcelJS's streaming reader, and starts the job (`imports.job.create`); a file still in its checks answers `import_file_not_ready`, and a file of the same content as one whose job is adding or has added its rows in the company `import_file_duplicate`, at the start and again when its job commits. An upload still `pending` a day after it began is cleared by the hourly sweep (§3.6).

On a developer's machine, where no S3 bucket exists, the signed address is `PUT /api/v1/files/local/<token>` on the app itself (and `GET` for a download): the token is the store's signed grant for one key, type, length and SHA-256, and every hosted deployment answers 404 there. It is not part of the contract catalogue.

### 3.3 Ingest (entity websites, partners)
Phase 2, with the website forms (PRD CRM-01).

| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| POST | `/ingest/leads` | `{ entityCode, name, phone, pin?, segment?, message?, utm?, consent: { purpose, text, givenAt }, turnstileToken }` → lead created or attached; returns `leadId` | `ingest.ts`: `IngestLeadRequest` (phone normalised to E.164 on parse) | `IngestLeadResponse`: `{ leadId, outcome: created \| attached }` | `validation_failed`; `unauthorized` (key); `forbidden` (`turnstile_failed`, key of another entity) |
| GET | `/ingest/health` | Key validity and rate-limit status | none | `IngestHealthResponse`: `{ keyValid, entityCode, rateLimit: { limit, remaining, resetAt } }` | `unauthorized` |

### 3.4 Provider webhooks
Phase 2 (LiveKit with live voice, Phase 2). Provider payloads are loose schemas: unknown keys are kept, and only the fields the workers act on are required, so a field a provider adds never fails parsing while a changed field the BOS relies on does. Each POST answers `WebhookAck` (`{ received: true }`) once the raw payload is stored, and `unauthorized` when the signature or key check fails.

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
Phase 5 (ADR 0013). Contracts in `connector.ts`. Every call carries `ConnectorHeaders`; the signature is HMAC-SHA256, as lowercase hex, over `connectorSigningString()` (method, path with query, Unix-seconds timestamp and the body's SHA-256, one per line), and a timestamp outside `CONNECTOR_CLOCK_SKEW_SECONDS` (300) answers `unauthorized`.

| Method | Path | Purpose | Contract | Response | Errors |
|---|---|---|---|---|---|
| POST | `/connector/tally/heartbeat` | `{ connectorVersion, tallyVersion, companies: [{ name, lastAlterId }] }`; a 30-minute silence raises an alert | `ConnectorHeartbeatRequest` (adds `reachable` per company and `queueDepth`) | `ConnectorHeartbeatResponse`: `{ serverTime, latestVersion, updateAvailable }` | `validation_failed`; `unauthorized` |
| POST | `/connector/tally/batches` | `{ company, entityCode, vouchers: [...], ledgers: [...], maxAlterId }` with `Idempotency-Key`; vouchers keyed by GUID; purchase vouchers stored restricted | `ConnectorBatchRequest` (adds `fromAlterId`; `TallyVoucher`, `TallyLedger`; ≤ 500 vouchers) | `ConnectorBatchResponse`: `{ company, accepted: { vouchersNew, vouchersChanged, vouchersUnchanged, ledgers }, lastAlterId }` | `validation_failed`; `unauthorized`; `forbidden` (company not mapped to the entity); `conflict` (`cursor_mismatch`, `idempotency_mismatch`) |
| POST | `/connector/tally/snapshot` | Daily `{ company, voucherGuids: [...], asOf }`; server computes tombstones | `ConnectorSnapshotRequest` (adds `entityCode` and `fromDate`, the first voucher date covered) | `ConnectorSnapshotResponse`: `{ company, known, tombstoned, missingOnServer }` | `validation_failed`; `unauthorized`; `forbidden`; `conflict` (`idempotency_mismatch`) |
| GET | `/connector/tally/cursor?company=` | Last accepted `alterId` per company so the connector can resume | `ConnectorCursorQuery` | `ConnectorCursorResponse`: `{ company, lastAlterId, updatedAt }` | `validation_failed`; `unauthorized`; `forbidden` |
| GET | `/connector/release` | Latest signed release manifest for self-update | none | `ConnectorReleaseResponse`: `{ version, minimumVersion, url, sha256, signature, publishedAt }` | `unauthorized` |

### 3.6 Workers (QStash only)
How events are leased, retried, dead-lettered and held back by the failure callback is ARCHITECTURE §6; every event type, its payload and whether a worker handles it is [events.md](data/events.md). Rules for every worker route:
- **Body cap first:** a body over the route's cap is refused with `400 validation_failed` and QStash's no-retry header before the signature is checked; the caps are in [ARCHITECTURE §6](04-architecture.md#6-events-and-workers).
- **Signature:** the QStash signature (`Upstash-Signature`) is verified with the current and next signing keys.
- **Principal:** the worker runs its command as its principal (a named agent principal or `system:workers`, never with a cost permission) and returns `200` on success or a retryable `5xx`.
- **Duplicates:** an event worker answers `duplicate` without running when it has handled the body's `eventId`, and a delivery that arrives while another holds the id answers a retryable `409 conflict` (reason `event_in_progress`); the claim and the ordering rules are in [ARCHITECTURE §6](04-architecture.md#6-events-and-workers).
- **Bodies** carry ids, codes and counts only. Contracts are in `worker-jobs.ts` unless the row says otherwise; each answer is `{ eventId, outcome: duplicate }` or `{ eventId, outcome: done, … }` with the fields listed.
- **Errors for every worker:** `unauthorized` (signature), `validation_failed` (body, not retried), `integration_unavailable` (retried); the import commit worker also answers `403 forbidden` with the no-retry header when the person who asked is suspended or has lost the import permission in that company.

| Method | Path | Purpose | Contract | Response |
|---|---|---|---|---|
| POST | `/workers/outbox/publish` | (built) The outbox publisher: leases up to 100 due events, sends each to its QStash URL group and records the outcomes under the lease (ARCHITECTURE §6); the function stops after 60 seconds (`maxDuration`) | `workers.ts`, no body | `OutboxPublishResponse`: `{ claimed, published, skipped, failed, deadLettered }` |
| POST | `/workers/outbox/:type` | (built) One outbox event delivered to the worker subscribed to its type through the URL group `evt-<type>`; the signature must name this address. The worker registered for the type runs as `system:workers` in the event's company, for every event once or for the latest of each aggregate (ARCHITECTURE §6, which also says which answers are retried); `404 not_found` for a type no worker handles, `400 validation_failed` for a body that is not the event of that type. The subscribed types are listed in [events.md](data/events.md#event-types) | `OutboxEventParams` (`type` from the event catalogue); body `OutboxEventDelivery` (the publisher's `DeliveredEvent`) | `OutboxEventResult`: `{ eventId, outcome }` |
| POST | `/workers/outbox/failed` | (built) QStash's failure callback for the event workers: an event its worker refused for good, or that failed after the last retry, comes back here and becomes a dead letter again (ARCHITECTURE §6); the signature must name this address. An event already held back, or no longer in the outbox, answers `unchanged` | `OutboxFailureCallback` (QStash's callback: `status`, `sourceBody`; the rest is ignored) | `OutboxFailureResult`: `{ eventId, outcome: held \| unchanged, lastError }` |
| POST | `/workers/messaging/send` | Phase 2. Check and send one `message.requested` (§6) | `MessagingSendJob` (`eventId`, `entityId`, `message`: `MessageRequested` in `messaging.ts`) | `MessagingSendResult`: `status: sent` with `providerMessageId`, or `status: refused` with `refusal` (`MESSAGING_REFUSALS`) |
| POST | `/workers/pdf/render` | (built; labels with Phase 3) Render a document version or a label sheet with headless Chromium (ADR 0009): the publisher sends each `print.document.requested` event here as its job (`EVENT_JOB_ROUTES`), and the signature must name this address; a job already rendered answers `duplicate`. The registered document types are in `apps/web/src/print/documents.ts`; a label sheet or a type with no loader answers `404 not_found` with the no-retry header, any other failure is retried (ARCHITECTURE §9) | `PdfRenderJob` (`eventId`, `entityId`, `target`: a `document` with type, id and version, or `labels` with kind, size and 1..500 ids) | `PdfRenderResult`: `{ eventId, outcome: duplicate }` or `{ eventId, outcome: done, fileId, pages, bytes }` |
| POST | `/workers/imports/commit` | (built) Commit batches of an import job as the person who asked, in the companies the job names, then hand the rest to a new QStash message; a retryable `503` when a lock wait runs out or a statement is cut off, with that batch uncommitted; on the queue's last retry a failing call fails the job (`imports.job.fail`), so a job never stays committing; `403` with the no-retry header for a refused call (the person is suspended or has lost the import permission or a company the rows name) | `workers.ts`: `ImportCommitWorkerBody` (`jobId`, `entityId`, `userId`, optional `entityIds`) | `ImportCommitWorkerResponse` |
| POST | `/workers/files/sweep` | (built) The sweep of abandoned uploads: the QStash schedule `files-sweep-<environment>` calls it every hour; as `system:workers` it refuses each upload still `pending` a day after it began (`files.upload.sweep`, reason `file_upload_abandoned`) and deletes whatever bytes landed. Not retried: the next hour's run carries on | no body (`{}`) | `{ companies, abandoned }` |
| POST | `/workers/crm/rescore` | (built) The nightly rescoring of open and nurture leads (CRM-06): the QStash schedule `lead-rescore-<environment>` calls it at 21:30 UTC; as `system:workers`, one company at a time, it runs `crm.lead.score_refresh` (the platform-only `crm.score.refresh`) in batches and hands the rest to a new QStash message when its time budget ends; `400` with the no-retry header for a malformed body, a retryable `503` when a lock wait runs out or a statement is cut off, `503` where the queue is not configured | `workers.ts`: `LeadRescoreWorkerBody` | `LeadRescoreWorkerResponse` |
| POST | `/workers/crm/duplicates` | (built) The nightly search for duplicate customers and leads (CRM-03): the QStash schedule `duplicate-scan-<environment>` calls it at 22:00 UTC; as `system:workers`, one company at a time, it runs `crm.duplicate.scan` (the platform-only `crm.duplicates.scan`) in batches and hands the rest on as the rescoring does, with the same refusals | `workers.ts`: `DuplicateScanWorkerBody` | `DuplicateScanWorkerResponse` |
| POST | `/workers/quotes/expire` | (built) The daily quote expiry ([phase 1 design §7.3](03-roadmap-appendix/phase1.md#73-s1-quotes)): the QStash schedule `quote-expire-<environment>` calls it at 18:35 UTC (00:05 IST); as `system:workers`, one company at a time, it runs `sales.quote.expire` (platform-only) on lapsed draft and sent quotes and leaves what a run does not reach to the next day's, since every read already shows a lapsed quote as expired; the same refusals as the rescoring | `workers.ts`: `QuoteExpireWorkerBody` | `QuoteExpireWorkerResponse` |
| POST | `/workers/agents/:agent` | Phase 1 (the Triage agent in shadow mode), the other agents in their phases. Wake one agent with the event that concerns it | `AgentRunParams` (`agent`: `AGENT_NAMES`); body `AgentRunJob` (`DeliveredEvent`) | `AgentRunResult`: `{ runId, suggested, awaitingApproval, applied, stopped: kill_switch \| spend_cap \| null }` |
| POST | `/workers/stt/transcribe` | Phase 2. Transcribe a call recording or a voice session | `SttTranscribeJob` (`eventId`, `entityId`, `source`: a call or a voice session, `audioFileId`, `languageHint`) | `SttTranscribeResult`: `{ transcriptFileId, audioSeconds }` |
| POST | `/workers/embeddings/index` | Phase 1, with the Knowledge Vault. Chunk and embed one vault file with its entity and sensitivity | `EmbeddingsIndexJob` (`eventId`, `knowledgeFileId`, `entityId` or null, `sensitivity`) | `EmbeddingsIndexResult`: `{ knowledgeFileId, chunks, replaced }` |
| POST | `/workers/notify` | Phase 1, with the notifications. Write a notification for up to 500 people and push it under their preferences and quiet hours | `NotifyJob` (`eventId`, `entityId`, `type`, `recipientIds`, `subject`: type and id) | `NotifyResult`: `{ created, pushed, heldForQuietHours }` |

The schedule targets (`files-sweep`, `lead-rescore`, `duplicate-scan`, `quote-expire`, and `outbox-publish` for the publisher) are listed in [ARCHITECTURE §6](04-architecture.md#6-events-and-workers); one QStash account serves dev and staging, so each schedule's name carries its environment. A worker's time budget and batch size are constants in `apps/web/src/workers` (`LEAD_RESCORE_RUN_BUDGET_MS`, `DUPLICATE_SCAN_RUN_BUDGET_MS`, `QUOTE_EXPIRE_RUN_BUDGET_MS`, `IMPORT_RUN_BUDGET_MS`), and their design is in the [phase 1 design](03-roadmap-appendix/phase1.md) (§6.3, §6.6, §7.3, §7.4).

The checks of an upload have no route of their own: they are the handler of `files.file.uploaded` (`handleFileUploaded` in `apps/web/src/workers/files`), delivered on `/workers/outbox/:type` like every subscribed event. It answers `integration_unavailable` while GuardDuty's verdict is not yet on the object, so the queue delivers it again (ARCHITECTURE §9).

### 3.7 Operations
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | (built) Liveness; `HealthResponse` in `health.ts` |
| GET | `/health/ready` | none | (built) Readiness: checks `database`, `auth_database`, `key_value` (a write and read back), `config` and `outbox` (down when a due event has waited more than five minutes since it became due: the publisher is not running); 200 with `ReadyResponse` (`{ status, time }`) in `health.ts` when all are `ok`, otherwise 503 `integration_unavailable` naming no check, the failing ones logged as `health.not_ready` with the request id; 20 calls a minute per address (one shared count when the address is unreadable), then 429 with `Retry-After` |
| GET | `/admin/integrations?cursor=&limit=` | session (admin.integrations.write) | (built) Integration Health, the data of `/admin/integrations`: the outbox by event type (pending, due, dead-lettered, oldest pending) and the last publisher run, the delivery check (waiting, arrived with the milliseconds from the command to the worker, or lost after ten minutes), and the dead-lettered events newest first with their error code (`errorCode`: a code such as queue_refused or no_outcome, and other for anything that is not a code), paged by the cursor and read through the definer `app.outbox_health()`, never a payload; webhook inbox stats, connector heartbeat, WhatsApp quality and AI spend per agent answer empty and zero until their sources exist (Phase 2, Phase 5 and the Triage agent); `IntegrationHealthQuery` and `IntegrationHealthResponse` in `admin-integrations.ts`; errors `validation_failed`, `unauthorized`, `forbidden` |
| POST | `/admin/integrations/replay` | session (`integrations.dlq.replay` and `admin.integrations.write`, both for every company) | (built) Replay a dead-lettered event: back in the queue with its attempts reset, audited; `IntegrationReplayRequest` (`eventId`) and `IntegrationReplayResponse` (`{ eventId, requeued, attempts: 0 }`) in `admin-integrations.ts`; errors `validation_failed`, `unauthorized`, `forbidden`, `not_found`, `conflict` (`not_dead_lettered`); the server action `replayDeadLetter` behind the page's Send again; the body must be declared as JSON |

### 3.8 Public signing keys (outside `/api/v1`)
Served at the site root for the BOS's Realtime tokens (ADR 0003). Supabase's third-party auth accepts named vendors only, so the project verifies the tokens with the BOS public key imported as a standby signing key, and these documents serve the key's other readers and its rotation (`docs/04-architecture-appendix/realtime.md`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/.well-known/jwks.json` | none | (built) The BOS public ES256 signing keys that verify Realtime tokens |
| GET | `/.well-known/openid-configuration` | none | (built) The issuer's discovery document, naming the key list |

### 3.9 Better Auth (outside `/api/v1`)
`/api/auth/[...all]` (`apps/web/src/app/api/auth/[...all]/route.ts`) is Better Auth's handler (built). The screens reach sign-in, sign-out, passwords and the authenticator app through the server actions in `apps/web/src/actions/auth.ts`, which call the same API in-process, so over HTTP every Better Auth endpoint is switched off (`HTTP_DISABLED_PATHS` in `apps/web/src/auth/create-auth.ts`) except these; `apps/web/tests/auth.test.ts` checks the list against every endpoint the installed version mounts.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/reset-password/:token` | the link's token | (built) The set-password link a mail opens: checks the token and sends the person to the set-password screen |
| GET | `/api/auth/ok`, `/api/auth/error` | none | (built) Better Auth's own status and error pages |

Request caps per address, the sign-in lock and the audit of account events are in [SECURITY §2](07-security.md#2-identity-and-authentication).

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
  catalogue/                       item, price-tier and money enumerations, and the specifications of an item by category
  commands/<module>/<file>.ts      command input + output schemas, named after the command or its group
  crm/                             CRM enumerations, the set-up, duplicate and sizing schemas, and phone normalisation
  dto/                             shared DTOs (never include restricted fields unless suffixed `WithCost`)
  events/                          outbox event catalogue and payloads
  imports/                         import kinds, statuses and other import enumerations
  numbering/                       document types numbered from `document_sequences`
  tax/                             shapes that cross the tax engine's boundary
  templates/                       WhatsApp and email templates, caller scripts and voice prompts (the first with Phase 2)
  errors.ts                        error codes
  ids.ts, principal.ts, roles.ts, permissions.ts   IDs, the principal, staff roles and the permission catalogue
  agents.ts, agent-principals.ts, system-principal.ts   the agent runtime's enumerations, the seeded agent principals, and the worker principal's grants
```
Example, from `packages/contracts/src/commands/crm/opportunity.ts`: every opportunity command names the lead and its company, so the request is narrowed to that company, and every input is strict, so an unknown field is refused.
```ts
const Lead = {
  entityId: EntityIdSchema,
  opportunityId: IdSchema,
};

/** `crm.opportunity.stage.move`: to another open stage of the lead's pipeline. */
export const MoveOpportunityStageInput = z.object({ ...Lead, stageId: IdSchema }).strict();
export type MoveOpportunityStageInput = z.infer<typeof MoveOpportunityStageInput>;
```
The command answers `OpportunityDto` (`packages/contracts/src/dto/lead.ts`).

## 6. Messaging contracts (outbound WhatsApp)
Commands never call Meta directly. They emit `message.requested` with `{ threadId, kind: 'template' | 'session', templateName?, params?, bodyMasked?, fileId? }` (`MessageRequested` in `packages/contracts/src/api/messaging.ts`: a template message names its approved template and parameters, a session message its masked body; the type joins the event catalogue with the messaging worker in Phase 2).

The messaging worker enforces, in order: opt-out, the 24-hour window for session messages, template approval status, the portfolio tier budget (service messages first), the deterministic output filter and a per-conversation rate limit; then it sends and records `provider_message_id`. Status webhooks update `whatsapp_messages.status`.

## 7. Compatibility and deprecation
- Additive changes (new optional fields, new endpoints) ship without a version bump.
- Removing or changing a field requires `/api/v2` and a deprecation notice in the `Deprecation` and `Sunset` headers on `/api/v1` responses for 6 months.
- Contract tests with recorded payloads for Meta, Exotel, Google and Tally run in CI; a provider payload change that breaks parsing fails the build, not production.
