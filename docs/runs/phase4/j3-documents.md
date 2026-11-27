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

## Review

## Integration
