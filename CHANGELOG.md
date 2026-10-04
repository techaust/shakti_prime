# Changelog — Shakti Prime BOS

One line per pull request merged into `main`, newest first, grouped by Phase 1 wave and Phase 0 week. At the end of a working session, add one line per pull request merged in it; the current state is in [docs/STATUS.md](docs/STATUS.md) and the owner's decisions in [docs/DECISIONS.md](docs/DECISIONS.md). Migration numbers are those on `main` after the merge.

## Contents

- [Phase 1](#phase-1): [status documents](#phase-1-status-documents) · [wave 2](#phase-1-wave-2) · [wave 1](#phase-1-wave-1) · [wave 0](#phase-1-wave-0)
- [Phase 0](#phase-0): [hosted environments and the close](#phase-0-hosted-environments-and-the-close) · [gap-closing waves](#phase-0-gap-closing-waves) · [completeness pass and tooling](#phase-0-completeness-pass-and-tooling) · [weeks 4 to 8](#phase-0-weeks-4-to-8) · [weeks 1 to 3](#phase-0-weeks-1-to-3) · [production-readiness audit](#phase-0-production-readiness-audit) · [before pull requests](#phase-0-before-pull-requests)

## Phase 1

### Phase 1 status documents

- **#90** (04-10-2026) Phase 1 status at 04-10-2026: counts 1,605 and 2,452, C1, X1 and C2 merged, migrations 0000 to 0089, the merge-and-renumber rule for slice branches.
- **#86** (03-10-2026) Phase 1 status at 03-10-2026.
- **#83** (03-10-2026) Phase 1 progress recorded in `CLAUDE.md`.

### Phase 1 wave 2

- **#89** (04-10-2026) C2 customer timeline: `activities` partitioned by month in the closed schema `crm_partitions` with the pg_cron job `activities-partitions` and `ctx.activity()`; tasks (the `task` state machine; `crm.task.create`, `.complete`, `.reschedule`, `.cancel`), tags (`crm.tag.create`, `.archive`, `crm.lead.tag`, `.untag`), `crm.note.add`, customer, contact and site edits (`crm.account.update`, `crm.contact.update`, `crm.site.upsert`), consents with proof through the uploads (`crm.consent.record`, `.withdraw`); the definers `app.customer_search_ids()`, `app.contact_phone_status()`, `app.tag_name_free()`; the queries `listCustomers`, `loadAccount360`, `listTimeline`, `listMyTasks`; the screens `/customers` and `/customers/[accountId]`, the customers list and Account 360 under 300 ms at the 95th percentile on the reader pool (`pnpm spike:account360`). Migrations 0075 to 0089. Dev and staging migrated through 0089.
- **#88** (04-10-2026) X1 role editor: an Executive replaces a staff role's grants (`admin.role.permissions.set`), the holder rules in the command (`roleMayHold()`, `PERMISSION_SCOPES`, `PLATFORM_ONLY_PERMISSIONS`, `EXECUTIVE_KEPT_GRANTS`) and in the trigger `role_permissions_holder_guard` with `app.role_may_hold()`, the Executive always keeping the admin grants, the holders signed out; the screens `/admin/roles` and `/admin/roles/[roleKey]`. Migrations 0073 and 0074.
- **#87** (03-10-2026) C1 catalogue and tax: item specifications per category (`packages/contracts/src/catalogue/specs.ts`), items, kits and pump curves, draft and approved price lists, kit prices and the price history; the commands `catalogue.item.create`, `.update`, `.archive`, `catalogue.kit.create`, `.update`, `.archive`, `catalogue.pump_curve.set`, `pricing.list.create`, `.approve`, `.archive`; the queries `listKits`, `getItem`, `getKit`, `listKitPrices`, `listPriceChanges`, `readTaxSettings`; the screens `/catalogue`, `/catalogue/kits` and `/settings/tax`; every catalogue change only in a request for every company; HSN codes of 4, 6 or 8 digits; the reader pool allowed to ask whether a request covers every company (0072). Migrations 0067 to 0072.

### Phase 1 wave 1

- **#85** (03-10-2026) P2 files and storage: the S3 store with pre-signed uploads and the local store (`apps/web/src/files`, `packages/domain/src/files`), the upload commands and routes, the uploader, the file checks worker (`apps/web/src/workers/files`), `FieldCipher` with KMS, the SES mailer `sesMailer`, `infra/aws/files.yaml`. Migrations 0065 and 0066. Dev and staging migrated through 0066.
- **#84** (03-10-2026) CI economy: a pull request that changes only documents runs the cheap jobs; end-to-end and Lighthouse on pull requests only; `.gitleaksignore` for an old test literal; the lint-only `braces` advisory GHSA-vfj7-8cjw-p6xm ignored (no patch).
- **#82** (30-09-2026) P1 observability and workers: Sentry with personal data scrubbed (`apps/web/src/observability`) and the outbox alert; the event workers (`apps/web/src/workers/events`, `/api/v1/workers/outbox/[type]`) with claimed ids and ordering per worker; the QStash failure callback (`/api/v1/workers/outbox/failed`); `system:workers` treated as an agent by the customer rules; Integration Health (`/admin/integrations`, `app.outbox_health()`); the audit archive (`app.detach_audit_partitions()`, schema `audit_archive`); the `app_reader` login role and pool. Migrations 0061 to 0064. Dev and staging migrated, seeded, health ok.
- **#81** (30-09-2026) P3 quality harness: Playwright journeys with axe (`apps/web/e2e`, `pnpm --filter web e2e` and `e2e:snap`) and Linux screenshots in three CI shards, Lighthouse on the public pages, the lighter shell (menus and toasts loaded on first use, `global-error-copy.ts`).

### Phase 1 wave 0

- **#80** (29-09-2026) The Phase 1 design, `docs/design/phase1.md`: 23 slices in six waves.
- **#79** (29-09-2026) The Phase 1 packages.

## Phase 0

Phase 0 closed on 29-09-2026 by the owner's decision at main `f0543b1` plus the hosted pull requests: migrations 0000 to 0060, security suite 1,216 (766 database, 308 domain, 142 web), unit tests about 2,116. Of the six exit-gate items the security suite and the tooling were met; the rest were deferred ([STATUS](docs/STATUS.md#deferred-phase-0-gate-items)).

### Phase 0 hosted environments and the close

- **#78** (29-09-2026) The hosted environments in DEPLOY; the Realtime spike deferred to the production site with the client's domain.
- **#77** (29-09-2026) Phase 0 closed by the owner's decision; `currentPhase` 1.
- **#76** (29-09-2026) Each hosted environment named by `BOS_ENVIRONMENT`.
- **#75** (29-09-2026) The migrate workflow seeds after migrating; the Supabase advisor notices recorded.
- **#74** (29-09-2026) Dev and staging migrated from suffixed repository secrets (GitHub's free plan has no environments). Supabase dev and staging in Mumbai, Vercel `shakti-prime-dev` and `shakti-prime-staging` in `bom1` on Hobby, Upstash Redis per environment in Mumbai, QStash in the EU region with the minute schedule on staging, Turnstile for both hostnames and the first Executive on staging followed with #74 to #76.

### Phase 0 gap-closing waves

- **#73** (29-09-2026) The last fixes of a targeted audit of #70 to #72 (0060): import batches take no number lock, so they never wait on a lead form or on another job's batches (batches of one job still take turns on the job row), and skip the set-based try when too little time is left; ids and codes kept whole by the redaction only when they look like codes; lease dead letters counted and logged; a malformed address marked on the forgotten-password form.
- **#72** (28-09-2026) Every document matched to the code of #70 and #71; list and search latency measured again.
- **#71** (28-09-2026) `executeQuery()` in a read-only transaction; the import fences closed on the schema path, relative files and `require` (`apps/web/src/lint-fences.test.ts`); a forgotten-password answer that waits only for the checks that refuse it (`requestResetInBackground`); audit text scrubbed like a log line; one request-id rule (`apps/web/src/request-id.ts`); worker and Realtime bodies capped before they are read (`apps/web/src/request-body.ts`).
- **#70** (28-09-2026) After a final adversarial audit (0058, 0059): the authenticator reset and a person with no role held to the request's companies; reporting reads role rows under the application's rule; an agent's lead handover never moves the customer; customers read only through leads that are not archived; a dead letter reset only through its replay (tied to the owner of `app.replay_dead_letter()`); the purge as a procedure that reports its failures to pg_cron; leads assigned only to active people (`app.user_is_active()`); a new number held by the lead form while it is checked; import batches numbered on the job (`import_jobs.batch_count`) and cut short row by row when their time is spent; each outbox lease counted as an attempt; an empty search path for `app.attach_account_entity()`.
- **#69** (28-09-2026) A new lead whose number belongs to a colleague's customer refused and routed in the lead form and in imports (`app.lead_phone_status()`); a handed-over lead takes its customer relationship with it (`app.hand_over_customer()`); a person reads the customer of any lead they can read in that company, never an agent; user and session writes scoped to the request's companies. Migrations 0055 to 0057.
- **#68** (28-09-2026) Every document matched to the code after the gap-closing waves.
- **#67** (28-09-2026) Outbox backoff and lease (`claimed_until`, `next_attempt_at`), publishing outside the transaction, readiness for a stalled publisher, a 30-day retention (`retention_runs`, pg_cron job `outbox-events-purge`). Migrations 0053 and 0054.
- **#66** (28-09-2026) Focus back to the opener after a dialog (`returnFocusTo`, `useFocusTargets` in `packages/ui/src/return-focus.ts`); every query timing line named (`query-names.test.ts`).
- **#65** (28-09-2026) Lead search through the trigram indexes under RLS (`app.lead_search_ids()`, 0052): within 300 ms at the 95th percentile at 50,000 leads for the texts the lists spike types, apart from short bursts on a busy machine, while three letters of a very common surname take about 0.6 seconds for an Executive (`docs/spikes/lists.md`).
- **#64** (28-09-2026) Browser code without Zod (lint rule `shakti/browser-contract-types`, values in `apps/web/src/screens/contract-values.ts`); the grant checks `visibleNav`, `visibleActions` and `canSearch` on the server in `screens/menu-access.ts`; the ⌘K palette, phone menu, company edit dialog, board dialogs, Activity detail sheet and `/design` palette preview loaded on first use through `next/dynamic`; `packages/ui` marked `"sideEffects": ["*.css"]`; staff pages at 243 to 261 kB.
- **#63** (28-09-2026) The JavaScript budget per page in CI (`pnpm --filter web js-budget` against `apps/web/js-budget.json`), the `command.completed` and `query.completed` timing lines, and the list and search latency spike (`pnpm spike:lists`).
- **#62** (28-09-2026) `tax_rates` and `composite_supply_rules` written only by a request for every company (0048); `user_entity_roles` scoped by company in `ENTITY_TABLES` with the definers `app.user_roles_outside_request()` and `app.active_executive_count()` (0049); `app.account_in_scope()` and `app.contact_in_scope()` for `app_user` only (0050); `contact_phones.e164_reversed` with its index (0051).
- **#61** (28-09-2026) `app/(bos)/error.tsx` inside the shell, the weight tokens 400, 510 and 590, board stages of 100 cards with "Load more", the source-rule tests over `apps/web` and `packages/ui`.
- **#60** (28-09-2026) The readiness route capped at 20 calls a minute per address and answering only ready or not; Vercel's `x-vercel-id` as the audited request id; the Aadhaar, UID, PAN, account number and IFSC fields removed from the audit and the logs; one answer and wait for a forgotten password, the mail sent after the answer.
- **#59** (28-09-2026) A deterministic web security suite; every table checked by role and company (`role-entity-matrix.test.ts` over `entityMatrixFixture`); `import-lead-parity.test.ts`; the agent refusal sweep over tax, price and catalogue commands.
- **#58** (28-09-2026) Imports refuse zip bombs (`checkZipArchive`) and store the file under its SHA-256 before `imports.job.create` records it; failed progress checks shown.

### Phase 0 completeness pass and tooling

- **#57** (28-09-2026) Phase 0 state; Amazon SES named as the mail service throughout.
- **#56** (28-09-2026) Every Phase 0 tool installed and passing a live call; the exit gate's tooling item met apart from `currentPhase`.
- **#55** (28-09-2026) The documents brought in line with #48 to #54, every later item given its phase, each person's next step in `docs/phase0/exit-gate-actions.md`.
- **#54** (28-09-2026) The definer guards of 0047, the audited sign-in lock clear (`admin.user.lock.clear`), a label for every audited field, the company GSTIN and registered address in `org.entity.update`.
- **#53** (28-09-2026) Search that finds spelling variants (pg_trgm in ⌘K and people search, `packages/domain/src/queries/name-match.ts`); the four list grids sorted on the server with keyset cursors (`keyset-sort.ts`); the owner `Avatar` on board cards.
- **#52** (28-09-2026) ⌘K search and actions (`searchLeads`, `searchPeople`); the high-contrast variant (`theme-light-high`, `theme-dark-high`) saved per person (`users.contrast`, `app.set_own_contrast()`, `profile.contrast.set`); the `/design` board, print and toast previews; `BoardColumn` and `BoardCard` in `packages/ui`.
- **#51** (28-09-2026) Set-based import commits (`packages/domain/src/imports/commit-leads.ts`, falling back to row by row: 50,000 rows uploaded, previewed and committed in about 3½ minutes locally); dedupe by name and village; the agent refusal sweep; the audited `realtime.token.issue`.
- **#50** (28-09-2026) Page guards that match the menu (`screenAccess()`, `screenTitle()`, `navRequires()`: a page the caller may not open shows the not-found screen); auth actions that never throw; the Activity log naming every command, auth event and event type; worker request ids; the app icon from the tokens.
- **#49** (28-09-2026) The data grid's column chooser, sorting and selection (`packages/ui/src/data-grid.tsx`) and saved views per person (`saved_views`, own-row RLS, `profile.view.save`, `profile.view.delete`, the Views menu).
- **#48** (28-09-2026) The documents brought in line with the code, later-phase items recorded against their phases, the planned tables drawn in the ERD.

### Phase 0 weeks 4 to 8

- **#47** (27-09-2026) Phase 0 build work closed out in `CLAUDE.md`, the exit gate and the prototype's launch entry.
- **#46** (27-09-2026) Week 5: the leads board at `/leads/board` with stage moves through the opportunity commands.
- **#45** (27-09-2026) Week 5: `crm.opportunity.stage.move`, `.assign`, `.nurture`, `.reopen`, `.win` (refused with `win_needs_order` until quotes exist) and `.lose`, `tax.rate.set`, `tax.composite.set`, `integrations.dlq.replay` (definer `app.replay_dead_letter()`); the permissions `inventory.warranty.write`, `finance.expense.submit`, `finance.expense.verify`, `integrations.dlq.replay`; the nurture state, pipeline lock hours and place-of-supply columns.
- **#44** (27-09-2026) Week 5: the Imports screens (upload, match columns, check rows, add and undo).
- **#43** (27-09-2026) Week 6: the Aadhaar QR cover before a photo leaves the masker; spike-only libraries as development dependencies.
- **#42** (27-09-2026) Week 4: the app shell (`apps/web/src/nav.ts` filtered by grants, company switcher, ⌘K, profile menu, the proxy's session-cookie check) and the Team members, Activity log, Leads, Companies, Price lists, profile and `/design` screens under `apps/web/src/app/(bos)`, one idempotency key per form; checked in the browser.
- **#41** (27-09-2026) Week 5: the import framework (`files`, `import_mapping_templates`, `import_jobs`, `import_rows`, the `imports.job.*` commands, batches of 500 with one audit row per batch, the QStash-signed `/api/v1/workers/imports/commit`, a local `FileStore` until S3).
- **#40** (27-09-2026) Week 6: the Realtime ES256 token, key list and discovery routes (`apps/web/src/realtime`, `jose`); the Exotel, WhatsApp, voice and Tally harnesses (`apps/web/src/integrations`, pure rules in `packages/domain/src/telecom` and `src/tally`), ready to run once the vendor sandboxes exist; atomic lockout counts.
- **#39** (27-09-2026) Weeks 7 and 8: the test strategy `docs/TESTING.md`, DATABASE §6 fixes, worker and admin contracts, ADR and path corrections.
- **#38** (27-09-2026) Week 4: the UI kit `packages/ui` (shadcn on Radix, tokens only), the read queries and the `ActionResult` envelope for every action (`apps/web/src/actions/result.ts`).
- **#37** (27-09-2026) Week 6: the Chromium print and QR-label spike passed its rendering checks with numbers (`apps/web/src/print`, Inter under the SIL OFL); the OCR masking spike ran on generated photos (`apps/web/src/workers/ocr`, `packages/domain/src/privacy`).
- **#36** (27-09-2026) Week 5: the tax engine (`packages/domain/src/tax`, bigint paise, `workshop-defaults.ts`; golden set awaiting the CA), the state-machine runtime and 13 machines with generated specifications (`docs/state-machines/`), the credit check.
- **#35** (27-09-2026) Weeks 7 and 8: Zod contracts for every planned `/api/v1` route with fixtures (`packages/contracts/src/api`), the generated ERD and data dictionary (`pnpm db:docs`), ADRs 0009 to 0013 as Proposed.
- **#34** (27-09-2026) Weeks 7 and 8: the client packs (workshop, vendor quotes, sign-off, review) and the clickable prototype.

### Phase 0 weeks 1 to 3

- **#33** (27-09-2026) The authenticator reset `admin.user.two_factor.reset`: an Executive removes another user's lost authenticator app through the definer `app.reset_two_factor()`, every session revoked with reason `totp_reset`, the user emailed, a new app enrolled at the next sign-in.
- **#32** (27-09-2026) The merge-on-green workflow (`.github/workflows/automerge.yml`).
- **#31** (27-09-2026) Idempotency keys: `idempotency_keys` with own-row RLS, claimed and completed in the command's own transaction by `runCommand` with `RunOptions.idempotencyKey`, a replay returning the stored DTO, `idempotency_mismatch` for other input, a daily pg_cron purge; server actions take the key as an optional second argument.
- **#30** (27-09-2026) The outbox: `outbox_events` insert-only for `app_user`, read and marked delivered only by the `outbox_publisher` role; the event catalogue in `@shakti/contracts` that `ctx.emit()` checks; the runner's required `OutboxSink`; `runOutboxPublisher` with skip-locked claims, one QStash batch per run and dead letters after ten attempts; the QStash-signed `POST /api/v1/workers/outbox/publish`, the nudge after each command through `commandOptions()`, the schedule script `qstash-schedule`, the `outbox` readiness check.
- **#29** (27-09-2026) Week 3 slice 2 recorded as merged.
- **#28** (27-09-2026) The address and browser of a password set recorded.
- **#27** (27-09-2026) The audit trail: `audit_logs` partitioned by month in the schema `audit_partitions` with `app.ensure_audit_partitions()` on pg_cron, append-only, insert-own and `audit.read` policies; the runner's required `AuditSink` writing one redacted row per changed aggregate through `ctx.audit()`; denied and failed calls recorded by `executeCommand` after the rollback; the caller's address, browser and request id from `requestMeta()`; sign-in and account events from the Better Auth hooks through `auth_service`; `queryAudit` and the `listAuditLog` action.
- **#26** (27-09-2026) The documents synchronised after the audit.

### Phase 0 production-readiness audit

`AUDIT.md`, 108 findings, worked through in batches; §8 of it records where each landed.

- **#25** (27-09-2026) Batch 15: untested paths and the remaining integrity findings; `pnpm coverage`.
- **#24** (27-09-2026) Batch 14: the documents aligned with the code.
- **#23**, **#22**, **#21** (27-09-2026) Dependabot: `actions/checkout` 7.0.1, `pnpm/action-setup` 6.1.0, `actions/setup-node` 7.0.0.
- **#20** (27-09-2026) Batch 13: sign-in screen polish and the nonce CSP in `src/proxy.ts`.
- **#19** (27-09-2026) Batch 12: pre-hosting DevOps: `pnpm db:verify`, the migrate and weekly audit workflows, the deployment runbook `docs/runbooks/DEPLOY.md`.
- **#18** (27-09-2026) Batch 11: architecture guardrails.
- **#17** (27-09-2026) Batch 10: customer and lead reads that scale.
- **#16** (27-09-2026) Batch 9: onboarding and lead flows.
- **#15** (27-09-2026) Batch 8: error handling and observability: the redacting JSON logger and `onRequestError`.
- **#14** (27-09-2026) Batch 7: sign-in hardening: the sign-in guard per account and address, the owner emailed on every tenth failure.
- **#13** (27-09-2026) Batch 6: database hardening before hosting: `app.uuid_v7()`, the price-history trigger on `price_list_items`.
- **#12** (27-09-2026) Batch 5: the Linear design profile, generated themes and a saved theme switch (`profile.theme.set`, `app.set_own_theme()`).
- **#11** (27-09-2026) The English interface with Hinglish only for spoken channels (ADR 0014).
- **#10** (27-09-2026) Security suite completeness, write policies of the access tables, the permission matrix checked against SECURITY §3.2.
- **#8** (27-09-2026) A stale session cookie no longer blocks sign-in; admin and shared prices stay in scope.
- **#7** (27-09-2026) The Upstash key-value store returns the stored strings; cache failures are misses.
- **#6** (27-09-2026) The production-readiness audit `AUDIT.md`, the English interface with Hinglish speech (ADR 0014), the Linear design profile.
- **#5** (27-09-2026) Session rows aged on the suite clock; one CI run per push to `main`.

Pull requests #1 to #4 and #9 have no merge on `main`.

### Phase 0 before pull requests

Committed straight to `main` on 26-09 and 27-09-2026, before the merge-on-green workflow:

- The blueprint, module documents, design system and Claude Code tooling; ADRs 0001 to 0006; the pnpm and Turborepo workspace; design tokens with the contrast test; the contracts (errors, ids, permissions, roles, principal, first DTOs); the copy lint; CI (lint, typecheck, tests, security suite, copy lint).
- The org core (`entities`, `principals`, `roles`, `permissions`, `role_permissions`) with the request context, fail-closed RLS and the security suite; the command runner with `org.entity.update`; the Next.js app pinned to `bom1` with the health routes.
- The CRM core (`teams`, `lead_sources`, `pipelines`, `pipeline_stages`, `contacts`, `contact_phones`, `accounts`, `opportunities`, `consents` and more) with own, team and entity scope; `crm.lead.create` and the keyset `listLeads`.
- The catalogue, pricing, tax and numbering tables (`items`, `pump_curves`, `item_costs` with the cost gate, `kits`, `kit_components`, `price_tiers`, `price_lists`, `price_list_items`, `price_change_log` append-only, `tax_rates`, `composite_supply_rules`, `document_sequences` with `app.next_document_no()`); `pricing.price.set`, `listItems`, `listEntities`.
- Week 3 slice 1, identity: `users` and `user_entity_roles` under `app_user`; `sessions`, `auth_accounts`, `auth_verifications`, `user_two_factor` under the `auth_service` role; Better Auth with Argon2id, the breached-password check, Turnstile, exponential lockouts and per-address request caps, revoked sessions refused on every route, mandatory TOTP with backup codes for Executive, GM and Accounts; principal resolution with narrowest-role-wins through `app.user_grants()`; the `KeyValue` and `Mailer` ports; the seven `admin.*` commands; `currentPrincipal()`; the public landing, sign-in, forgotten-password, set-password, two-factor and home screens.
- One customer record for the group with a relationship per company (ADR 0008): `account_entities`, `account_contacts`, `customer_sites`, `app.attach_account_entity()`, `app.account_in_scope()`, `app.contact_in_scope()`, the trigger `app.ensure_account_entity()`.
- Three reviews (`docs/reviews/`) and their fixes: child write scope, exact keyset cursor, database error mapping, numbering privileges, the testing-import fence, entity-consistent child keys, foreign-key indexes, customer-link scope, session revocation, admin guards, the security headers, the auth instance made on first use so `next build` needs no environment.
