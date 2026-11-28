# J3 Customer documents and requirements (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j3-documents` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): identity documents, masking, sensitive files, row security |
| Usage | briefed 27-11-2026; built from 27-11-2026 on Opus 5.5 at high (a seat's own account; worktree j3-documents, Postgres 54332, app 3032); finished 28-11-2026 on Opus 5.5 at high (lane 92, the lead's VM) |
| State | done |
| Next step | review; at integration, after J1 merges, the foreign key to `projects` and `app.project_missing_documents()` (Report, 28-11-2026) |

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
- Web registration: audit labels and code groups (`screens/audit.ts`, `components/activity/activity-details.tsx`), the browser's copies of the lists (`screens/document-values.ts`, checked by `contract-values.test.ts`), the `documents` catalogue namespace, error sentences, and `documents` sent to `/admin` (`i18n/client-namespaces.ts`).

**Tests added:** `packages/db/tests/security/documents.test.ts` (37: the sensitive flag per staff role, own scope as the customer's owner, every agent, no context, the identity table's columns and `last4` check, uploads per role and customer, filing and unfiling under row security, requirements and the completeness definer); `packages/domain/tests/commands/documents.test.ts` (15: happy paths, denied, outside the request, `file_customer_mismatch`, not ready, refused, unscanned where hosted, unmasked, sensitive without the grant, kind not accepted, filed twice, unfile once, audited opening of a sensitive document only); `apps/web/tests/customer-documents.test.ts` (5: SECURITY §11 item 8 with a generated photo and a generated image-only PDF through the real masking step, item 7, an unknown customer, no masking step). Changed: the matrix (3 tables, sensitive rows, an `all` rule), `files.test.ts`, `enum-sync`, `grants` (`NARROWER`, two reader definers), the agent sweep (4 people-only inputs, uploads), `purposes.test.ts`, `workshop-defaults.test.ts`, `contract-values.test.ts`.

**Item 8, how it is proved:** the photo and the PDF carry a made-up Aadhaar number with a valid check digit (`AADHAAR` of `tests/support/pdf-fixtures.ts`); after the upload, the checks and the filing, the test reads every row of the file, document and identity document, every audit row naming them, every outbox event, every captured log line (the memory logger and every `console` line), every Sentry call (mocked, with `SENTRY_DSN` set) and every store key, and none holds the number whole, spaced or its first eight digits; the one kept picture, read back by OCR (what J7's classifier will be sent), shows neither the first eight digits nor digits 5 to 12; the identity document keeps only `last4`. J3 makes no model call. With masking switched off by hand the two cases fail (`expected '234567890124' not to contain '23456789'`), so they are not vacuous.

**Unmasked bytes, against W1 and W2's media path:** a customer document's original bytes exist only in the store, under `<company>/customer_document/<file id>.<ext>`, from the upload until its checks end: the checked copy is stored under its own key and the original deleted with every version (each later delivery deletes it again if that failed); a refused file's bytes are deleted at once; a hosted runtime without the masking step refuses at once (`file_masking_unavailable`). An upload never completed is swept with its bytes after 24 hours (`sweep-uploads.ts`); one completed but waiting on GuardDuty's tag stays until the scan answers (Integration Health counts files waiting over ten minutes). A PDF's pages are kept only masked beside the upload until assembled, then deleted. In memory the masker zeroes the buffers it is handed. No original is logged, audited or sent anywhere. The WhatsApp path (W1, W2) is unchanged: its originals live the same way, and its orphans go after a day only with `WHATSAPP_MEDIA_ORPHAN_SWEEP=on`.

**Checks run** (every one through `heavy.sh`):
- typecheck of contracts, db, domain and web: clean; eslint `--max-warnings 0` of every folder touched: clean (the whole-repository `pnpm lint` is left for the final check of the slice);
- unit tests: contracts 340 passed; domain 2,806 passed; db 161 passed; web 1,241 passed, 1 skipped; `pnpm copy-lint`: "catalogues and templates are clean";
- `pnpm test:security` on the slot's database freshly recreated after the VM restart (so the migrations applied to an empty database), with the OCR model of CI (`@tesseract.js-data/eng@1.0.0`, its pinned SHA-256 checked) in `OCR_LANG_PATH`: db 1,834 passed (63 files), domain 1,534 passed (111 files), web 466 passed (40 files);
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` regenerated and committed; DATABASE §6 marks the three tables Built (the data-docs test asks it);
- `pnpm build`: passed; `pnpm --filter web js-budget`: "Every page is within its budget (65 pages)". The document values the browser needs live in `screens/document-values.ts`, not `contract-values.ts`: in `contract-values.ts` they put `/catalogue` 0.1 kB over its 245 kB budget.

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
- `files.upload.begin` is people-only (with `voiceSession`, so a person's recorded Teach session still uploads its recording, as V2 does): the Concierge and the Orchestrator hold `documents.write`, and no agent may begin an upload.
- No masking hint by kind at upload: the masker runs with no expected number (as for WhatsApp), and refuses a photo that looks like an Aadhaar card whose number it cannot find.

**For the lead at integration:** J1 has not merged, so `documents.project_id` has no foreign key yet and `documents.document.file` takes no project; J1's merge adds the key to `projects (id, entity_id)` and `app.project_missing_documents(project_id, step_key)` as a wrapper over `app.documents_missing()`, and `own` gains the project's assignee (`app.project_is_mine`). A finding outside this slice: `files.file.continue_check` sends a paged PDF on only for vault files (and now customer documents), so a WhatsApp PDF of more than one page (W1) stops after its first page until Integration Health's "Check files again" sends it on a page at a time.

**Not done yet (after the early check):** the server actions, the Documents tab on Account 360, Account 360's Documents section, Settings › Document requirements, the journey with axe and snapshots, the SECURITY (§5 and §11 items 7 and 8) and phase4 "Built" documents, and the retention period for documents (none is given in DATABASE §7).

**Uncertain:** the masking cases of item 8 run only where the OCR model is set (`OCR_LANG_PATH`; CI's security job sets it, and without it they are skipped, as the vault's are). The VM's memory was short once while other agents ran (a process was killed by the kernel during a queued build); every result above comes from a later run that finished.

### 28-11-2026, lane 92 (the lead's VM; worktree `j3-documents`, Postgres 54332, app 3032): done
Opus 5.5 at high. Skills loaded: none this round (the screens follow the existing patterns; `add-table` and `add-command` were loaded for the early check). The branch held the earlier seat's actions, Documents section, Settings screen, journeys, SECURITY, DATABASE and Built records and the Settings budget; I kept them, finished and fixed what was left, and ran every check and the journeys. The VM restarted once while I worked; every result below comes from a run after the restart on a freshly migrated and seeded slot database, except the security suite (run before the restart on commit `c5aa4e6b`; nothing after it changes schema, policies, definers, commands or queries).

**Built (files) since the early check:**
- Actions `apps/web/src/actions/documents.ts`: `loadCustomerDocuments` (documents, active requirements and each step's missing keys, now in one transaction), `fileDocument` (passes `hosted: hostedRuntime()`, see the fixes), `unfileDocument`, `openDocument` (audited through `documents.document.view`, then a short-lived inline address), `listDocumentRequirements`, `setDocumentRequirement`.
- Screens: Account 360's Documents section `components/documents/customer-documents.tsx` (requirements of a flow's steps with Filed, Missing or Not needed, Upload, Open the masked copy, Unfile, the last four digits of an identity paper), its dialogs `documents-dialogs.tsx`, `use-open-document.ts`; Settings › Document requirements `app/(bos)/settings/document-requirements/page.tsx` with `requirements-screen.tsx` (Executive, `documents.write:all`, in `nav.ts`); the flow choice shared by both, `flow-choice.tsx` (the price master's pressed-button pattern from the UI kit). J1 has not merged, so the Documents section stands on Account 360; the project page's tab is one line once J1 is in.
- Journeys `apps/web/e2e/documents.spec.ts` with their seed `e2e/setup/documents.ts` and the two signed-in roles (Project Manager, Field Engineer) in `e2e/support/users.ts`; the journeys' PDF writer moved from `tests/support/pdf-fixtures.ts` to `e2e/support/pdf.ts` (pure, as `docx.ts`), re-exported for the tests, with `e2e/support/pdf.test.ts`.
- Documents: SECURITY §5 and §11 items 7 and 8, DATABASE's definers and purpose, phase4 §6.3 "Built (J3)" (the earlier seat's commit `66bcad00`, kept as written).

**Fixes found by running the journeys:**
- `apps/web/next.config.ts`: `tesseract.js` joins `serverExternalPackages`. Bundled, its worker script resolved to `/ROOT/node_modules/.pnpm/tesseract.js@7.0.0/.../worker-script/node/index.js`, so in any production build (`next start`, and Vercel) the masking step threw `MODULE_NOT_FOUND` as an uncaught exception and every masked upload (customer documents, and the vault's photos and PDFs) hung at "being handled". Not a check file, but outside the brief's file list: the lead may prefer it as its own pull request. For a hosted runtime the worker script and `tesseract.js-core`'s WebAssembly may also need `outputFileTracingIncludes` on the file-check route; I did not guess at that (no hosted OCR yet, DEPLOY §1).
- `fileDocument` now passes `hosted: hostedRuntime()`: without it the command took every runtime as hosted and refused an unscanned file (`file_not_clean`) locally and in CI, where no scanner runs.

**Tests added this round:** `e2e/support/pdf.test.ts` (2: the PDF's shape; the journey's made-up Aadhaar number has a valid check digit). Journeys: `documents.spec.ts`, 4 cases × 3 projects: the Project Manager sees the requirements, the bill and the identity paper with "Aadhaar number ending 4821" only, opens its masked copy (axe, snapshot `customer-documents`); the Project Manager uploads a bill (PNG) and an identity paper (a PDF carrying a made-up 12-digit Aadhaar number), each checked, masked and filed, sees only the last four digits, no run of the first eight digits anywhere on the page, and the masked PDF served; the Field Engineer who looks after the customer sees the bill and neither the identity paper nor its digits (axe); the Executive lists and saves a requirement (axe, snapshot `document-requirements`).

**Checks run** (each through `heavy.sh`):
- `pnpm typecheck`: 10 successful; `pnpm lint` (whole repository, the final check): clean;
- web unit tests: 168 files, 1,244 passed; `pnpm copy-lint`: "catalogues and templates are clean";
- `pnpm test:security` with the OCR model of CI (`@tesseract.js-data/eng@1.0.0`, SHA-256 checked) in `OCR_LANG_PATH`: db 1,834 passed (63 files), domain 1,534 passed (111 files), web 466 passed (40 files), the 5 masking cases of `customer-documents.test.ts` run, none skipped;
- `pnpm build`: passed; `pnpm --filter web js-budget`: "Every page is within its budget (66 pages)", `/settings/document-requirements` 208.5 of 219 kB, `/customers/[accountId]` 201.0 of 205 kB;
- journeys, on this VM with sign-in working, after `db:migrate`, `db:seed` and `e2e:seed`, with `OCR_LANG_PATH` set for the server: `playwright test documents.spec.ts`: 29 passed (the sign-ins and the 4 cases on desktop-light, desktop-dark and phone). Snapshots compared only in the Linux image: the host-made pictures were taken out of the branch (commit `test(e2e): take out…`); the lead makes the Linux baselines.

**EXPLAIN (ANALYZE):** as in the early check (the Documents section's reads are the same queries, now in one transaction).

**For the lead:**
- J1 has not merged on `main` (checked 28-11-2026 04:30 UTC). At integration: the foreign key `documents (project_id, entity_id)` to `projects (id, entity_id)`, `app.project_missing_documents(project_id, step_key)` as a wrapper over `app.documents_missing()`, `own` widened to the project's assignee with `app.project_is_mine`, `documents.document.file` taking a project, and the Documents tab on the project page (one line, the same `CustomerDocuments`).
- CI's journeys job has no OCR model, so the upload case skips there (`test.skip` on an empty `OCR_LANG_PATH`); adding the model to that job, as the unit and security jobs have it, is a `ci.yml` change for the owner's `checks-ok`.
- `apps/web/js-budget.json` gained the Settings page's budget (a checks file: `checks-ok`).
- Retention of customer documents is still not set: DATABASE §7 names no period (an owner's or client's decision).

**Decisions this round (Assumptions):** the section's upload goes through "Upload a document" with the requirement chosen in the dialog, so a retried journey still finds it; the masked copy of a PDF is checked by its fetch (200, `application/pdf`), since the headless browser saves a PDF rather than showing it.

## Review

### 28-11-2026, slice reviewer (Opus 5.5 at high; worktree `j3-documents`, Postgres 54331): reviewed `8f1ab2f4`
Verdict: **two high findings block the merge** (H1 in the slice, H2 at the merge with `main`); M1 makes CI fail and is one command.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| H1 | high | `packages/domain/src/commands/documents/documents.ts:133` (`sensitive = isSensitiveKind(input.kind)`), `:161-179`; `packages/db/migrations/0241_j3_documents_rls.sql:78-85` (`files_customer_document_read`); `apps/web/src/components/documents/documents-dialogs.tsx:85-89`; `customer-documents.tsx:241-250` | Whether a paper is sensitive depends only on the kind the person picks. The masking step's own evidence (`scan_result.lastFour.aadhaar` / `.bankAccount`, kept on the file by `mark_ready`) is ignored unless the kind is `identity_proof` or `bank_proof`. The upload dialog never offers those kinds to someone without `documents.sensitive.read`, so they can only file such a paper under another kind. The file then stays readable through any document that names it, including an unfiled, non-sensitive one. | A Field Engineer photographs the customer's Aadhaar card at the survey. "Identity proof" is not in their list, so they choose "Site photos". The masker finds the number, masks it and keeps `0124`. The filing writes `sensitive = false` and no `identity_documents` row. The GM (`documents.read:entity`, no sensitive grant) and the tele-caller and store manager who own the customer then see the card under Open: name, photo, date of birth, address and last four digits. Nothing is audited. Unfiling does not help: the unfiled non-sensitive row still names the file, Open is still shown for unfiled rows, and the row still passes `files_customer_document_read`. If the same file is filed again as `identity_proof` (the `fileDocument` action takes any file id), the old row keeps it open to everyone. SECURITY §5's sentence "identity and bank papers are always `sensitive`" is therefore not true of the papers, only of the two kinds. | (1) In `fileDocument`, a file whose `scan_result.lastFour` holds any Aadhaar or bank account digits is filed only as `identity_proof` or `bank_proof`. Anything else is refused with a new reason, for example `document_identity_kind`, with a sentence telling the person to ask someone who may file identity papers. The alternative is to force `sensitive = true` and require the grant. Do the same when any earlier document of the file was sensitive. (2) In `files_customer_document_read`, read a file only through a filed document (`d.unfiled_at is null`), or treat the file as sensitive when any document naming it is (a small definer). (3) Tests: a masked Aadhaar photo filed as `site_photo` is refused for the Field Engineer and the Project Manager, and after unfile and refile the GM reads neither the old row's file nor the new one. (4) Change the SECURITY §5 sentence to match. | confirmed (code path read end to end: masker, then `mark_ready`, then `fileDocument`, then the policies, then the section's Open button) |
| H2 | high (at the merge) | `packages/db/migrations/0241_j3_documents_rls.sql:28-57` | The migration redefines `app.file_purpose_grant()` "from its latest definition (0235)". `main` has since redefined it in `0242_q1_labels_rls.sql` (Q1), adding `label_sheet` to both write (`files.process:entity`) and read (`inventory.stock.move`). When this migration is renumbered after `main`'s last, it drops `label_sheet`. Git shows no conflict here, because the two files differ. | Once merged, a stock handler cannot open a label sheet and the render worker cannot store one (the general `files_read`/`files_insert` see a null grant), and Q1's purpose test fails. | At the merge, write the function as `main`'s 0242 plus the `customer_document` writer, and take `purposes.ts` from both sides (slice-integration §10). | confirmed (`git show origin/main:packages/db/migrations/0242_q1_labels_rls.sql`) |
| M1 | medium (CI fails) | `docs/data/data-dictionary.md` | The data docs are stale. The committed `files` catalogue entry lacks the `account_id` sentence that `docs/05-database.md` gained in `66bcad00`, after `db:docs` last ran. | `pnpm --filter @shakti/db test` fails in `src/docs/data-docs.test.ts` ("run pnpm db:docs when not"), and so does CI's unit job. I reproduced it here: 1 failed, 160 passed. | `pnpm db:docs` and commit (also after H2's merge). | confirmed (run) |
| L1 | low | `packages/domain/src/commands/files/begin-upload.ts:16` (`customerDocumentName`) | An uploaded file's name keeps only the last four digits of Aadhaar- and phone-shaped numbers. A bank account number stays whole, although the upload dialog says "any identity or bank account number is hidden". | `SBI acct 12345678901234.pdf` is kept and shown as written (probed). | Mask any run of 9 to 18 digits in a customer document's name to its last four, or narrow the copy. | confirmed (probe) |
| L2 | low | `packages/db/seeds/index.ts:166-178`, `seeds/document-requirements.ts:11` | Each seed row's id comes from its index in `WORKSHOP_DOCUMENT_REQUIREMENTS`. `onConflictDoNothing` names only the unique key, so a clash on the primary key is not absorbed. | When PROJ-1's answer inserts a requirement mid-list, an already-seeded company's row at that index has another key. `pnpm db:seed` then stops with a primary key violation on every environment. | `onConflictDoNothing()` with no target, or an id derived from the four keys. | plausible (read; no current list change triggers it) |
| L3 | low | `documents.ts:328-366` (`setDocumentRequirement`) | `for('update')` on a row that does not exist locks nothing, and `document_requirements_step_key_unique` is not in `constraintReasons`. | Two Executives add the same requirement at once. The second gets a generic failure rather than a sentence. | `constraintReasons: { document_requirements_step_key_unique: '<a reason with a sentence>' }`. | confirmed (read) |
| L4 | low | `0241_j3_documents_rls.sql:229-236` (`app.documents_missing`) | The definer checks the company and a permission at any scope, but not that the caller may read the customer. | A tele-caller (`documents.read:own`) asks about any customer of the company and learns which mandatory papers, an identity proof included, that customer has filed. | When `documents.read` is held only at `own`, also require the customer's owner (or, once J1 is in, the project's assignee). Or accept this and write it in DATABASE's definer row. | confirmed (read) |
| L5 | low | `apps/web/src/workers/files/sweep-uploads.ts` (unchanged); `documents-dialogs.tsx:164-170` | A customer document that passed its checks but was never filed has no owner. This happens when the dialog closes while the check runs, or when the filing is refused (a kind not accepted, a sensitive kind). Only its uploader can read it, no screen lists it, the sweep takes only `pending` uploads, and no retention applies (DATABASE §7 has none yet). | Masked copies of identity papers stay in the store with no way to file or delete them. | List a person's unfiled uploads in the section (File it / discard), or sweep unfiled customer documents after a set time. Decide this with the retention period. | confirmed (read) |
| L6 | low | `apps/web/next.config.ts` | `tesseract.js` is now external. Its worker script and `tesseract.js-core`'s WebAssembly may not be traced into a Vercel function (the builder says so too). | When hosted OCR is turned on, the masking step may throw `MODULE_NOT_FOUND` outside the timed path. An upload then waits in its checks with the original bytes still under the upload key until it is delivered again. It fails closed today, because a hosted runtime has no masker and refuses at once. | Before hosted OCR goes on, check the traced files of the file-check route (`outputFileTracingIncludes`) and add a smoke test on a preview. | plausible |

**Checked and sound:**
- **Data isolation:**
  - The three tables are in `ENTITY_TABLES`, with fixture rows per company (a bill and an identity paper, each from its own file, an identity row, a requirement) and matrix rules (`all` for sensitive rows).
  - Row security is forced, every policy fails closed on a null context, and `app_reader` is named on every select policy.
  - `identity_documents` is scoped through its document and only while it is filed, with no update or delete grant.
  - A customer is reached through `account_entities`. The restrictive `files_customer_document_insert` holds an upload to a customer of the company within the uploader's scope.
  - `files.account_id` has no update grant, and `files_account_check` lets only this purpose name a customer.
  - The general `files_read` returns nothing for this purpose (a null grant).
  - `readonly_reporter` reads none of it: no policy, and `nobypassrls`.
- **Definers:** `app.file_is_filed()` and `app.documents_missing()` check a permission in their bodies, set `search_path = ''`, and revoke execute from `public` and `readonly_reporter`. Both are granted to `app_reader` and listed in DATABASE and in `grants.test.ts`.
- **Commands:**
  - Denied, wrong-company, agent and happy-path tests exist for the four commands.
  - All four are `peopleOnly`, and so is `files.upload.begin` (with `voiceSession`).
  - All five inputs are in the people-only sweep.
  - `auditFields` carry labels.
  - Opening a sensitive document is audited. The audit carries ids, kinds and counts only.
  - `file_customer_mismatch` is checked against `files.account_id` before anything is written, and the test shows no row is written.
  - A file that is unclean, not ready, unscanned on a hosted runtime or unmasked is refused.
  - The partial unique index settles a double filing (`constraintReasons`).
  - The runner's `maskInputIdentity` also covers an Aadhaar number typed into an unfile reason or a file name.
  - Cost permissions are untouched, and there is no money in this slice.
- **Identity digits:**
  - The store key is `<company>/customer_document/<id>`, with no name in it.
  - The name keeps only the last four digits of Aadhaar- and phone-shaped numbers (probed; see L1 for bank numbers).
  - `scan_result` keeps only four-digit strings, filtered twice (`fours()`, the contract regex, and the command's regex).
  - `last4` has a check constraint, and no column can hold more.
  - The original bytes are deleted after the checks. The paged PDF keeps only masked page pictures. With no masker, the upload is refused at once.
  - The worker's log lines carry ids and reasons only.
  - The item 8 test reads rows, audit, outbox, the memory logger, the console, mocked Sentry and the store keys. It OCRs the kept copy and was shown to fail when masking is off (builder's evidence).
- **Web layer:**
  - Reads go through `executeQuery()` with a name, and writes through `executeCommand()`.
  - Settings › Document requirements uses `screenAccess(navRequires(...))`.
  - Browser code imports only types from `@shakti/contracts`, with the value lists in `screens/document-values.ts`.
  - `openFile` refuses this purpose, so a sensitive opening always goes through the audited command.
  - Nothing reads a secret or connects at import time.
- **Copy:** in `en.json`, plain and final.

**Runs (each through `heavy.sh`, on 54331 after `db:migrate` and `db:seed`):**
- db security: 1,834 passed (63 files);
- domain security: 1,534 passed (111 files);
- web security: 464 passed, 2 skipped (40 files);
- contracts unit: 340 passed;
- db unit: 1 failed (M1), 160 passed.

**Not checked:**
- The two masking cases of SECURITY §11 item 8 (`customer-documents.test.ts`) were skipped here. This VM has no OCR model (`OCR_LANG_PATH` is empty), and fetching one is outside a reviewer's remit, so I rely on the builder's run with CI's pinned model.
- No journey was run, because this session cannot sign in. That covers all of `apps/web/e2e/documents.spec.ts`: the Project Manager's view and opening, the Project Manager's upload of a bill and an identity paper, the Field Engineer's view, and the Executive's requirements.
- The upload case skips in CI's journeys job, because it has no OCR model.
- No Linux screenshot baselines are on the branch (`customer-documents`, `document-requirements`; the host-made ones were removed), so I could not do the layout check. The lead makes and looks at them at integration.
- I did not rerun web unit tests, typecheck, lint, the build or the JavaScript budget; the builder's results stand.
- The EXPLAIN figures are the builder's (the same queries).

### 28-11-2026, the lead's triage
- **Fix in the one fix round:**
  - **H1**, all four parts: (1) refuse filing under any other kind with the new reason `document_identity_kind`, with a catalogue sentence, whenever the file's `scan_result.lastFour` holds Aadhaar or bank account digits, or any earlier document of the file was sensitive; (2) `files_customer_document_read` reads a file only through a filed document (`d.unfiled_at is null`), and a file any document of which is sensitive is treated as sensitive, through a small definer that checks the permission and sets `search_path = ''`; (3) the tests as written; (4) SECURITY §5's sentence.
  - **M1:** run `pnpm db:docs` and commit.
  - **L1:** mask any run of 9 to 18 digits in a customer document's name to its last four, and add a test.
  - **L2:** derive each seed row's id from its keys, so a list change cannot collide, or use `onConflictDoNothing()` with no target; say which.
  - **L3:** add `constraintReasons` for `document_requirements_step_key_unique`, with a sentence.
  - **L4:** when `documents.read` is held only at `own`, `app.documents_missing()` also requires that the caller owns the customer, with a test. J1 widens it to the project's assignee at its merge.
- **At the merge (the lead or the prep), not in the fix round:** **H2**. `app.file_purpose_grant()` is written as `main`'s latest (0242, `label_sheet`) plus the `customer_document` writer, and `purposes.ts` is taken from both sides. `pnpm db:docs` runs again after the merge.
- **Follow-ups, not fixed here:** **L5** (unfiled customer uploads: list them or sweep them, decided with the retention period in DATABASE §7) and **L6** (the traced files for `tesseract.js` and a preview smoke test before hosted OCR goes on). Both are recorded in STATUS.
- Run `pnpm format:check` before the `report: j3-documents fixes` commit.

## Integration
