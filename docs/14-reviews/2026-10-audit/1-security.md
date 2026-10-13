# Auditor 1: security and access control (SEC)

Commit audited: `main` at 23f78a5. Live checks ran on the local Supabase Postgres 17 image (127.0.0.1:54322, migrated through 0129 and seeded) as `app_user` and `app_reader`, inside `begin ... rollback` only. The redaction probes ran the repository's own `redaction.ts` and `model-text.ts`, copied into the scratchpad and run with `node --experimental-strip-types`. No suite was run; see "Not checked".

## Score

**8 / 10.** The access-control core is strong and I could not break it through a normal code path:
- All 77 `public` tables have RLS enabled and forced. With no request settings they show zero rows to `app_user` and `app_reader`.
- The partition schemas grant no role any usage.
- No `security definer` function can be executed by `PUBLIC`, `anon`, `authenticated` or `readonly_reporter`. Each of the 80 definers checks its permission in its own body, or is one of the seven documented exceptions, and its search path matches DATABASE §4.1.
- Agent and system grants hold no cost, admin or sensitive permission (checked live in `role_permissions`).
- Every QStash worker route verifies the signature against its own URL and its exact body.
- Authentication is careful: Argon2id with the documented parameters, `__Host-` cookies, revocation enforced on every auth route, codes that verify once, hashed set-password links, Turnstile checked for hostname and action, and a hosted startup guard.

The marks are lost on privacy, the area the blueprint makes absolute ("Aadhaar numbers are never stored or logged"):
- An import keeps every column of the client's file, Aadhaar included, unmasked and with no end date (SEC-1).
- Customer documents other than vault photos and vault PDFs are stored as uploaded (SEC-2).
- The log and audit scrubber misses Aadhaar numbers written with dots, slashes, underscores or non-ASCII digits, which the model masker catches (SEC-3).

To reach 10:
- fix SEC-1 to SEC-3;
- narrow the opportunity and timeline write rules to what the commands do (SEC-4);
- run the Supabase advisors on migrations 0062 to 0129, and an external penetration test before go-live.

## Findings

| id | severity | effort | title | file:line | failure path | fix |
|---|---|---|---|---|---|---|
| SEC-1 | high | M | An import stores every column of the client's file, Aadhaar included, unmasked and kept indefinitely | `packages/domain/src/commands/imports/create-job.ts:99`; `apps/web/src/actions/imports.ts:127-138`; `apps/web/src/workers/files/handle-file-uploaded.ts:332-342` | 1. M1's cutover imports the client's customer and lead workbooks. Solar-subsidy lists (PM-KUSUM, PM Surya Ghar) normally carry an Aadhaar column. 2. `parseImportFile` returns every column. 3. `imports.job.create` writes each row whole into `import_rows.raw_json`, with no masking and no column filter. 4. The import file itself passes the file check unchanged (`sheet_checked`) and stays in S3 as uploaded. 5. Neither the rows nor the file is purged after the commit or a rollback; no retention job covers either. 6. Result: Aadhaar numbers sit in Postgres (and its backups) and in S3, readable on the import preview by every holder of `imports.write:entity`. This breaks the blueprint's identity-document rule and SECURITY §5 ("Aadhaar: never stored"). Confirmed by reading the code path end to end. | Before the rows are stored (`create-job.ts`), drop or mask any column whose header names an identity number (aadhaar, aadhar, uid and the `IDENTITY_KEYS` spellings). Run every cell through the same twelve-digit masking as `maskForModel()`. Once the job is committed, rolled back or abandoned, purge `raw_json` and delete the import file's bytes, every version. Add a security test that imports a column `Aadhaar` and asserts no twelve-digit run survives in `import_rows` or the store. |
| SEC-2 | medium | M | Customer documents outside the vault's photos and PDFs are stored unmasked | `apps/web/src/workers/files/handle-file-uploaded.ts:47` (`MASKED_PURPOSES = {'knowledge'}`), `:344-355`, `:357-375`, `:401` | 1. A caller uploads a photo of a signed consent form or a signed quote with the customer's Aadhaar card (`consent_evidence`, `signed_quote`). The image is only re-encoded and a PDF is only checked against the refusal list; OCR masking runs only for the `knowledge` purpose. 2. A vault Word document or workbook is kept as uploaded (`checkOfficeFile` checks only its ZIP structure). It is downloadable by every reader of its sensitivity: `staff_ai_ok` reaches all eleven staff roles. Only its extracted passages are masked. 3. SECURITY §5 says masking "applies to WhatsApp uploads, field-app photos and web uploads". The blueprint says documents pass through masking "before storage". Neither holds for these purposes. Confirmed by reading the code; whether a given upload carries an Aadhaar number depends on the customer. | Either put `consent_evidence` and `signed_quote` images and PDFs through the OCR masking step (as vault photos and PDF pages), or record in SECURITY §5 and ADR form that these purposes are exempt and why. For vault Word and Excel files, keep only a text copy masked with `maskForModel()` (or refuse a file whose text holds a twelve-digit run) instead of the original bytes. |
| SEC-3 | medium | S | The log and audit scrubber misses Aadhaar numbers that the model masker catches | `packages/domain/src/ports/redaction.ts:228-233` (Aadhaar pattern: ASCII digits, space or hyphen only), `:241`; used by `audit/redact.ts` through `scrubValue` | Running `redactText()` from this commit gives: `Aadhaar no. 2345.6789.0123` unchanged; `2345_6789_0123`, `2345,6789,0123` and `(2345) 6789 0123` unchanged; `A234567890123` unchanged; the Devanagari `२३४५ ६७८९ ०१२३` and full-width digits unchanged; and a mobile number `98765.43210` or `9876543210x` unchanged. `maskForModel()` turns every one of these into `[number]` or `[phone]`, because it first maps every script's digits to ASCII and accepts more separators. So a caller who types such a number into a note, a name or an address puts it in clear into the append-only `audit_logs` (which cannot be cleaned afterwards) and into the server logs. SECURITY §5 says "a twelve-digit number typed into any field ... is hidden in full in the logs and the audit trail". Confirmed by running the code. | Make `redactText()` normalise digits and separators the way `maskForModel()` does (`asciiDigits()`, the separator set `. , / _ - :` and brackets, digits touching letters), or share one number-finder between the two. Add these shapes to `redaction.test.ts` and the audit-redaction tests. |
| SEC-4 | low | S | The write rules on leads and the timeline allow changes no command makes | `packages/db/migrations/0005_crm_core_rls.sql:228` (`opportunities_update`), `:234` (table-wide `update` grant); `packages/db/migrations/0088_c2_review_rls.sql:32` (`activities_insert`) | Reproduced live as `app_user` with a tele-caller's settings (`crm.lead.write:own`, `crm.account.read:own`, company 1). `update opportunities set account_id = <a colleague's customer>` on the caller's own lead succeeds. The caller then reads that customer through the read-through-lead branch of `account_entities_read`, getting round the `customer_held_by_colleague` rule. The same grant lets the update change `entity_id`, `created_by` and `id`. Separately, `activities_insert` accepts any non-note type (`assigned`, `won` and so on) on any lead the caller can only read, so a read-only role could forge timeline history. No command reaches either today (`writeOpportunity()` takes only state, stage, owner, team and lock), so this is a gap in defence in depth, not an exploit. Confirmed live. | Replace the table-level `update` on `opportunities` with column grants for the columns the commands write (state, stage, owner, team, lock, score columns, referral partner, archived and updated stamps), as `quotes` and `sales_orders` already have. Restrict `activities_insert` for non-note types to callers with `crm.lead.write` at the row's scope, or to the type list each command writes. |

## Checked and sound
- **RLS coverage:** 77 of 77 `public` tables have RLS enabled and forced; no `public` table lacks a policy. `audit_partitions` and `crm_partitions` grant no usage to any request role. Postgres-level role attributes, checked live:
  - `app_user`, `app_reader`, `auth_service` and `outbox_publisher` are neither superuser nor `BYPASSRLS`;
  - `readonly_reporter` cannot log in;
  - no request role is a member of another role.
- **Fail closed:** with no settings, `app_user` and `app_reader` read zero rows from every seeded table (roles, grants, pipelines, entities and others). Every policy reads the settings through `app.entity_ids()`, `app.has_perm()` or `app.user_id()`, which return null or false when a setting is absent.
- **Grants:**
  - `anon` and `authenticated` hold no table grant;
  - `sessions.token`, `auth_accounts`, `auth_verifications` and `user_two_factor` are readable only by `auth_service`;
  - `entities.bank_json` is selectable by no request role.
- **Definers:**
  - All 80 are executable only by their named roles; none by `PUBLIC` or `readonly_reporter`.
  - Every definer checks its permission in its body (sampled: `handover_*`, `notice_*`, `write_notices`, `reset_two_factor`, `attach_account_entity`, `outbox_health`, `caller_profile_people`, the commission definers); `app.may_confirm_order` is executable by no request role.
  - The seven exceptions with no permission check, and the `pg_catalog, public, app, pg_temp` search paths, are the ones DATABASE §4.1 lists.
- **Principals and cost:**
  - The seeded agent and `system:workers` grants match SECURITY §3.3.
  - `finance.cost.read` is held only by Executive and Accounts, and `procurement.rate.read` only by Executive, Accounts and Inventory Manager.
  - `item_costs` is read only by `list-items`, behind the permission check and the cost-gate policy.
  - The command runner checks people-only commands before the permission and refuses agents again afterwards.
- **Requests and principals:**
  - `withRequestContext()` refuses companies outside the principal and sets only transaction-local settings.
  - "All companies" uses the intersection of grants at the narrowest scope.
  - The principal cache is versioned per user and lives 60 seconds.
- **Authentication:**
  - Argon2id (64 MiB, t = 3, p = 1) with a dummy verify for inactive accounts.
  - Every Better Auth HTTP endpoint is disabled except the set-password link, whose `callbackURL` passes Better Auth's `originCheck`.
  - Revoked sessions and sessions past the absolute limit are refused in the before hook.
  - Codes are refused on reuse, trusted devices are refused, and five wrong codes lock the second factor.
  - The lockout is keyed per account and per address, with the email normalised and IPv6 grouped to /64.
  - Per-address caps; Turnstile checked for hostname and action, failing closed.
  - Set-password links are stored hashed, one per person, and capped per link.
  - TOTP is required for Executive, GM and Accounts; a password change revokes other sessions; `safeReturnPath()` blocks open redirects.
- **Web layer:**
  - The upload routes and the realtime-token route require the BOS `Origin`; the replay route requires a JSON content type.
  - CSP uses a nonce and `strict-dynamic`, with `frame-ancestors 'none'`; HSTS is set; `/set-password` sends no referrer.
  - Sentry drops query strings and has `sendDefaultPii` off.
  - There is no `dangerouslySetInnerHTML`; the print HTML is escaped and Chromium runs offline with every non-`data:` request aborted.
  - Push endpoints are allowed only for known push services.
- **Workers:** all 12 QStash routes (nine with their own check, three through `nightlyWorkerRoute`) verify the signature for their own URL and exact body, and refuse a body that is too large before reading it. The import worker rebuilds the requester's current grants on every run.
- **Files:**
  - Pre-signed PUTs bind type, length, SHA-256 and SSE-KMS.
  - GuardDuty's verdict is required on a hosted environment.
  - `sharp` re-encodes images with a pixel limit, and the ZIP guard checks archives strictly.
  - Downloads carry a sanitised `Content-Disposition`; the local file route answers 404 when hosted.
- **AI:**
  - The Triage prompt puts the lead's outside text only in `<untrusted_data>`, masked and with `&` and `<>` escaped.
  - The output filter is deterministic, and its proposals are checked again by `agents.run.record`.
  - Embeddings and extraction texts are masked; no agent can reach Automatic in Phase 1.
- **Secrets and supply chain:**
  - Every workflow action is pinned by SHA, and the workflows run with least-privilege permissions.
  - Automerge refuses forks and authors other than the owner and Dependabot, and checks the head SHA.
  - `.gitleaksignore` lists test values only. No hosted connection string or key appears in any branch's history (pattern search).
  - Hosted Postgres requires verified TLS (`DATABASE_CA_CERT`).
  - `productionConfigProblems()` refuses published or short secrets, Turnstile test keys, non-https URLs, `FIELD_ENCRYPTION_KEY` and `AI_TRANSPORT`.

## Not checked
- I did not run `pnpm audit`, because it needs the network. Next 16.4.0 and React 19.3.0 are later than the advisories I know of.
- Hosted settings (Supabase advisors, network restrictions, Vercel fork-preview protection and environment scoping, live AWS and KMS policy, QStash schedules) were not checked; the brief forbids touching hosted services.
- The Realtime channel policies are deferred to the production site.
- I did not run the security suite; the live probes above stand in for it.
- I did not read Better Auth's internals beyond the reset-callback origin check.
