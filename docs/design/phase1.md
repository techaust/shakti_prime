# Backend and product design: Phase 1 (MVP)

Date: 29-09-2026 · last updated 04-10-2026. Status: approved by the owner on 29-09-2026; built slice by slice in the order of §3, each slice recording what it built here in the same pull request; progress is in [STATUS](../STATUS.md). Governing documents: BLUEPRINT §6, §8.1 to §8.3, §8.10 to §8.12, §9.1, §9.3, §14 and §17; ROADMAP §3; PRD §4 and §6; DESIGN.md; ARCHITECTURE; DATABASE; API; SECURITY; TESTING; `docs/design/backend-weeks-3-5.md`. Where this design settles something the documents left open, the section says so; `docs/BLUEPRINT.md` governs on any conflict.

## 1. Scope
**In Phase 1:**
- ingestion: walk-in, manual, import and referral-code ingestion with PIN resolution; duplicate cards with audited merge and unmerge;
- CRM: four pipelines with stages and exit rules an Executive edits; rules-based scoring; Account 360; tasks and callbacks; consent with evidence and withdrawal;
- calling: the Cold Caller queue and workspace with manual call logging, dispositions, retries and nurture; weighted round-robin handover with the ownership lock; the Lead Converter workspace (board, sizing, quote builder and next-best-action on one screen); targets and leaderboards;
- catalogue and sales: items, HSN, kits sold as bundles and pump curves; Price Master tiers; the tax rate and composite-supply screens; TDH and kW sizing; quotes with PDF; sales orders; dealer credit with manual outstanding; referral commissions accrued when an order is confirmed;
- platform and AI: notifications, browser push, SLA escalation and the Agent Inbox; Knowledge Vault uploads with embeddings; data migration; the Triage agent in shadow mode;
- every item Phase 0 carried into Phase 1 (each open one, with its slice, in [STATUS, Open follow-ups](../STATUS.md#open-follow-ups)).

**In later phases (BLUEPRINT §14):** customer loans (Phase 4); click-to-dial, TRAI hours, DND scrubbing and screen-pop (Phase 2, with Exotel); quote dispatch and acceptance on WhatsApp (Phase 2), so Phase 1 accepts a quote by a signed copy that staff upload; stock availability on quotes (Phase 3); Playbook review and Ask the Business (Phase 2); commission release on payment (Phase 5, with the Tally receipts).

## 2. Decisions taken with the owner on 29-09-2026
- **PDF hosting (ADR 0009):** documents render in a Vercel function in `bom1`, with `playwright-core` driving the serverless Chromium build `@sparticuz/chromium`; the render is measured on the dev deployment before quotes depend on it.
- **Caller scripts:** files in `packages/contracts/src/templates/scripts`, one per segment with `hinglish` and `en` variants, checked by the copy lint (DESIGN.md §11.4); the wording comes from the sales head (workshop CALL-2).
- **Notifications before Realtime:** the notification centre polls every 15 seconds while its tab is visible, the fallback BLUEPRINT risk 15 names, until the Realtime spike runs on the production domain; switching to Realtime changes no table.
- **Nurture cadences** are follow-up tasks created when a lead moves to nurture, so they are visible, reassignable and need no workflow engine; the Triage agent runs as one QStash step. No `@upstash/workflow` in Phase 1.
- **Build order and agents:** three building agents and one reviewer at a time; migrations are numbered at merge in merge order.

## 3. Slices
Each slice is vertical: contract → schema, RLS and grants → command → server action or route → screen → end-to-end test, with its documents. A wave is a dependency tier.

The Requirements column names the PRD requirements each slice delivers (NFR IDs are PRD §5), in whole or in the part PRD §6 places in Phase 1 (PRD §8 traces each requirement to its tests). Progress per slice is in [STATUS](../STATUS.md).

| Wave | Slice | Needs | Requirements |
|---|---|---|---|
| 1 | P3 Quality harness | — | NFR-10 and NFR-01 (axe checks, JavaScript budget) |
| 1 | P1 Observability and workers | — | NFR-12; the delivery check behind TEL-02's 10 seconds (NFR-01) |
| 1 | P2 Files and storage | — | CRM-10 (consent proof uploads), AI-01 (vault uploads) |
| 2 | C1 Catalogue and tax | P3 | INV-01 (the minimal catalogue), SAL-01, SAL-02 |
| 2 | X1 Role permission editor | P3 | NFR-04 (the permission matrix an Executive edits, BLUEPRINT §7.1) |
| 2 | P2b Imports upgrade | P3, P2 | IMP-01, CRM-02 |
| 2 | P4 Print and letterhead | P3, P2, P1 | SAL-05 (the branded PDF) |
| 2 | C2 Customer timeline | P3, P2 | CRM-04, CRM-07, CRM-10 |
| 2 | C3 Pipelines, scoring and referrals | P3 | CRM-01 (walk-in and referral codes), CRM-05, CRM-06, CRM-09 (codes and rules) |
| 2 | C4 Sizing | P3, C1 | SAL-04 (sizing and its bounds) |
| 3 | AI0 Agent runtime and Inbox | P1 | AI-04 (Inbox, autonomy, kill switches, budgets) |
| 3 | T1 Cold Caller workspace | P1, C2, C3 | TEL-01 |
| 3 | S1 Quotes | C1, C4, P4 | SAL-03, SAL-04, RPT-03 (quote numbers) |
| 3 | D1 Duplicates | C2 | CRM-03 |
| 4 | N1 Notifications | AI0, T1 | RPT-04 |
| 4 | T2 Handover | N1 | TEL-02 |
| 4 | S2 Orders, acceptance and credit | S1, C3 | SAL-05 (signed copy), SAL-06, SAL-07, CRM-09 (accrual) |
| 4 | K1 Knowledge Vault | P2, AI0 | AI-01 |
| 5 | L1 Lead Converter workspace | T2, S2, C4 | TEL-03 |
| 5 | R1 Targets and home pages | T1, S2 | TEL-06, RPT-01 |
| 5 | A1 Triage in shadow | N1, D1, C3 | AI-04 (Triage in shadow), AI-05 |
| 6 | M1 Migration and UAT packs | all | IMP-02 |
| 6 | G1 Production readiness | all | NFR-03 and NFR-13 |

One slice per wave owns `crm.lead.create`, `crm.opportunity.stage.move` and the board: C2 in wave 2 (C3 reaches lead creation through `applyLeadAttribution()` in its own file, called from one line), D1 in wave 3.

## 4. New permissions
Each gets a row in SECURITY §3.2, its seed in `packages/db/seeds/role-permissions.ts` and its oracle case, in the slice that first uses it. The table names every staff role and the agents; a dash is no grant, and no agent holds any of the five.

| Permission | Executive | GM | Sales Lead | CC | LC | Store | Inventory | Project Mgr | Field | Accounts | HR | Agents | Slice |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `crm.config.write` (pipelines, stages, exit rules, dispositions, score rules, SLA) | all | – | – | – | – | – | – | – | – | – | – | – | C3 |
| `calls.log` | all | entity | team | own | own | own | – | – | – | – | – | – | T1 |
| `sales.targets.write` | all | entity | team | – | – | – | – | – | – | – | – | – | R1 |
| `sales.credit.write` (dealer terms, manual outstanding) | all | – | – | – | – | – | – | – | – | entity | – | – | S2 |
| `knowledge.vault.write` | all | all | – | – | – | – | – | – | – | – | – | – | K1 |

Caller profiles are written with `crm.lead.assign`. The system principal `system:workers` (P1) holds only the grants its jobs need, listed in SECURITY §3.3, never a cost, admin or sensitive-document permission, and joins the agent refusal sweep.

## 5. Wave 1

### 5.1 P3 Quality harness
- Playwright in `apps/web/e2e` with `playwright.config.ts`; a global setup that migrates and seeds a dedicated database and creates one user per role in each company, the Executive, GM and Accounts users with an authenticator app enrolled from a known test secret so the journey can type a code; sign-in once per role, stored as a storage state.
- Helpers: `expectNoAxeViolations(page)` (`@axe-core/playwright`, WCAG 2.1 AA), `snap(page, name)` taking light, dark and 400 px captures.
- Snapshots are made and compared only inside the pinned Linux Playwright image, so a Windows machine never writes a baseline; `pnpm --filter web e2e:snap` runs the image locally.
- Lighthouse runs as a pinned GitHub Action against the production build on the public pages (landing and sign-in), with budgets for performance, accessibility and best practice; a signed-in staff page is left out, because its session cookie would sit in the Lighthouse settings and so in the uploaded results.
- CI job `e2e` on every pull request that changes code (pushes to `main` skip it, ADR 0017): Postgres service, seed, `next build` and `next start`, the journeys, the axe checks, the snapshots; artefacts on failure.
- Every existing screen gets its journey and snapshots: sign-in, forgotten password, two-factor, home, leads list, board, new lead, Price Master, imports, team members, Activity log, companies, profile, `/design`.
- Shell diet: the company switcher's and profile menu's Radix menus load on first use behind buttons drawn at once, toasts come from a region fetched once the page is idle (`toast` waits for it), the last-resort error page carries only its own sentences instead of the whole catalogue, and the design board's contrast table is measured on the server; every staff page's first load is then under the 250 kB aim.
**Built (P3, #81):**
- Playwright in `apps/web/e2e` (`playwright.config.ts`, the projects `desktop-light`, `desktop-dark` and `phone` at 400 px), the seed `e2e/setup/seed.ts`, the sign-in per role in `auth.setup.ts` with the authenticator codes from `support/totp.ts`, and `pnpm --filter web e2e`;
- the helpers in `e2e/support` (`axe.ts`, `snap.ts`, `sign-in.ts`, `users.ts`), and `pnpm --filter web e2e:snap`, which runs the journeys in the pinned Linux Playwright image, the only place baselines are written (`e2e/__screenshots__`);
- the CI job `e2e` in three shards, one per project, and the job `lighthouse` with `apps/web/lighthouserc.json` on the public pages;
- the lighter shell: the menus and toasts loaded on first use, and the last-resort error page with only its own sentences (`global-error-copy.ts`).


### 5.2 P1 Observability and workers
- **Sentry** (`@sentry/nextjs`, the group's US-region organisation): server and edge through `instrumentation.ts`; browser errors through a client loaded after the page is interactive, so first-load JavaScript does not grow; `sendDefaultPii: false`; `beforeSend` and `beforeSendTransaction` pass every event through the logger's redaction (`packages/domain/src/ports/logger.ts`), drop cookies, headers and bodies, and keep only the principal id and the request id; `release` from the commit, `environment` from `BOS_ENVIRONMENT`. Without `SENTRY_DSN` Sentry stays off (local and CI). CSP `connect-src` gains the ingest host.
- **Outbox alert:** a publisher run that dead-letters an event, or fails three runs in a row, reports to Sentry with counts and ids only; an alert rule notifies the owner. Readiness keeps its own check.
- **`system:workers`:** a principal and role seeded with fixed grants; event workers run commands as it.
- **Event workers:** `POST /api/v1/workers/outbox/[type]` verifies the QStash signature after the 4 KiB body check, parses `OutboxEventDelivery`, drops an event whose `evt:{id}` key exists in Redis (7 days, set after success) and an event older than the last sequence seen for its aggregate, then calls the handler registered for the type in `apps/web/src/workers/events/registry.ts`. A type turns `subscribed: true` in the catalogue with its handler; the publisher makes the type's QStash URL group `evt-<type>` itself before its first event is sent (`apps/web/src/workers/qstash.ts`), so no group is made by hand. Without QStash, the publisher delivers subscribed types to their handlers in process.
- **Delivery check:** the Executive's "Check delivery speed" on Integration health emits `platform.probe.requested`; its handler records the arrival, and the page shows the time from commit to worker, the measure the handover's 10-second target rests on.
- **Integration health** at `/admin/integrations` (`admin.integrations.write`) and `GET /api/v1/admin/integrations`, `POST /api/v1/admin/integrations/replay`: pending, due and dead-lettered events by type, dead letters paged with replay, the last publisher run, the delivery check; AI spend per agent joins with A1, webhook counts with Phase 2. `app_user` reads no outbox row: the page reads through the definer `app.outbox_health()`, which checks `admin.integrations.write:all` and returns counts, ids, types and errors, never a payload.
- **Retention:** `app.detach_audit_partitions()` detaches `audit_logs` partitions older than eight years into the closed schema `audit_archive`, run monthly by pg_cron and logged in `retention_runs`. The purge on the hosted pg_cron is confirmed ([DEPLOY §2](../runbooks/DEPLOY.md#2-every-deploy) step 5).
- **`app_reader`:** a login role with `select` only, under the same policies, with its own pool (`DATABASE_URL_READER`); `executeQuery()` uses it when it is set and falls back to `app_user` in a read-only transaction when it is not. The role is listed in `ensureRoles()`, `requireEnv()`, `turbo.json`, `ci.yml`, `migrate.yml`, `.env.example` and DEPLOY.
**Built:**
- Sentry in `apps/web/src/instrumentation.ts` and `apps/web/src/observability` (the scrubber `sentry-scrub.ts` over `@shakti/domain/redaction`, the options, the server start and request-error report, the principal tag, the browser start), the loader `components/observability/sentry-loader.tsx` rendered by the root providers, the ingest host in `csp.ts` only with a DSN, and `withSentryConfig` in `next.config.ts` only with `SENTRY_AUTH_TOKEN`;
- the outbox alerts and the last run in `apps/web/src/workers/outbox.ts` (`onDeadLettered` in the domain publisher) with the alert sink `observability/alerts.ts`;
- the role key `system:workers`, principal kind `system`, its seeded role and principal and `SYSTEM_MATRIX` (its first grant, `files.process:all`, came with P2), in the agent refusal sweep;
- the event worker route `app/api/v1/workers/outbox/[type]/route.ts`, `workers/events` (`deliver.ts`, `registry.ts`, `probe.ts`, `system-principal.ts`) and the in-process publisher without a queue;
- `platform.probe.run` and `platform.probe.requested`, the first subscribed type;
- `/admin/integrations` (menu item Integration health), the actions in `actions/integrations.ts`, the routes `GET /api/v1/admin/integrations` and `POST /api/v1/admin/integrations/replay` with the contract extended by the outbox by type, the last run, the delivery check and each dead letter's error code;
- `app.outbox_health()`, `audit_archive` with `app.detach_audit_partitions()` and the pg_cron job `audit-logs-detach`, and `app_reader` with its grants and policies (migrations 0061 to 0063);
- ordering per worker (`every` by default, `latest-only` keyed by type and aggregate), the event id claimed with `SET NX` and a lease and the latest sequence raised in one step (`KeyValue.setIfAbsent` and `raiseTo`), every worker failure retried but a final refusal, the failure callback `POST /api/v1/workers/outbox/failed` holding an event back as a dead letter (`holdBackFailedEvent`, the outbox trigger allowing exactly that change), and `system:workers` held to an agent's customer rules (migration 0064);
- the journey `apps/web/e2e/integrations.spec.ts` (the counts, the held-back update, the delivery check in process, Send again, axe and the three snapshots, and the not-found screen for a GM).

### 5.3 P2 Files and storage
- **`FileStore` port** gains `presignPut`, `presignGet`, `head`, `tags` and `delete`; `s3FileStore` (SSE-KMS with the environment's key, 15-minute URLs, content type and length bound into the signature) and `localDiskFileStore` with a development-only upload route, so the browser flow works without AWS.
- **Upload flow:** `files.upload.begin` (purpose, company, name, type, size, SHA-256) records the row as `pending` and answers the pre-signed PUT; the browser uploads; `files.upload.complete` checks the object's size and hash and emits `files.file.uploaded`. Each purpose names the permission that may upload it and read it: `quote_pdf`, `signed_quote`, `entity_logo`, `letterhead`, `knowledge`, `consent_evidence`, `import`.
- **Checks before `ready`:** the worker of `files.file.uploaded` (`apps/web/src/workers/files`, reached through `/api/v1/workers/outbox/:type`) reads the GuardDuty Malware Protection tag on the object (`NO_THREATS_FOUND` passes; a threat marks the file `rejected`); images are re-encoded with `sharp`, which drops embedded data; PDFs are checked for their header, size and the absence of scripts; files that may reach a model (vault photos and scans) pass the OCR masking of the Phase 0 spike (`apps/web/src/workers/ocr`), before `ready`. Locally, where no scanner exists, a file is marked `not_scanned` and only a local environment accepts it.
- **Uploader** in `packages/ui`: file picker with type and size limits, progress, retry, and the final state in words.
- **Field encryption:** a `FieldCipher` port (AES-256-GCM with a data key from KMS; a key from `FIELD_ENCRYPTION_KEY` locally and in CI) used for bank details.
- **Mail:** `sesMailer` behind `Mailer` (`MAILER=ses`, `SES_FROM`, region `ap-south-1`); production still waits for the client's verified domain.
**Built (P2):**
- the port and both stores (`packages/domain/src/ports/file-store.ts`, `apps/web/src/files/s3-store.ts`, the development route `/api/v1/files/local/<token>`, `fileStore()`);
- `files.purpose` with six purposes beside `import` and the seven field purposes of Phase 0, `status` with `scanned` and `not_scanned`, and `app.file_purpose_grant()` with the policies, the column grants and the guard trigger (the migrations after 0060), mirrored by `files/purposes.ts` and `files/limits.ts`;
- the commands `files.upload.begin` and `files.upload.complete` (the permission their input names, `PermissionByInput`) and the worker's `files.file.mark_scanned`, `files.file.mark_ready` and `files.file.reject` on the `file_upload` machine, with the permission `files.process`, which no person's role holds and `system:workers` holds at `all`;
- the event `files.file.uploaded`, subscribed, with the checks as its worker `handleFileUploaded` in `apps/web/src/workers/files` running as `system:workers` (`files.process:all`), and `files.file.recheck` behind Check files again on Integration health;
- the publisher makes each subscribed type's queue group itself;
- the session routes `POST /api/v1/files/presign` and `/files/:id/complete` and the screens' actions;
- the `Uploader` in `packages/ui` and the logo and letterhead uploads on Settings › Companies, which store `files` rows only until P4 adds the company columns;
- the `FieldCipher` with KMS and the local key;
- `sesMailer`;
- the stack `infra/aws/files.yaml` with `docs/runbooks/files-setup.md`.

A quote's PDF is stored only by the render worker and a signed quote with `sales.quote.send`. Pending uploads that never complete stay as `pending` rows; the sweep that removes them is recorded for P2b. The vault purpose stays closed to requests until K1 adds `knowledge.vault.write`, and a vault PDF (a scan) waits for K1's extraction: only vault photos are masked here.

## 6. Wave 2

### 6.1 C1 Catalogue and tax
- Commands: `catalogue.item.create`, `.update`, `.archive`; `catalogue.kit.create`, `.update` (components as a set), `.archive`; `catalogue.pump_curve.set` (the curve as a set of points, head falling as flow rises); `pricing.list.create` (a new version for a tier and optionally a company, from a date, copied from the list in force the day before it starts), `pricing.list.approve`, `pricing.list.archive` (a draft or a scheduled list); `pricing.price.set` covers items and kits.
- Screens: `/catalogue` (items and kits grids, item sheet with its pump curve); `/price-master` with kit prices, company lists, future lists and the change log; `/settings/tax` for Accounts with GST rates and composite-supply rules (the commands exist).
**Built (C1):**
- item specifications per category in `packages/contracts/src/catalogue/specs.ts` (strict, units in the key names, the item form's fields beside them) with the category check on `items`;
- the commands above in `packages/domain/src/commands/catalogue` and `commands/pricing/price-lists.ts`, each audited for no one company and announced with ids and counts only;
- a draft price list prices nothing, and the one-live-list rule holds among approved lists (`approved_at` with `approved_by`);
- kit components and pump curves replaced as a set, the two catalogue tables with a delete grant;
- the queries `listItems` (sorted, searched and filtered on the server), `listKits`, `getItem`, `getKit`, `listKitPrices`, `listPriceChanges` and `readTaxSettings`, with their plans at 5,000 items from `pnpm --filter @shakti/domain spike:catalogue`;
- the three screens, with saved views on the catalogue grids and every sheet and dialog loaded on first use.

Products are shared (the owner's decision of 29-09-2026): every catalogue change, in the commands (`catalogue_needs_all_companies`) and in the write policies of `items`, `kits`, `kit_components` and `pump_curves`, needs a request that acts for every active company, as GST rates and group price lists do, and `/catalogue` says so and hides its change buttons otherwise.

### 6.2 X1 Role permission editor
`/admin/roles`: the matrix of one role's grants and scopes; `admin.role.permissions.set` replaces the set, marks `customised_at`, bumps the principal cache of every holder and revokes their sessions; an agent role is never editable here; the Executive role cannot lose `admin.roles.write`.

**Built (X1):**
- `admin.role.permissions.set` (`SetRolePermissionsInput`, `RolePermissionsSetDto`, event `admin.role.permissions_changed` with counts only) in `packages/domain/src/commands/admin/set-role-permissions.ts`, which refuses:
  - a role that is not a staff role (`role_not_editable`), and a request that does not act for every company (`role_group_scope`);
  - a grant outside the holder rules of BLUEPRINT §7.1 to §7.3 (`roleMayHold()`, `EXECUTIVE_ONLY_PERMISSIONS`, `COST_PERMISSION_HOLDERS`, `PLATFORM_ONLY_PERMISSIONS`; `permission_not_for_role`, `permission_platform_only`);
  - a scope the permission does not honour (`PERMISSION_SCOPES`, `scope_not_offered`);
  - an Executive set without `EXECUTIVE_KEPT_GRANTS` (`executive_keeps_admin`);
  - a grant set that changed after the editor read it, by its fingerprint (`role_changed_meanwhile`);
- a set that changes nothing writes nothing; `customised_at` comes from the database clock; the event is filed under the lowest company id of the request, because `outbox_events.entity_id` is required;
- the holders' sessions are revoked with `role_changed` except the caller's current one, which `setRolePermissions` in `apps/web/src/actions/admin.ts` names from the session, and nothing is saved if a holder's session cannot be revoked (`role_holders_kept`);
- the action then drops each holder's cached access, logging a cache it cannot reach;
- migration 0073: `app.platform_only_permissions()`, the trigger `role_permissions_platform_guard`, the delete grant and policy on `role_permissions`, and the `role_permissions` and `roles` write policies narrowed to a request for every company;
- migration 0074: `app.role_may_hold()` and the holder guard `role_permissions_holder_guard`, which carries the platform-only rule, the deferred Executive keep-rule, `app.user_roles_outside_request()` ignoring archived companies, and `roles` and `permissions` closed to `app_user` apart from the customised mark;
- the queries `listRoles` and `getRoleGrants` (`packages/domain/src/queries/admin/roles.ts`);
- the screens `/admin/roles` and `/admin/roles/[roleKey]` (menu Roles under Admin): the permissions by module, a scope picker per permission offering only its scopes, a locked line with its reason where the role may not choose, the cost warnings, a notice and no save for a request narrowed to some companies, a running summary, and a confirmation, loaded on first use, that names how many people are signed out.

### 6.3 P2b Imports upgrade
- Import files arrive by the pre-signed flow; the workbook is read as a stream (`exceljs` streaming reader) so memory stays flat; the server-action body limit returns to the default.
- Batch budgets: one deadline across the whole set-based try, then a short row-by-row slice; a job fails after its last queue retry (`Upstash-Retried`).
- Import kinds `accounts` (customers, one relationship per row's company, a repeated customer folded into one record) and `pin_codes`.
- **PIN master** `pin_codes(pin, office_name, taluk, district, state_code)`, shared and read-only to requests, written by the `pin_codes` import (Executive, a request for every company) from the public India Post directory; a PIN fills tehsil and district and offers its post-office localities for the village; a PIN outside the master is flagged for review (PRD CRM-02).
- The import is measured on the dev deployment and recorded in `docs/spikes/import-scale.md`.

### 6.4 P4 Print and letterhead
The render worker `/api/v1/workers/pdf/render` (`PdfRenderJob`) loads a document through the loader its type registers, renders it with `playwright-core` and `@sparticuz/chromium`, stores it as a file and calls the document's attach command as `system:workers`. Static Inter files replace the variable font. Pixel snapshot tests of every template run in the Linux image. `entities` gains `letterhead_file_id`, `logo_light_file_id`, `logo_dark_file_id` and `bank_json` (encrypted: bank, account number, IFSC, branch), set through `org.entity.update` and the company screen; templates print the selling company's letterhead, logo and bank details.

### 6.5 C2 Customer timeline
- `activities`, partitioned by month on `created_at` with its partitions in the closed schema `crm_partitions`: `entity_id`, `opportunity_id`, `account_id`, `type`, `actor_principal_id`, `payload_json` (ids, codes and counts only); readable when its lead is readable; written by commands through `ctx.activity()`.
- `tasks`: `entity_id`, `opportunity_id`, `assignee_id`, `team_id`, `kind` (`callback`, `follow_up`, `nurture`, `review`), `due_at`, `state` (`open`, `done`, `cancelled`), `done_at`; own, team and company scope on the assignee; commands `crm.task.create`, `.complete`, `.reschedule`, `.cancel`.
- `tags` and `opportunity_tags` as DATABASE §6.2 describes; `crm.tag.create`, `.archive`, `crm.lead.tag`, `.untag`.
- Customer edits: `crm.account.update`, `crm.contact.update` (phones, primary number, language), `crm.site.upsert`.
- Consent: `consents.evidence_file_id`; `crm.consent.record` and `crm.consent.withdraw`; consent text versions live beside the templates, their wording from the client.
- Account 360 at `/customers/[accountId]`: contacts, sites, leads, the timeline (keyset), tasks and consents; quotes and orders join with S1 and S2. Under 300 ms p95 at 1,000 activities, with the `EXPLAIN` recorded.
**Built (C2):**
- `activities` in monthly partitions in `crm_partitions` with its default partition and the pg_cron job `activities-partitions`, append-only, readable with its lead or, with no lead, with its customer in its company;
- `ctx.activity()` on the command context, written by `crm.lead.create`, the six opportunity commands, every command below and the set-based import batch (the parity test compares the rows);
- `tasks` with the task machine and `crm.task.create`, `.complete`, `.reschedule`, `.cancel`;
- `tags` and `opportunity_tags` with `crm.tag.create`, `.archive`, `crm.lead.tag`, `.untag`;
- `crm.account.update`, `crm.contact.update`, `crm.site.upsert` and `crm.note.add`;
- `consents.evidence_file_id` with `crm.consent.record` and `.withdraw`, the proof uploaded in the consent dialog through P2's uploader as a `consent_evidence` file of the company and named only once it has passed its checks;
- the queries `listCustomers` (candidates from the definer `app.customer_search_ids()`), `loadAccount360`, `listTimeline` and `listMyTasks`;
- the screens `/customers` (keyset grid with saved views, phones by their last four digits) and `/customers/[accountId]` (Account 360, dialogs loaded on first use), linked from the leads list and board cards;
- their reads granted to `app_reader` and run by `queries/reader-parity.test.ts`;
- the journeys `e2e/customers.spec.ts` (an Executive and a tele-caller on the list and Account 360, consent with proof and its withdrawal, a task added and done, tags, a colleague's customer refused, and the snapshot company's list and Account 360);
- the spike `pnpm spike:account360` ([docs/spikes/account360.md](../spikes/account360.md)), whose run of 04-10-2026 through `app_reader` kept Account 360, the timeline, the customers list and its searches under 300 ms at the 95th percentile for every caller on a shared machine, after two earlier runs that did not settle it;
- the activity types `task_rescheduled`, `task_cancelled` and `untagged` and the note command, which complete the timeline of these commands.

The final measure of Account 360 is taken by the lead on a quiet machine at integration and on the hosted stack.

### 6.6 C3 Pipelines, scoring and referrals
- `/settings/pipelines` (`crm.config.write`): pipeline name, lock hours and first-contact SLA minutes; stages added, renamed, reordered and archived; exit rules chosen from the fixed list of lead fields.
- `call_dispositions` (`entity_id` null for the group, `segment` null for all, `key` 1 to 9, `code`, `label`, `next_action`: `callback`, `retry`, `qualified`, `not_interested`, `wrong_number`, `nurture`), with the workshop default list and an editor.
- Scoring: `lead_score_rules` (`factor`: source, segment, district, system size, age; `match_json`; `points`) and the pure `scoreLead()` answering the score and its reasons; `opportunities.score_reasons_json`, `score_changed_at`, `score_changed_by`; `crm.lead.rescore`.
- Referrals: `referral_partners` (`account_id` of a `referral_partner` customer, `code` unique, active) and `opportunities.referral_partner_id`; codes accepted by the lead form, the walk-in form and imports; `commission_rules` (per partner or default: fixed, percent, per kW or per HP), empty until the answer to workshop CRM-5.
- Walk-in quick form at `/leads/walk-in` for the Store Manager: name, phone, village or PIN, interest, consent; under 30 seconds.

### 6.7 C4 Sizing
Pure functions in `packages/domain/src/sizing`: TDH (static head, drawdown, friction by Hazen-Williams, fitting losses), pump power from flow and head at an efficiency, solar array size for a pump, rooftop kW from monthly units and sun hours with a roof-area check, the pump-curve duty point with its bounds, sanctioned-load and DCR rules; property tests. Engineering constants are named workshop defaults for the engineering head to confirm. `sizings` (child of a lead: `kind` pump or rooftop, `inputs_json`, `result_json`, `in_bounds`, `reasons_json`, `engine_version`), `crm.sizing.record`, the sizing panel; an out-of-bounds result creates a `review` task for the team lead.

**Built (C4):** the calculators in `packages/domain/src/sizing` (`totalDynamicHead` with the pipe velocity as advice, `pumpPower` with the motor margin before the standard rating, `suctionLift` for surface pumps, `solarArrayForPump`, `rooftopSize`, `pumpDutyPoint`, `pumpMatch` (the chosen pump's duty flow against the needed flow and its rated HP against the sized one, read from its specifications with `pumpSpecsOf`), `dcrRule`, `sanctionedLoadRule` at the sanctioned-load ratio, combined by `sizePump` and `sizeRooftop`, and `quoteSizingFacts` for the quote guards), each result with `inBounds` and reason codes (`SizingReasonSchema`) and advice kept apart in `advisories` (`SizingAdvisorySchema`, which never sets bounds), two worked examples per calculator in its tests and property tests over all of them; measurements in metres, litres an hour, kWh, m² and kW, with the unit in each field's name, since no document names feet for borewells; the engineering constants under `WORKSHOP_DEFAULTS.sizing`, each asked of the engineering head as ENG-1 of `docs/phase0/workshop-pack.md`, and stored with every result under `SIZING_ENGINE_VERSION` 2; `sizings` (DATABASE §6.2), append-only, read with the lead and recorded by a person who may write it; `crm.sizing.record` (`crm.lead.write`, people only: an agent, a voice session or the system principal is refused at the guard with `people_only`, SECURITY §3.3), which works out the result on the server from the measurements and, for a chosen pump, its curve and rating, refuses a pump whose specifications name another pump type (`sizing_pump_type_mismatch`), records an out-of-bounds result with its reasons rather than refusing it, audits the sizing and sends `crm.sizing.recorded`; the queries `latestSizing` (the newest sizing a person recorded; one from another engine version is answered as stale, to be sized again) and `listSizingPumps` (items on sale that have a curve); the sizing panel `apps/web/src/components/sizing` (pump and rooftop tabs, the newest result part by part, the needed flow beside the duty flow, the reasons and the advice in plain words) with the actions in `apps/web/src/actions/sizing.ts`. Each sizing is a row of the customer timeline (`sizing_recorded`, with its kind and whether it is within limits); an out-of-bounds sizing opens a `review` task on the lead, due at once, for the active person with the Sales Team Lead role on the lead's team in its company, through the definer `app.open_sizing_review()` (the recorder may not write a task for someone else), audited and on the timeline as `crm.task.create` does, one open review of a lead per team lead, never for the person who recorded the sizing, and none for a lead with no team or a team with no other lead; in Account 360 each lead has a "Size this lead" button that opens the panel, loaded on first use, below the lead, and a saved sizing reads the page again; the journey in `e2e/customers.spec.ts` sizes a lead there as a tele-caller.

**For S1 (quotes):** a quote command fills the quote machine's sizing guards only through `quoteSizingFacts(latest, { segment, quotedPumpItemId, moduleLines, scheme, systemKwp })`, with `latest` from `latestSizing` for the lead and the kind the segment relies on, and the quote's own pump item, module lines (`isDcr`, `quantity`), scheme and module kWp. It answers `sizingComplete` (today's sizing, in bounds, of the segment's kind: a pump for `farmer_pumps`, a rooftop for `residential_rooftop`; a stale sizing counts as none), `pumpCurveInBounds` (a duty point exists, is in bounds, and its pump is the quoted pump) and `dcrRuleMet` (`dcrRule` over the module lines and `sanctionedLoadRule` of the quote's kWp against the rooftop sizing's sanctioned load at the ratio it was sized with; a rooftop quote with no current rooftop sizing fails it). Its unit tests cover every combination, so the quote slice wires nothing of its own.

## 7. Wave 3

### 7.1 AI0 Agent runtime and Inbox
- Provider wrapper in `packages/domain/src/ai`: every call names its agent and purpose, is masked (`packages/domain/src/privacy`), has a timeout, bounded retries, a circuit breaker in Redis and a per-agent daily spend cap; Claude through `@anthropic-ai/sdk` (Haiku 4.5 by default), Voyage embeddings through `fetch`; a fake transport for tests.
- `agent_configs` (`agent`, `action_type`, `autonomy`, `daily_spend_cap_paise`, `enabled`, `entity_id` null for all), with kill switches global, per agent and per company; `agent_runs`; `agent_actions` (append-only, only its decision columns change, by the inbox command); `agent_evals`; `inbox_items` (`kind`, `assignee_id`, `team_id`, `subject_type`, `subject_id`, `state`), which hold agent suggestions and routed work.
- Agent Inbox in the top bar and at `/inbox` (`agents.inbox.act`): approve, edit or reject; `/admin/agents` (`agents.autonomy.write`, `agents.killswitch`).

### 7.2 T1 Cold Caller workspace
- `calls` (`entity_id`, `opportunity_id`, `caller_id`, `direction`, `number_series` with the value `manual` beside `140`, `160` and `inbound` for a call dialled by hand on a phone outside the system, as every Phase 1 call is, `disposition_id`, `attempt_no`, `started_at`, `duration_s`); `calls.log` records the call, its activity and its next action: a callback task, a retry (after the default attempts the lead moves to nurture with its cadence tasks), qualified (the stage move that asks for the handover), or lost.
- Queue `listCallQueue`: the caller's open leads in their first stages, ordered by due callbacks, SLA breach, score and age, keyset; a customer who withdrew consent is marked and cannot be logged as called.
- `/calling`: keyboard-first (`N` next, `1`–`9` dispositions, `D` shows the number to dial, `/` search), the script card for the lead's segment and language, the exit-rule checklist, recent activity; the team lead's view of the team's queues.

### 7.3 S1 Quotes
- `quotes` (`entity_id`, `quote_no`, `opportunity_id`, `account_id`, `site_id`, `sizing_id`, `tier_id`, `price_list_id`, `valid_until`, `state`, `round_off`, totals, `pdf_file_id`, `supersedes_id`); `quote_lines` (item or kit, `qty`, `unit_price`, `hsn`, `tax_rate_id`, `composite_rule_id`, taxable, goods and services parts, CGST, SGST, IGST, line total); `quote_versions` (`snapshot_json`).
- `sales.quote.create`: the tier from the customer type (workshop default map), prices only from the live list for the tier and company, tax by the engine with each line's rate version, 15-day validity, the number from the series in the workshop default format; refused when sizing is missing or out of bounds (SAL-04). `sales.quote.send` needs the PDF (P4); `sales.quote.expire` runs from a daily QStash job as `system:workers`, and a read shows a lapsed quote as expired; `sales.quote.requote` supersedes it at current prices; `sales.quote.withdraw`. A price in the input is refused (SAL-03).
- Quote builder, `/quotes` and the quote page; quotes on Account 360; ⌘K finds quote numbers; board cards show kW or HP and time in stage.

### 7.4 D1 Duplicates
`duplicate_candidates` (`entity_id`, the two leads or customers, `reason` phone or name and village, `confidence`, `state`), found when a lead is made and by a nightly pass, including two customers made at the same moment by an import and a form (imports take no number lock, the lead engineer's decision of 28-09-2026 in [DECISIONS](../DECISIONS.md)); cards on the lead and at `/duplicates`; `crm.customer.merge` and `crm.customer.unmerge` with `customer_merges` keeping what the merge moved, audited and reversible (`crm.lead.merge`); a repeat enquiry for the same segment within 30 days of the last activity on an open lead attaches to it (`crm.lead.create` answers `attached`).

## 8. Wave 4

### 8.1 N1 Notifications
`notifications` (`user_id`, `type`, `subject`, `payload_json`, `read_at`), `notification_preferences` (per type: in-app, push; quiet hours), `push_subscriptions`; the bell and centre; browser push with VAPID keys and a service worker; the notify worker (`NotifyJob`) on the events people act on (assigned to you, callback due, quote expiring, order blocked, duplicate found); first-contact SLA breaches escalate to the GM; a lead refused as `customer_held_by_colleague` becomes an inbox item for that colleague.

### 8.2 T2 Handover
`caller_profiles` (`user_id`, `entity_id`, `is_converter`, `presence`, `max_open` null for no cap, `languages`, `segments`); the handover worker on `crm.opportunity.stage_moved` with `handover: true` picks a Lead Converter by weighted round-robin (present, under capacity, language and segment match, fewest open leads), cursor in Redis, assigns as `system:workers` through `crm.opportunity.assign` within 10 seconds, and routes to the team lead when no one qualifies; `crm.lead.reassign_all` moves a leaving caller's leads.

### 8.3 S2 Orders, acceptance and credit
`sales_orders` and `sales_order_lines` (price and tax copied from the quote), `dealer_terms` (`account_id`, `entity_id`, `credit_limit`, `credit_days`), `dealer_outstanding` (manual entries by Accounts with `as_of`, history kept); `sales.quote.accept` with a signed copy (`signed_quote` file) creates the order draft; `sales.order.create` for dealers without a quote; `sales.order.confirm` runs `creditCheck()` and names the limit or the invoice when it blocks; `sales.credit.release` (Executive, with a reason, audited); `sales.order.cancel`; confirming wins the lead and accrues the referral commission by its rule (`commission_accruals`); orders on Account 360; `/orders` and `/dealer-credit`.

### 8.4 K1 Knowledge Vault
`vector` extension; `knowledge_files` (`entity_id` null for all, `file_id`, `sensitivity`, `source_type`, `state`) and `knowledge_chunks` (`vector(1024)`, HNSW, iterative scan), read under RLS by entity and sensitivity; uploads by `knowledge.vault.write`; extraction: PDFs and masked photos by Claude, Word by `mammoth`, Excel by `exceljs`; chunking and Voyage embeddings in `/api/v1/workers/embeddings/index`; `/knowledge` with the file list and staff search. The security suite proves retrieval by sensitivity per role (SECURITY §11 item 6).

## 9. Wave 5
- **L1 Lead Converter workspace** at `/converting`: the converter's board, the lead's sizing, the quote builder and a rules-based next-best-action list (callback due, quote about to expire, sizing missing, order blocked) on one screen, keyboard-first.
- **R1 Targets and home pages:** `targets` (`entity_id`, `scope` caller or team, `subject_id`, `metric` calls, qualified, orders, kW, `period` day, week or month, `value`), `sales.target.set`; live progress on the caller's home and the team leaderboard; home pages per role: callers (queue and targets), team lead (team progress and queues), GM (SLAs and pipeline), Accounts (dealer credit), Executive (pipeline, quotes, orders).
- **A1 Triage in shadow:** `agent:triage` on `crm.lead.created` reads the lead without names or phone numbers, proposes pipeline, score within bounds, duplicate links and an assignee through tools that wrap commands, and records each proposal as a shadowed action without acting; the shadow report compares proposals with what people did; eval and prompt-injection sets run in CI on recorded answers and by hand against the live model; AI spend per agent on Integration health.

## 10. Wave 6
- **M1 Migration and UAT:** a reconciliation report per import job (rows in, created, attached, skipped, refused, by reason); anonymisation of unqualified leads with no quote or order 24 months after their last activity (BLUEPRINT §7.9), logged in `retention_runs`; the cutover runbook (IMP-02); the two-week parallel-run pack; a UAT pack per role; the end-to-end journeys for the Cold Caller, Lead Converter, Store Manager, Executive and the dealer credit block against staging.
- **G1 Production readiness**, with the owner: a paid production Supabase project, Vercel Pro, the client's domain, SES production access, production Sentry and AWS, and a GitHub plan with environments (AUDIT M45); the parallel run, the reconciliation and the ⌘K measurement on real data happen there, since staging holds synthetic data only.

## 11. Workshop defaults
Each default will live in `packages/domain/src/workshop-defaults.ts`, added by the slice that first uses it, is named under its question in `docs/phase0/workshop-pack.md` and changes in one place. On `main` the file holds the lock hours (CALL-4, 48) and the sizing constants (C4) beside the tax, quote-validity, credit and e-way bill defaults of Phase 0. The workshop question is in brackets:
- document number format (SALE-1); customer type to price tier (PRICE-1); kits priced as a fixed kit price (PRICE-3);
- dispositions (CALL-1); retry attempts and gaps (CALL-3); nurture cadence (CALL-5); lock hours (CALL-4, 48); converter capacity (no cap);
- score rules (CRM-3: none, so every lead starts level); the first-contact SLA;
- the sizing constants, for the engineering head to confirm (ENG-1).

Data that has no default stays empty until the client gives it: tax rates and the CA's golden set, price lists, items with HSN, dealer limits and outstanding, targets, commission rules, caller scripts, consent and privacy texts, legacy data and vault documents. What the client must send, and which slice waits for it, is in `docs/phase0/client-actions.md`.

## 12. Tests per slice
Every slice: unit tests beside the code; for each new table its place in the `*_TABLES` lists, a fixture row per company and a rule in the role × company matrix; for each command the denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep over new commands; Playwright journeys for the roles it touches with axe checks and light, dark and 400 px snapshots; `EXPLAIN` evidence for every list and search it adds; the JavaScript budget; the documents it changes regenerated (`pnpm db:docs`, `pnpm --filter @shakti/domain machines:docs`).
