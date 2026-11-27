# J3 Customer documents and requirements (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j3-documents` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): identity documents, masking, sensitive files, row security |
| Usage | briefed 27-11-2026; built from 27-11-2026 on Opus 5.5 at high (a seat's own account; worktree j3-documents, Postgres 54332, app 3032) |
| State | early check |
| Next step | the lead reads the early-check diff, then continues the builder for the screens |

## Brief
Build [phase4 §6.3](../../03-roadmap-appendix/phase4.md#63-j3-customer-documents-and-requirements) as written. SECURITY §5 and §11 items 7 and 8 are the heart of this slice. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:**
   - `document_requirements`: company, flow, step key, requirement key, mandatory, accepted kinds, position, active. Seeded per company with the defaults of phase4 §10 by `pnpm db:seed`, code-owned columns only, as the seed's rules say.
   - `documents`: `entity_id`, `account_id`, `project_id` (null until J1 merges, then a foreign key added in the merge), `requirement_key`, `kind`, `file_id`, `sensitive`, `filed_by_kind` (`person` or `classifier`), `confidence`, `filed_at`, `unfiled_at` and `unfiled_reason`.
   - `identity_documents`: `entity_id`, `account_id`, `kind`, `last4`, `masked_file_id`. There is no column that could hold a full number.
   - A foreign key to `projects` waits for J1. Add it in your migration if J1 has merged when you take `main`, else leave it for the lead's integration and say so.
2. **Row security:**
   - `documents.read` and `.write` per scope. `own` means the customer's owner or the project's assignee: reuse J1's `app.project_is_mine` once it is on `main`, else the account's `owner_id`.
   - A row with `sensitive` true is read only with `documents.sensitive.read`.
   - No agent principal reads a sensitive row (`AGENT_FORBIDDEN_PERMISSIONS` holds `documents.sensitive.read`).
3. **File purposes:**
   - `customer_document` gets its readers and writers.
   - It joins `MASKED_PURPOSES` in `apps/web/src/workers/files/handle-file-uploaded.ts`, so the OCR masking of `vault-masker.ts` and `mask-document.ts` runs before the file is stored for use and before any model call.
   - An identity document's number is replaced by its mask, its last four digits go to `identity_documents`, and the original is never kept. Confirm against W1 and W2's media path which unmasked bytes exist and for how long, and say so.
4. **Commands:** `documents.file` (refuses `file_customer_mismatch` when the file's uploader context names another customer, and an unclean or unmasked file), `documents.unfile` (with a reason), and `documents.requirement.set` (Executive).
5. **Completeness:** `app.project_missing_documents(project_id, step_key)` is a definer answering the mandatory requirement keys not filed. J1's guard reads it.
6. **Screens:** the Documents tab (on the project page once J1 merges, else on Account 360; add the tab with one line), with requirements and their state, Upload, View masked, and Unfile. Plus Account 360's Documents section, and Settings › Document requirements (Executive). Journey: the Project Manager uploads a bill and an identity document, sees the masked copy and the last four digits only, and a Field Engineer sees no sensitive document. With axe and snapshots.

**Early check (Tier A):** once the tables, row security, the purpose changes, the masking path and their tests are committed, write a short report and push `report: j3-documents early check`, then stop. The tests to commit first:
- SECURITY §11 items 7 and 8: generated document images and PDFs carrying 12-digit numbers, with the digits nowhere after the upload (storage key, row, audit value, log line, Sentry event or model payload);
- filing against another customer refused;
- the sensitive flag per role.

Files owned: the three tables and their migrations; `packages/domain/src/commands/documents/` (new) and queries; the `customer_document` purpose's rules; the change to `MASKED_PURPOSES`; the Documents tab and Settings › Document requirements.

Do not touch: W1's WhatsApp media path (J7 later); the vault's knowledge files (K1); `projects` (J1).

Review checklist: no identity digits anywhere after masking; sensitive rows by grant only; filing only against the sending customer; the seed writes only code-owned columns.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 4 design](../../03-roadmap-appendix/phase4.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: j3-documents <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: j3-documents blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 4 wave 1, from 27-11-2026):**
- `j1-projects`: projects, the standard flow, templates and the project page frame;
- `j2-loans`: customer loans;
- `j3-documents`: customer documents, requirements and masking;
- `f1-field-foundation`: `apps/field`, mobile sign-in, `/me` and feature flags.

Phase 3's wave 2 runs at the same time: X4, H2, U2, H3, Q1 and R3.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

### 27-11-2026, seat (worktree `j3-documents`, Postgres 54332, app 3032): early check
Opus 5.5 at high. Skills loaded: `add-table`, `add-command`. Stopped at the early check as the lane says; no screen, server action or journey yet.

**Built (files):**
- Contracts: `packages/contracts/src/documents/index.ts` (kinds, sensitive kinds, requirement keys, flows and steps, identity kinds, the four inputs, `DocumentDto`, `DocumentRequirementDto`, `DocumentViewDto`, `WORKSHOP_DOCUMENT_REQUIREMENTS`); `UPLOAD_FIELDS.accountId` (`api/files.ts`, required for `customer_document` and refused for any other purpose); `MarkFileReadyInput.lastFour` (`commands/files/uploads.ts`).
- Schema and migrations: `packages/db/src/schema/documents.ts` (`document_requirements`, `documents`, `identity_documents`), `files.account_id` with `files_account_check` (added `NOT VALID`; no older row can break it) in `0240_j3_documents.sql`; `0241_j3_documents_rls.sql` (row security, grants, the guard trigger, `app.file_purpose_grant()` with the new writer, `files_customer_document_read`, the restrictive `files_customer_document_insert`, the definers `app.file_is_filed(uuid)` and `app.documents_missing(entity, account, project, flow, step)`).
- Seed: `packages/db/seeds/document-requirements.ts` (13 rows per company, insert-if-missing on the four keys, nothing updated); `WORKSHOP_DEFAULTS.documents.requirements`.
- Domain: `commands/documents/documents.ts` (`documents.document.file`, `.unfile`, `.view`, `documents.requirement.set`), `queries/documents/documents.ts` (`listCustomerDocuments`, `readDocument`, `listDocumentRequirements`, `missingDocuments`), the purpose rule and limit (`files/purposes.ts`, `files/limits.ts`), `files.upload.begin` now `peopleOnly` and storing the customer and a masked name, `files.file.mark_ready` keeping `lastFour` on a customer document, `files.file.continue_check` for customer-document PDFs.
- Masking path (web): `customer_document` joins `MASKED_PURPOSES` (`workers/files/handle-file-uploaded.ts`); the masker's `aadhaarLastFour` and `bankAccountLastFour` ride on the photo's check and on each kept PDF page's record (`workers/files/mask-pdf-pages.ts`) to `mark_ready`; `openFile` refuses a customer document (it opens through `documents.document.view`, so an identity paper's opening is audited).
- Web registration: audit labels and code groups (`screens/audit.ts`, `components/activity/activity-details.tsx`), contract values, the `documents` catalogue namespace, error sentences, and `documents` sent to `/admin` (`i18n/client-namespaces.ts`).

**Tests added:** `packages/db/tests/security/documents.test.ts` (37: the sensitive flag per staff role, own scope as the customer's owner, every agent, no context, the identity table's columns and `last4` check, uploads per role and customer, filing and unfiling under row security, requirements and the completeness definer); `packages/domain/tests/commands/documents.test.ts` (15: happy paths, denied, outside the request, `file_customer_mismatch`, not ready, refused, unscanned where hosted, unmasked, sensitive without the grant, kind not accepted, filed twice, unfile once, audited opening of a sensitive document only); `apps/web/tests/customer-documents.test.ts` (5: SECURITY §11 item 8 with a generated photo and a generated image-only PDF through the real masking step, item 7, an unknown customer, no masking step). Changed: the matrix (3 tables, sensitive rows, an `all` rule), `files.test.ts`, `enum-sync`, `grants` (`NARROWER`, two reader definers), the agent sweep (4 people-only inputs, uploads), `purposes.test.ts`, `workshop-defaults.test.ts`, `contract-values.test.ts`.

**Item 8, how it is proved:** the photo and the PDF carry a made-up Aadhaar number with a valid check digit (`AADHAAR` of `tests/support/pdf-fixtures.ts`); after the upload, the checks and the filing, the test reads every row of the file, document and identity document, every audit row naming them, every outbox event, every captured log line (the memory logger and every `console` line), every Sentry call (mocked, with `SENTRY_DSN` set) and every store key, and none holds the number whole, spaced or its first eight digits; the one kept picture, read back by OCR (what J7's classifier will be sent), shows neither the first eight digits nor digits 5 to 12; the identity document keeps only `last4`. J3 makes no model call. With masking switched off by hand the two cases fail (`expected '234567890124' not to contain '23456789'`), so they are not vacuous.

**Unmasked bytes, against W1 and W2's media path:** a customer document's original bytes exist only in the store, under `<company>/customer_document/<file id>.<ext>`, from the upload until its checks end: the checked copy is stored under its own key and the original deleted with every version (each later delivery deletes it again if that failed); a refused file's bytes are deleted at once; a hosted runtime without the masking step refuses at once (`file_masking_unavailable`). An upload never completed is swept with its bytes after 24 hours (`sweep-uploads.ts`); one completed but waiting on GuardDuty's tag stays until the scan answers (Integration Health counts files waiting over ten minutes). A PDF's pages are kept only masked beside the upload until assembled, then deleted. In memory the masker zeroes the buffers it is handed. No original is logged, audited or sent anywhere. The WhatsApp path (W1, W2) is unchanged: its originals live the same way, and its orphans go after a day only with `WHATSAPP_MEDIA_ORPHAN_SWEEP=on`.

**Checks run:** typecheck of contracts, db, domain and web (clean); eslint of every folder touched (clean); unit tests: contracts 340, domain 2806, db and web all passing (web 1241 with the namespace fix); `pnpm copy-lint` clean; `pnpm db:docs` and `machines:docs` regenerated; the security suite: SECURITY_SUMMARY.

**EXPLAIN (ANALYZE) under RLS** (2,000 customers of company 1 with 25 documents each, a third identity papers, 50,000 files; written, read as `app_user`, then deleted): a customer's documents as a Project Manager, `documents_account_idx`, 25 rows, 0.99 ms; their identity numbers, `identity_documents_document_number_unique` per document, 1.55 ms; `app.documents_missing()`, 1.34 ms; the same list as the Field Engineer who owns the customer, 16 rows with the 9 identity papers hidden, 0.56 ms.

**Decisions the brief did not settle (Assumptions):**
- Command names are `documents.document.file`, `.unfile` and `.view`: the registry requires `module.resource.action`, so `documents.file` was refused.
- A customer document's upload names its customer (`files.account_id`, set at `files.upload.begin`); that is the "uploader context" `file_customer_mismatch` compares, and only a customer document names one. A restrictive insert policy holds it to a customer of the company in the uploader's `documents.write` scope.
- `documents.requirement.set` needs `documents.write` at `all` scope (only the Executive holds it); no new permission.
- Requirement keys, kinds, flows and steps are closed lists with catalogue labels, so the Settings editor needs no typed labels. The 13 default requirements per company map §10's list onto BLUEPRINT §8.5's steps (survey: bill, identity proof, site photos, property papers, optional in the standard flow; commission or installation: commissioning report; feasibility: sanctioned load letter; agreement; net metering: net meter certificate), for PROJ-1 to confirm.
- `bank_proof` is a document kind (sensitive) and an identity kind, with no default requirement; `pan` is an identity kind nothing writes yet (DATABASE plans it; the masker covers no PAN on a picture).
- Filing a sensitive kind needs `documents.sensitive.read`, so a Field Engineer may upload a paper for a customer they own and file bills and photos, but not an identity or bank paper; once a file is filed its uploader reads it only through the document's rule.
- `identity_documents` carries `document_id`, so its last four digits are read with the document and stop being read when it is unfiled.
- Opening an identity or bank paper writes an audit row (`documents.document.view`); opening any other document writes none.
- `files.upload.begin` is people-only: the Concierge and the Orchestrator hold `documents.write`, and no agent may begin an upload.
- No masking hint by kind at upload: the masker runs with no expected number (as for WhatsApp), and refuses a photo that looks like an Aadhaar card whose number it cannot find.

**For the lead at integration:** J1 has not merged, so `documents.project_id` has no foreign key yet and `documents.document.file` takes no project; J1's merge adds the key to `projects (id, entity_id)` and `app.project_missing_documents(project_id, step_key)` as a wrapper over `app.documents_missing()`, and `own` gains the project's assignee (`app.project_is_mine`). A finding outside this slice: `files.file.continue_check` sends a paged PDF on only for vault files (and now customer documents), so a WhatsApp PDF of more than one page (W1) stops after its first page until Integration Health's "Check files again" sends it on a page at a time.

**Not done yet (after the early check):** the server actions, the Documents tab on Account 360, Account 360's Documents section, Settings › Document requirements, the journey with axe and snapshots, `pnpm build` and `js-budget`, the DATABASE, SECURITY and phase4 "Built" documents, and the retention period for documents (none is given in DATABASE §7).

## Review

## Integration
