# Backend design: Phase 0 weeks 3 to 5

Date: 2026-09-27. Status: the parts marked built (slice 1, ADR 0008, slice 2, slice 3) are built; slice 1 and ADR 0008 are reviewed; the remaining slices are the design for approval. Governing documents: BLUEPRINT §5 to §8, ARCHITECTURE §4 to §8, SECURITY §2 to §4, DATABASE §2 to §7, API §1 to §3, ADR 0003 to 0007, ROADMAP §2. Where this design settles something the documents left open, the section says so; where it changes a documented line, the line has been edited and is listed in §11.

Decisions taken with the client on 2026-09-27:
- **Mixed roles in "All entities" view:** the narrowest role wins. The request carries only the grants every one of the user's roles holds; the user switches to a single entity to use a wider role there.
- **Imports permission:** new key `imports.write`, Executive `all`, General Manager `entity` (SECURITY §3.2 row added).
- **Shared customer master:** one contact and account record for the group, with `account_entities` holding the relationship and its owner per entity (ADR 0008, built 2026-09-27). An accounts import creates one relationship per row's entity and folds a repeated customer into one record.

## 1. Scope by week

| Week | Deliverable | Sections |
|---|---|---|
| 3 | Better Auth with Argon2id, sessions, TOTP, Turnstile, lockouts; `users`, `sessions`, `user_entity_roles`, mobile devices; principal resolution; Realtime JWT spike; `audit_logs` written by the runner; `outbox_events` and the QStash publisher; idempotency keys | §2, §3, §4, §5 |
| 5 | Tax engine with tests; state-machine specifications and the `transition()` runtime for opportunity, quote and sales order; import framework | §6, §7, §8 |

Week 4 (tokens, UI base, app shell) is front-end and is not in this document.

## 2. Identity and authentication (week 3)

### 2.1 Tables
All under RLS, forced, no delete grant. Auth tables are touched by the auth module through a dedicated Postgres role `auth_service` (login, `nobypassrls`, grants on these tables only, no business table). `app_user` reads them for principal resolution and admin screens and writes them only through admin commands.

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` (= `principals.id`), `name`, `email` unique (lower-cased), `email_verified`, `phone`, `theme`, `status` (`invited`, `active`, `suspended`, `offboarded`), `two_factor_enabled`, `last_login_at`, timestamps, actors | One row per staff user; the principal row carries `kind = 'user'`. Built (slice 1): the columns follow Better Auth's user model so its adapter needs only the table name mapped; the password hash lives in `auth_accounts`. |
| `sessions` | `id`, `user_id`, `token`, `ip_address`, `user_agent`, `last_seen_at`, `expires_at`, `revoked_at`, `revoked_reason`, timestamps | Better Auth session store. Built: the token is stored as issued and the column is granted to `auth_service` only, so no request path can read it; Better Auth's idle window gives the 12 h limit and `current-principal.ts` enforces the 7 d absolute limit from `created_at`. No `totp_verified_at`: Better Auth creates no session until the second factor is verified. |
| `auth_accounts` | Better Auth `account`: `user_id`, `provider_id` (`credential`), `account_id`, `password` (Argon2id hash), token columns unused | Built. `auth_service` only. |
| `user_two_factor` | Better Auth `twoFactor`: `user_id`, `secret` (encrypted), `backup_codes` (encrypted), `verified`, `failed_verification_count`, `locked_until` | Built. Replaces `totp_recovery_codes`; backup codes are stored encrypted by the plugin rather than hashed (accepted). `auth_service` only. |
| `user_entity_roles` | `user_id`, `entity_id`, `role_id`, `team_id`, unique `(user_id, entity_id)` | The user's allowed entities are the rows here. |
| `mobile_devices` | `id`, `user_id`, `device_id`, `name`, `refresh_token_hash`, `refresh_family_id`, `refresh_expires_at`, `push_token`, `last_seen_at`, `revoked_at` | One row per installed field app; per-device revocation. |
| `auth_verifications` | Better Auth's verification store (`identifier`, `value`, `expires_at`) for set-password and reset links | Built. Rows expire; `auth_service` only. |

Policies (built in migration 0014): `auth_service` has full access to `users` (select, update), `sessions`, `auth_accounts`, `auth_verifications` and `user_two_factor`, and nothing on any business table. `app_user` reads `users` and `user_entity_roles` with any context, reads its own `sessions` rows or all of them with `admin.users.write:all` (column-level select, never `token`), writes `users` and `user_entity_roles` with `admin.users.write:all` (`user_entity_roles` alone grants delete, because the access list is replaced as a set), and revokes a session by updating `revoked_at` and `revoked_reason`. `auth_accounts`, `auth_verifications`, `user_two_factor` and `mobile_devices` are invisible to `app_user`. Principal resolution reads through `app.user_grants(user_id)`, a security-definer function executable by `app_user` only that returns status, preferences and one row per (entity, role, grant) and no secret column.

### 2.2 Better Auth configuration
- Email and password with Argon2id (m = 64 MiB, t = 3, p = 1), minimum 12 characters, breached-password check against the Have I Been Pwned range API (k-anonymity, no password leaves the server).
- Cloudflare Turnstile token verified server-side on login, password reset and the public lead form.
- Lockouts in Upstash Redis: per account and per IP. After 5 failures the next attempt waits 1 minute, doubling per further failure, capped at 60 minutes; the response is `rate_limited` with the catalogue sentence and `Retry-After`. Counters reset on success.
- Sessions: idle 12 h (Better Auth `expiresIn` with a 5-minute `updateAge`), absolute 7 d (checked by `current-principal.ts` from `created_at`, revoking the row with reason `absolute_expiry`), cookie `__Host-shakti-session` in production (`shakti.session_token` locally, where cookies cannot be Secure), HttpOnly, Secure, SameSite=Lax, origin checked on server actions. Rotation on privilege change: a role change, TOTP enrolment or password change revokes every other session of the user and re-issues the current one. Admins revoke sessions with `admin.session.revoke`.
- TOTP (Better Auth two-factor plugin) is mandatory for `executive`, `general_manager` and `accounts`. Enrolment is forced at first login; until `users.two_factor_enabled` is set, `currentPrincipal()` answers `unauthorized` with reason `totp_required` and the app routes to the enrolment screen; once enabled, Better Auth issues no session until the code is verified. Recovery codes as above; recovery mail through SES only.
- Password reset and invitations go by SES (the `Mailer` port; the console mailer prints the link until Phase 1); the invite creates `users` in `invited` status through `admin.user.invite`, the set-password link is Better Auth's reset flow, and the first password set moves the user to `active`. The first Executive of an environment comes from `pnpm --filter web invite-executive`. Lockouts and the principal cache use the `KeyValue` port: Upstash Redis when configured, an in-memory store locally and in CI.

### 2.3 Principal resolution
`resolvePrincipal(sessionOrToken, activeEntityId?)`, in `packages/domain/src/auth`:
1. Load the session (cookie token hash, or mobile access token claims), reject if revoked, idle-expired or absolute-expired; bump `last_seen_at` at most once a minute.
2. Load `user_entity_roles` with roles and grants.
3. Single-entity mode: `entityIds = [active]`, `roleKey` and grants from that row, `teamId` from that row.
4. All-entities mode: `entityIds` = every row's entity; grants = the intersection across rows, keeping the narrowest scope per key; `roleKey` = the role of the row with the fewest grants (display only); `teamId` null (team scope needs one entity).
5. Cache the result in Redis for 60 s keyed by session id; role change, suspension and revocation delete the key.

The security suite gets a `resolvePrincipal` test set: mixed roles yield the intersection, a suspended user resolves to nothing, a revoked session resolves to nothing.

### 2.4 Mobile tokens (`/api/v1/auth/mobile/*`)
- Access token: ES256 JWT signed with the BOS key pair (same pair as the Realtime token, `kid` in the header), 15 minutes, claims `sub` (user), `sid` (device), `entity_ids`, `role`, `exp`. Verified statelessly; device revocation checked from a 60 s Redis cache of `mobile_devices.revoked_at`.
- Refresh token: opaque 256-bit random, stored hashed, 30-day lifetime, rotated on every refresh within a `refresh_family_id`. A rotated token presented again revokes the whole family (reuse detection) and the device must sign in again.
- Minimum app version gate from `GET /me`.

### 2.5 Realtime JWT spike
`POST /api/v1/realtime/token` mints the ES256 JWT (`sub`, `entity_ids`, `role`, `exp` ≤ 15 min). The BOS serves `/.well-known/openid-configuration` and `/.well-known/jwks.json` with the current and next key. Supabase is registered with the BOS as a third-party auth provider. Pass criteria: a user subscribes to `user:{id}` and `entity:{id}:queue` for an entity in scope; a subscription to another user's or entity's channel is refused; the token is rejected by the Data API. Fallback if it fails within week 3: polling every 10 s for notifications (blueprint risk 15), recorded in the spike note.

### 2.6 Commands (week 3)
Domain commands (built in slice 1): `admin.user.invite`, `admin.user.role.set`, `admin.user.suspend`, `admin.user.reactivate`, `admin.session.revoke`. Better Auth endpoints called from server actions, because their state lives in tables `app_user` cannot write: sign-in, sign-out, set and reset password, change password, authenticator enrolment and verification; the lockout, Turnstile and audit rules (built in slice 2) run in Better Auth hooks. The before hook finds the person behind a request (the session, the pending second factor, or the set-password link while it is still unused) and the after hook writes the event with the request's address and browser, keyed by the request headers both hooks share. Slice 1b: `auth.mobile.token`, `auth.mobile.refresh`, `auth.mobile.revoke`, `realtime.token.issue`.

## 3. Audit log (week 3)

### 3.1 Table
Built (slice 2, migrations 0032 and 0033). `audit_logs`, partitioned by month on `created_at` with the key `(id, created_at)`, append-only. The partitions live in the schema `audit_partitions`, which no request role may use, so no row is reachable around the policies on the parent; a default partition takes any row whose month has no partition, so a missing partition never fails a command. `app.ensure_audit_partitions(3)` (migrator only) makes this month and the next three, and pg_cron runs it on the 25th:

`id`, `entity_id` (null for cross-entity admin commands), `actor_principal_id`, `actor_kind` (`user`, `agent`, `voice_session`), `on_behalf_of_user_id` (set when a voice session acts for a user), `command`, `aggregate_type`, `aggregate_id`, `outcome` (`ok`, `denied`, `failed`), `error_code`, `input_json`, `before_json`, `after_json`, `ip`, `device`, `request_id`, `created_at`.

Grants: `app_user` may insert (policy: `actor_principal_id = app.user_id()`, an entity in the request scope or none, never an `auth.*` event) and select with `audit.read` at entity scope (`entity_id` null rows need `audit.read:all`, and an empty scope reads nothing). `auth_service` may insert `auth.*` events of no entity and read nothing. `actor_principal_id` may be null only on an `auth.*` event (a failed sign-in for an unknown address). No update or delete; `app.raise_append_only()` trigger.

### 3.2 What the runner writes
`runCommand` requires an `AuditSink`; `executeCommand` passes `databaseAuditSink`, which writes through `ctx.tx`, so the audit row commits with the change or not at all. The web actions pass the caller's address and browser as `client`:
- one row per changed aggregate with `outcome = ok`, or one row for the call when the handler names none; `entity_id` is the aggregate's entity, or the request's single entity when the handler leaves it out;
- one row with `outcome = denied` when the permission guard, the request scope or a row policy refuses (written by `executeCommand` in its own short transaction after the rollback);
- one row with `outcome = failed` and the `DomainError` code when the handler, the DTO check or the audit and outbox writes throw (written after the rollback in its own transaction, without before/after);
- nothing for input that does not parse, since nothing ran; a failure to write a denied or failed row is logged and never replaces the original error.
- `before_json` and `after_json` come from the handler through `ctx.audit({ aggregateType, aggregateId, before, after })`; commands that touch several aggregates call it once per aggregate.

### 3.3 Redaction
`redactAuthEvent()` records an allow-list of fields per auth event (the email, the sign-in step, the second-factor method), so the one-time `code`, the password and the link token are never read; `redactForAudit()` applies a deny-by-pattern pass to command input and before/after (AUDIT M16), built from the real column and body names: `password`, `secret`, `backup_codes`, `token`, `identifier`, `newPassword`, `currentPassword`, `bank_json`, `api_key` and any name containing password, secret, token or api key are removed at any depth; business codes (`code` of an entity, item or stage) are kept; phone numbers and emails keep only the last four characters; `input_json` is the parsed command input after the same pass. Aadhaar never exists in any table (BLUEPRINT §7.5), so nothing about it can reach the audit. The suite asserts the deny list on a synthetic before/after that contains every listed field.

### 3.4 Reading
`queryAudit(ctx, { entityId?, aggregateType?, aggregateId?, actorPrincipalId?, command?, outcome?, from, to, cursor?, limit? })` (built; server action `listAuditLog`) with keyset pagination on `(created_at, id)` (text-form cursor, as in `listLeads`); the window is required and at most 93 days, so only its months' partitions are read. The Admin audit screen arrives with the week 4 app shell. Views of sensitive documents (Phase 1) and exports are recorded through the same runner path as commands with an empty change set.

## 4. Outbox, publisher and workers (week 3)

### 4.1 Table
Built (slice 3, migrations 0034 and 0035). `outbox_events`, append-only for `app_user`: `id` (UUIDv7), `sequence` (identity, ordering key), `entity_id`, `type`, `aggregate_type`, `aggregate_id`, `payload_json` (with `v: 1`), `created_at`, `published_at`, `attempts`, `last_error`, `dead_lettered_at`. Partial index on `published_at is null`. Column names follow ADR 0005 and DATABASE §6.10; ARCHITECTURE §6 has been aligned.

Append-only reconciled with delivery bookkeeping: a second role `outbox_publisher` (login, `nobypassrls`) holds `select` and column-level `update (published_at, attempts, last_error, dead_lettered_at)` on the table, with its own policies `outbox_events_publisher_read` and `outbox_events_publisher_update` (`to outbox_publisher using (true)`, since the table forces RLS and has no request context on that connection); the append-only trigger raises on delete and on any update that changes another column. `app_user` inserts only. The same pattern serves `webhook_inbox.processed_at` and `error` for the webhook worker in Phase 1.

### 4.2 Publisher
Built (slice 3, migrations 0034 and 0035). A route `POST /api/v1/workers/outbox/publish`, connected as `outbox_publisher`, nudged immediately after each command commits (`executeCommand`'s `onCommitted`: the server action publishes a QStash message to the same route; failures of the nudge are logged and harmless) and triggered by a QStash schedule every minute (`pnpm --filter web qstash-schedule`; QStash schedules are minute-granular). Without QStash (local development and CI) the nudge runs the publisher in the same process and nothing is sent. Each run: claim up to 100 rows `where published_at is null and dead_lettered_at is null order by sequence for update skip locked`; publish each to the QStash URL group `evt-<type>` with `Upstash-Deduplication-Id = id` and the payload `{ id, sequence, type, entityId, aggregateType, aggregateId, payload }`; on success set `published_at`; on failure increment `attempts`, store `last_error`; after 10 attempts set `dead_lettered_at`. An event type no worker listens to yet (`subscribed: false` in the catalogue, every type in Phase 0) is marked published without being sent, because a URL group with no endpoint refuses messages; a row that no longer fits the catalogue is dead-lettered at once. Metrics: every run logs its counts, and `/api/v1/health/ready` reports `outbox: down` when an event has waited more than five minutes; dead-letter alerts arrive with Sentry (Phase 1).

Ordering: QStash does not order across messages. Consumers that care (state notifications, agents) keep the last processed `sequence` per aggregate in Redis and drop older events. Idempotency: the worker checks `evt:{id}` in Redis (TTL 7 days) before running and sets it after.

### 4.3 Event catalogue
`packages/contracts/src/events/`: names are `<aggregate>.<verb_past>` (`crm.lead.created`, `pricing.price.changed`, `org.entity.updated`, `auth.session.revoked`, `sales.quote.sent`, `sales.order.confirmed`, `imports.job.committed`), each with a Zod payload schema and `v: 1`. `ctx.emit()` validates against the catalogue at emit time; an unknown type is an `internal` error in tests and CI.

### 4.4 Workers
`/api/v1/workers/*` per API §3.6: verify the QStash signature with the current and next keys, check the event id, run the command as the right principal (a named agent principal or the system principal `system:workers` with the permissions the job needs, never a cost permission), return 200 or a retryable 5xx. Dead letters and replay on the Integration Health page (`integrations.dlq.replay`, `admin.integrations.write`).

## 5. Idempotency keys (week 3)

API §1 requires an `Idempotency-Key` on mobile and connector calls, and FLD-02 allows five days offline, so the store is Postgres with Redis in front:

`idempotency_keys(principal_id, key, command, input_hash, status (`in_progress`, `done`), response_json, error_json, created_at, expires_at)`, primary key `(principal_id, key)`, retained 7 days, purged by pg_cron. The runner takes `idempotencyKey` in `RunOptions`: on a hit with the same input hash it replays the stored response or error; a hit with a different input hash answers `conflict` with reason `idempotency_mismatch`; an `in_progress` hit answers `conflict` with reason `concurrent_change`. Web server actions pass a key generated per form submission; ingest uses the provider event id. API §1 has been edited to say so.

## 6. Tax engine (week 5)

Full decision record in ADR 0007. Summary of the engine surface in `packages/domain/src/tax`:

| Function | Input | Output |
|---|---|---|
| `resolveRate(rates, { hsn, itemId, on })` | effective-dated rows, document date (IST) | the row (`tax_rate_id`, `rate_pct`) or `validation_failed` reason `tax_rate_missing` |
| `placeOfSupply({ siteStateCode, accountGstin, entityStateCode })` | | `{ stateCode, kind: 'intra' \| 'inter' }` |
| `compositeSplit(rule, taxablePaise)` | effective rule, taxable value | goods and services parts with their rates |
| `computeLine({ qty, unitPrice, rate, composite?, supply })` | | `taxable_value`, `goods_taxable`, `services_taxable`, `cgst`, `sgst`, `igst`, `line_total`, ids |
| `computeDocument(lines)` | computed lines | subtotal, tax totals, `round_off`, grand total |

Rules: integer paise inside; half-up rounding to the paisa per line and per tax amount; CGST and SGST rounded independently from the half rate; document total rounded to the rupee with `round_off`; item rate overrides HSN rate; composite supply only for lines flagged as works contract in `residential_rooftop` and `commercial_epc` with an effective rule; every line snapshots `tax_rate_id` and `composite_rule_id`. Place of supply: site state, else account GSTIN state, else entity state, which needs `customer_sites.state_code` and `accounts.billing_state_code` (DATABASE §6.2 edited). The CA confirms the method at the workshop against a golden set of worked examples that becomes the fixture file.

## 7. State machines (week 5 specifications and runtime)

### 7.1 Runtime
`packages/domain/src/state-machines/define-machine.ts`: `defineMachine({ name, states, initial, transitions: [{ from, event, to, permission, guard?, effects? }] })` and `transition(machine, record, event, ctx)` which checks the permission through `checkPermission`, runs the guard (pure, may use preloaded data), returns `{ to, effects }`; the command persists `state` and `state_changed_at`, applies effects, calls `ctx.audit()` and emits `<aggregate>.<event>`. Illegal transitions answer `conflict` with reason `<machine>_transition_not_allowed`. Machines are data and are rendered into the state-machine specification documents for review.

### 7.2 Opportunity
States: `open`, `nurture`, `won`, `lost`. Stage moves happen inside `open`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `stage.move` | open → open | `crm.lead.write` | stage exit rules of the current stage satisfied (`stage_exit_rules_json`: required fields present); target stage belongs to the pipeline | update `stage_id`; if the target stage is `qualified`, run handover |
| `assign` | open → open | `crm.lead.assign` | `locked_until` in the past, or caller holds `crm.lead.assign:team` or wider | set `owner_id`, `team_id`, `locked_until = now + lock period` (default 48 h, configurable per pipeline) |
| `nurture` | open → nurture | `crm.lead.write` | reason given | schedule nurture cadence (Workflow) |
| `reopen` | nurture, lost → open | `crm.lead.write` | lost within the last 30 days for `lost` | stage = first open stage |
| `win` | open → won | `crm.lead.write` | an accepted quote or a confirmed order references the opportunity | none |
| `lose` | open, nurture → lost | `crm.lead.write` | reason code given | none |

Handover on `qualified`: weighted round-robin over Lead Converters of the entity by presence, capacity and language and segment skills (TEL-02), assignment within 10 s, lock as above. A repeat enquiry with the same intent within 30 days attaches to the open opportunity (CRM-03) in `crm.lead.create` once dedupe lands (Phase 1).

### 7.3 Quote
States: `draft`, `sent`, `accepted`, `expired`, `superseded`, `withdrawn`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `create` | → draft | `sales.quote.create` | tier from account type; a current price list for the tier and entity; sizing complete for pump and rooftop segments; pump-curve bounds; DCR rule | lines priced from the list, tax computed, `valid_until = created date + 15 calendar days, end of day IST`, `quote_no` from the series |
| `send` | draft → sent | `sales.quote.send` | PDF rendered | WhatsApp dispatch, event |
| `accept` | sent → accepted | system or `sales.quote.send` | `now ≤ valid_until`, `accepted_via` recorded (WhatsApp reply, OTP, signed upload) | create sales order draft |
| `expire` | sent → expired | system | `now > valid_until` | daily job plus lazy check on read |
| `requote` | sent, expired → superseded | `sales.quote.create` | | new quote with current prices, `quote_versions` snapshot of the old |
| `withdraw` | draft, sent → withdrawn | `sales.quote.send` | reason | |

Acceptance after expiry answers `conflict` reason `quote_expired` and the app offers re-quote (SAL-05). Prices on lines are never accepted from input (SAL-03).

### 7.4 Sales order
States: `draft`, `confirmed`, `partially_dispatched`, `dispatched`, `invoiced`, `closed`, `cancelled`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `create` | → draft | `sales.order.create` | from an accepted quote, or a dealer account without a quote | lines copied with their tax snapshot; `so_no` from the series |
| `confirm` | draft → confirmed | `sales.order.confirm` | credit check for dealer accounts: block when outstanding + confirmed-unpaid orders + this order > `credit_limit`, or `oldest_overdue_days > credit_days`; the block names the limit or the invoice; bypass only with `credit_release_by` set by an Executive with a reason (audited) | reservations requested (Phase 3), event |
| `dispatch.partial`, `dispatch.complete` | confirmed → partially_dispatched → dispatched | driven by the dispatch machine (Phase 3) | e-way bill gate | |
| `invoice` | dispatched → invoiced | Tally sync (Phase 2) | voucher linked | |
| `close` | invoiced → closed | `sales.order.confirm` | payments settled | |
| `cancel` | draft, confirmed → cancelled | `sales.order.cancel` | reason; nothing dispatched | release reservations |

Exposure is per entity (`dealer_outstanding` is keyed by account and entity). Until Tally sync, outstanding is entered manually (Phase 1 note in the blueprint).

## 8. Import framework (week 5)

- Tables: `import_mapping_templates(id, kind, name, mapping_json, created_by)`; `import_jobs(id, entity_id, kind (`leads`, `accounts`, `items`, `tally_masters`), file_id, template_id, mapping_json, state (`uploaded`, `mapped`, `previewed`, `committing`, `committed`, `rolled_back`, `failed`), total_rows, valid_rows, committed_rows, created_by)`; `import_rows(job_id, row_no, raw_json, normalised_json, errors_json, dedupe_json, state (`pending`, `valid`, `invalid`, `committed`, `skipped`, `rolled_back`), created_type, created_id, committed_batch)`.
- Flow: upload through the pre-signed file path → mapping (saved templates) → validation preview through the same Zod inputs the commands use, with dedupe suggestions by phone and name → commit as a QStash worker in batches of 500 rows, each batch one transaction of commands with idempotency key `import:{job}:{row}`; a failed batch rolls back whole and the job stops at that batch (IMP-01) → rollback archives every `created_id` of the job in reverse order (masters and leads only in Phase 0 and 1; ledgers are not import targets).
- Performance target 50k rows in 5 minutes: four concurrent batch workers, one audit row per batch with the row range, per-row audit only for rows that changed existing records.
- Permission `imports.write` (Executive all, GM entity); every job is audited with counts and filter like exports.

## 9. Command list for weeks 3 to 5

Week 3: the nine auth and admin commands in §2.6 (five built in slice 1, four in slice 1b); `audit.query`; `outbox.publish` (worker); `integrations.dlq.replay`.
Week 5: `tax.rate.set`, `tax.composite.set` (Accounts); `crm.opportunity.stage.move`, `crm.opportunity.assign`, `crm.opportunity.nurture`, `crm.opportunity.reopen`, `crm.opportunity.win`, `crm.opportunity.lose`; `sales.quote.create`, `sales.quote.send`, `sales.quote.accept`, `sales.quote.requote`, `sales.quote.withdraw`; `sales.order.create`, `sales.order.confirm`, `sales.order.cancel`; `imports.job.create`, `imports.job.map`, `imports.job.preview`, `imports.job.commit`, `imports.job.rollback`.

Every command follows the existing pattern: strict input and DTO in contracts, `defineCommand`, registry entry, tests for denied, wrong entity and happy path, server action.

## 10. Test plan

- Security suite: every new table in `SHARED_TABLES` or `ENTITY_TABLES`; `auth_service` and `outbox_publisher` cannot read business tables; `app_user` cannot see `mobile_devices` or recovery codes; audit insert only by the actor; audit read by `audit.read` scope; outbox append-only for `app_user` and column-limited for the publisher; idempotency replay and mismatch; principal resolution for mixed roles, suspended users and revoked sessions.
- Domain unit tests: lockout schedule, session timeouts, refresh reuse detection, redaction deny list, tax engine fixture tables and golden set, every state-machine transition and every illegal one, credit check cases (limit, overdue, release), import validation and batch rollback.
- Spike notes: Realtime JWT with latency and pass or fail.

## 11. Document lines changed by this design

- SECURITY §3.2: `imports.write` row added.
- API §1: idempotency keys stored for 7 days in `idempotency_keys` with Redis in front; a repeat with a different body answers `conflict`.
- ARCHITECTURE §6: outbox column names aligned with ADR 0005; ADR 0007 linked in §13.
- DATABASE §6.1: `users.status` values, `mobile_devices`, `totp_recovery_codes`, `idempotency_keys` rows; §6.2: `customer_sites.state_code`, `accounts.billing_state_code`; §6.4: `quotes.round_off`, `quote_lines.goods_taxable` and `services_taxable`; §6.10: `outbox_events` delivery columns and the publisher role; §5: the publisher's column-level update as the one exception to append-only.

## 12. Open questions for the discovery workshop

1. CA: place of supply rule and rounding method in §6 (ADR 0007), plus the golden examples.
2. Handover lock period per pipeline (default 48 h) and the nurture cadence.
3. Whether dealer exposure counts confirmed but undispatched orders (this design says yes).
4. TOTP for the General Manager when the GM role is held only at one small entity (this design: still mandatory).
5. Numbering format for quotes, orders, proformas and challans (one function to change).
