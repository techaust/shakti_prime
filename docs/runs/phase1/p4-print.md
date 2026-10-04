# P4 Print and letterhead (wave 2)

| | |
|---|---|
| Branch | `feat/p4-print-letterhead` on GitHub (6511293, from `main` at #88) |
| PC worktree | `p4-print`, slot 9: Postgres 54339, app 3039 |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026); the review becomes the first step of the cloud [trial](../../runbooks/hybrid.md#10-the-trial) once the environment exists |
| State | integrated, pull request open (its migrations are 0090 and 0091) |
| Next step | merge-on-green, then dev and staging migrated and the proof's render measured on dev |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §6.4](../../design/phase1.md#64-p4-print-and-letterhead)
- ADR 0009 (PDFs render in a Vercel function in `bom1` with `playwright-core` and `@sparticuz/chromium`, both installed)
- BLUEPRINT §11 (print always renders light) and §7 (bank details are sensitive)
- DESIGN.md print tokens
- the print module `apps/web/src/print` and `docs/spikes/print.md`
- P2's files (`packages/domain/src/files`, `apps/web/src/files`, `apps/web/src/workers/files`)
- `FieldCipher` (`packages/domain/src/privacy/field-cipher.ts`)
- the event workers (`apps/web/src/workers/events`, `system:workers` with `files.process`)
- Skills: `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`, `supabase-postgres-best-practices`.
- S1 quotes registers the quote as a document type later; P4 touches no file of C2, C3 or C4.

1. **Fonts:** static Inter files at the weights the templates use (400; 510, or 500 where no static 510 exists; 590, or 600) replace the variable font in `apps/web/src/print/fonts`, embedded as the renderer does, with the licence file kept.
2. **Company print details:** the selling company's logo, letterhead and bank details.
   - Logo and letterhead come from P2's files (purposes `entity_logo`, `letterhead`).
   - `entities.bank_json` holds bank name, account number, IFSC and branch, sealed with `FieldCipher`, never stored or logged in clear; the audit records only that bank details changed and the last four digits of the account number.
   - Set through `org.entity.update` and the companies screen by an Executive; read in clear only by the print loader and by a holder of `admin.entities.write`.
3. **Render worker** `POST /api/v1/workers/pdf/render`, QStash-signed like the other workers, body `PdfRenderJob` (document type, document id, company id, idempotency key):
   - a registry of document types, each with a loader that reads the document as `system:workers` through `executeQuery()`;
   - Chromium (`@sparticuz/chromium` on Vercel, the local Playwright Chromium elsewhere, no network fetch at render time);
   - the PDF stored through the file store, and the type's attach command called as `system:workers`;
   - the Vercel function settings set and explained. A failed render is retried by QStash and ends as a dead letter on Integration Health.
4. **The first document,** a company letterhead proof (`company_letterhead_proof`): "Print a sample" on the companies screen for an Executive renders one page with the letterhead, logo, address, GSTIN and bank details through the same worker, stores it and offers it to open. The quote template prints the selling company's details from the same loader data, tested with fixtures.
5. **Tests:** unit tests for the loaders, the registry and the template data (the selling company's details and nothing of another); security tests (a person cannot call the render route; a principal without `files.process` cannot store a PDF; bank details unreadable without `admin.entities.write` and never in the audit or the logs; a wrong company refused); the agent refusal sweep green; pixel snapshots of every template (quote and labels, light only) through `snap()`; a journey with axe for "Print a sample".
6. **Documents:** ADR 0009 as built, design §6.4 "Built (P4)", DATABASE, SECURITY, API, DEPLOY, `pnpm db:docs`.

Done when: the checks of AGENTS §10 pass on the branch, the companies page stays within its JavaScript budget entry, and one sample PDF renders locally end to end (its size and time recorded).

## Report
### 04-10-2026, lead session on the PC (integration)
- Review fixes in 4f8f33c; `main` merged in c859eb9 (0075 and 0076 became 0090 and 0091; the renumber script's last snapshot was rebuilt by hand, because its `drizzle-kit` ran before `pnpm install`); `loadCompanyForPrint` added to the reader parity sweep in c4128ef; Linux baselines in 2fb887c.
- The integration run passed every step except two: the security suite's parity test (fixed and rerun) and the journeys. The journeys timed out in C2's customer and lead specs while three builders loaded the PC. A rerun with one worker: 171 passed, 1 failed (C2's consent journey timed out in desktop-light), 2 flaky. The print journeys passed throughout.
- Not verified locally: the Linux screenshot verification run timed out at sign-in on the overloaded PC; CI's Linux journeys compare every screenshot.

### 04-10-2026, builder on the PC
- Built at 6511293: `entities.bank_json` sealed by `FieldCipher` under the company's context, with `bank_details_set`; no request role selects `bank_json`, read only through the definer `app.entity_bank_envelope()` for `admin.entities.write:all` or `files.process`; `org.entity.update` takes `bankDetails`, audited as `bankAccount` with the last four digits.
- The current logo and letterhead are each company's newest ready file of that purpose, as Settings › Companies shows them, so `entities` holds no file ids; one logo serves both themes because print is always light.
- The purpose `print_proof`; the commands `files.document.record` and `print.proof.request`; the event `print.document.requested` sent to `/api/v1/workers/pdf/render` as a `PdfRenderJob`; `renderPdfJob` in `apps/web/src/workers/pdf`; Chromium through `@sparticuz/chromium` on Vercel. Migrations 0075 and 0076 on the branch.
- Checks on the branch: unit tests 2,423, security suite 1,519, journeys 150 on Windows, all green; the proof PDF 78 KB in 1.55 s locally.
- Not done: the static fonts (item 1). The builder had no network to fetch them.

## Review
04-10-2026, `slice-reviewer` on the PC, at 6511293 against the merge base e5dd151: no critical or high finding. Fixed by the lead session in 4f8f33c, the merge with `main` and the commit after it.

| # | Severity | Finding | State |
|---|---|---|---|
| M1 | medium | `serverless.executablePath()` finds `bin` beside the package's real path in pnpm's store, but the route traced `bin/*.br` only under the link path, so a plain-file copy on Vercel would fail every render | fixed: `outputFileTracingIncludes` names the real path (`../../node_modules/.pnpm/@sparticuz+chromium@*/…/bin/**`); proven only by the render on dev after the merge |
| M2 | medium | `main`'s event catalogue needs `meaning` and `emittedBy` on every entry; `org.entity.updated`'s meaning left out the bank account | fixed in the merge: both added, `pnpm db:docs` regenerated `EVENTS.md` |
| L1 | low | "Only Executives see the full number." is untrue: the proof page and later quotes print it | fixed: the Activity log keeps only the last four digits |
| L2 | low | SECURITY said the account opens only in commands; the Executive's form opens it in a query, unaudited | fixed: SECURITY says so; a clear-text read writes no audit row (lead decision, each change is audited) |
| L3 | low | DESIGN §7 and design §6.4 promised light and dark logo ids on `entities`; built is the newest ready file of each purpose, one logo | fixed: both documents aligned, a DECISIONS row (lead) |
| L4 | low | ARCHITECTURE did not mention that `print.document.requested` goes to the render route, not a URL group | fixed |
| L5 | low | the route's 4 KiB cap refused a label sheet over about 100 ids that the contract allows (500) | fixed: the render worker's own cap, 24 KiB (`PDF_JOB_MAX_BYTES`), its test and the documents |
| L6 | low | an assertion that could not fail; no check of the render path's log lines | fixed: the assertion dropped; a test captures the log lines of a render and of a render failing after the account is opened, and finds none of the account |
| L7 | low | the snapshots are of the template's HTML page, not the PDF: the footer and page breaks are never compared | accepted, written into ADR 0009; a rasterised first-page check of a real PDF may follow with S1 quotes |
| L8 | low | the old account was opened (a KMS call on hosted runtimes) while the company row was locked | fixed: opened before the lock, for a company in the request only, so a wrong company still answers `not_found` |
| L9 | low | `maxLength={18}` counted the spaces of a grouped 18-digit account | fixed: 24 |
| L10 | low | each proof page keeps a full account in a permanent file, so a replaced account stays readable | open: a follow-up in STATUS (remove a company's earlier proof pages when a new one is printed) |

The reviewer ran the slice's db and domain security files on its database (290 passed), the render route (12), and the web, domain and contracts unit tests it touched; it did not check the hosted runtime (M1's proof, KMS, the cold start) or the Linux journeys.

## Integration notes
1. **Static fonts** (done, owner's go-ahead 04-10-2026: the rsms/inter v4.1 release, Regular, Medium and SemiBold, each `@font-face` covering a band of weights): the lead session downloads Inter 4 static woff2 files at 400, 500 and 600 (the rsms/inter release or Google Fonts) into `apps/web/src/print/fonts` and changes `FONT_FILES` in `apps/web/src/print/styles.ts`.
2. **Take `main`** (done: 0090 and 0091; C2 is on it): the branch's 0075 and 0076 move after `main`'s last migration ([slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice)); fix the numbers its documents cite.
3. **Integrate** on the PC, then the Linux baselines on a fresh database: `print-quote`, `print-proof`, `print-label-50x25`, `print-label-100x50`, `proof-dialog`, `companies`.
4. CI has no `FIELD_ENCRYPTION_KEY`, so no journey enters bank details.
5. **After the merge:** migrate dev and staging; measure the proof's render on dev and record it in `docs/spikes/print.md`.
