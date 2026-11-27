# Q1 Labels (wave 2)

| | |
|---|---|
| Branch | `feat/q1-labels` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): print templates, an audited reprint |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder on Opus 5.5 at high, the seat's own account (started and finished 27-11-2026) |
| State | done |
| Next step | the builder |

## Brief
Build [phase3 §7.4](../../03-roadmap-appendix/phase3.md#74-q1-labels) as written, with question 9 (a). Points the design leaves to you, settled here:

1. **Templates:** `apps/web/src/print/label-template.ts` moves into the print registry (`print/documents.ts`) with three kinds:
   - a serial label: item, SKU, serial and company;
   - a bin label: hub and bin code;
   - a package label: dispatch number, package n of m, customer and place, and hub. D2 fills it later; give it a fixture now.

   The two sizes of question 9 (a) go in `WORKSHOP_DEFAULTS.labels`. Every label renders light, in English, with Inter embedded, as the print rules say.
2. **Payloads:** `SP1:S:<serial id>`, `SP1:B:<bin id>`, `SP1:P:<package id>`, parsed by `parseLabelPayload()` in `packages/domain` (pure, with unit tests for each kind, unknown prefixes, foreign codes and bad ids). Add `resolveScannedCode()`, a query answering the serial, bin or package the caller may read, or "unknown" or "not ours", under the caller's own row security.
3. **Printing:**
   - Print labels on a receipt (every serial received; wire this to U2's receipt only if U2 has merged when you reach it, else leave the action for U2 and name it in the report), a bin, a serial and a hub's bins.
   - A reprint is audited by a command `inventory.label.reprint` (what, how many, why).
   - A batch of 500 labels renders inside the print budget (`docs/04-architecture-appendix/print.md`); measure it and record the time.
4. **Scan back:** U2's scan field takes a `resolve(code)` prop. Whichever of Q1 and U2 merges second wires `resolveScannedCode` into it (one line). If U2 is not on `main` when you finish, export what U2 needs and say so.
5. **Tests:** every label's QR decodes back to its payload with `jsqr` (already in the repository for the print spike; if it is not installed in the workspace you need, report it and do not add it). Plus the reprint's audit, and the batch time.
6. **Screens:** Print labels on the bin list, the serial page and the hub page; a reprint dialog with a reason. Journey: the Inventory Manager prints a hub's bin labels and reprints one serial's, with axe and snapshots of the dialog (the label preview is a print page, already covered by the print pages' set-up).

**Early check (Tier B):** once `parseLabelPayload`, `resolveScannedCode`, the templates and the reprint command are committed with their tests, write a short report and push `report: q1-labels early check`, then stop.

Files owned: `apps/web/src/print/label-template.ts` and the label kinds in `print/documents.ts`; `packages/domain/src/labels/` (new); the reprint command and its query; the Print labels actions.

Do not touch: the scan field (U2); the receipt screens (U2); dispatch (D2 later).

Review checklist: every payload decodes; an unknown or foreign code says so and opens nothing; the resolver obeys row security; the reprint is audited; the batch fits the budget.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5, §10, §13 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: q1-labels <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: q1-labels blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (wave 2, 27-11-2026):**
- `x4-stock-reasons`: the reason registry of `app.stock_move()`;
- `h2-reservations`: reservations and availability, and the only body change to `app.stock_move()`;
- `u2-purchase-orders`: purchase orders, receipts and the scan field;
- `h3-stock-counts`: stock counts;
- `q1-labels`: labels and `parseLabelPayload()`;
- `r3-warranty`: warranty claims and supplier returns;
- `calling-hours-clock`: the calling screen outside calling hours.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the print document registry, the testing lists, `nav.ts`, `turbo.json` and `.env.example`.

## Report

### Early check, 27-11-2026, seat (cloud VM worktree `/home/user/shakti-wt/q1-labels`, Postgres 54331)
Skills loaded: `add-command`. Tier B: stopped here for the lead's read of the diff; the screens, actions and journeys come after.

**Built (files):**
- Contracts `packages/contracts/src/inventory/labels.ts`: label kinds and sizes (moved here from `worker-jobs.ts`), `PrintLabelsInput` (1 to 500 distinct ids), `ReprintLabelsInput` (1 to 100 ids and a note of 3 to 300 characters), `LabelSheetDto`, `LabelsForPrintDto`, `ResolveScannedCodeInput`, `ScannedCodeDto` (`serial`, `bin`, `unknown`, `not_ours`). The render job's labels target gains `sheetId`. File purpose `label_sheet` (`RENDERED_FILE_PURPOSES`, `FILE_PURPOSES`). Event `print.labels.requested` (sheet id, kind, size, ids; subscribed).
- Migrations (numbered after `main`'s 0239, for the lead to renumber): `0240_q1_label_sheet_files` (the `files_purpose_check` widened, `NOT VALID`), `0241_q1_labels_rls` (`app.file_purpose_grant()` with `label_sheet`: written by `files.process`, read with `inventory.stock.move`; the definer `app.labels_for_print(kind, ids)`, `files.process:entity` only, serials of the request's companies and live bins, in the order asked).
- Domain: `packages/domain/src/labels/payload.ts` (`labelPayload()`, `parseLabelPayload()`), `queries/inventory/labels.ts` (`resolveScannedCode`, `loadLabelsForPrint`), `commands/inventory/labels.ts` (`inventory.label.print`, `inventory.label.reprint`), registry, `WORKSHOP_DEFAULTS.labels.sizeByKind` (serial and bin 50 × 25, package 100 × 50), file purpose rule and limit.
- Web print: `print/label-template.ts` rewritten for the three kinds (serial: company, item, SKU, serial; bin: hub name, bin code large, hub code; package: hub, customer, dispatch number, package n of m, place); `print/documents.ts` gains `LABEL_TYPES` (serial, bin; package left for D2), `labelPrintsOf()`, `printLabelSheet()`; `workers/pdf/render-job.ts` prints a document or a sheet through one path (`label_sheet` file under the sheet id); `workers/pdf/job.ts` `labelsJobOf()`; the event routed in `EVENT_JOB_ROUTES` and the in-process worker registry. Fixtures `spikeLabels`, `spikeBinLabels`, `spikePackageLabels`; `e2e/setup/print-pages.ts` and `e2e/print.spec.ts` now snapshot `label-serial`, `label-bin`, `label-package` (the two old label baselines are deleted; the lead makes the three new Linux baselines).
- Audit labels (`labelPrint`, `labelReprint`, `labelsRequested`, fields `labelKind`, `labelCount`, `labelNote`, the `labelKind` code group), error `label_target_missing`, `files.purpose.label_sheet`, `print.label.*` copy (the old "Scan for warranty" caption is gone: the code carries an id, not a page).
- Documents: DATABASE (the definer row, the `label_sheet` purpose), `docs/data/*` and `docs/state-machines/readme.md` regenerated.

**Tests added:** `labels/payload.test.ts` 5 (each kind, scanner Enter and capitals, unknown versions, letters and ids, foreign codes); `tests/commands/labels.test.ts` 13 (print and reprint denied for Store Manager, GM, Accounts, Field Engineer and an agent; another company and another company's serial refused; archived bin, unknown id, repeated id and package refused; event and audit of a print; reprint audited per serial with kind, count and note, a bin's row for no company; the resolver's serial, bin, unknown and not-ours answers under the caller's policies; the worker's read in order, refused to persons); `apps/web/src/print/labels.test.ts` 12 (every kind's QR at both sizes decoded with jsQR from the label's own SVG, and parsed back to its id); `apps/web/tests/label-render.test.ts` 5 (the route prints a hub's bins once, a duplicate renders nothing; only the company's serials; an empty sheet refused for good; no `files.process`, nothing stored; command → event → in-process worker → `label_sheet` file read by the Inventory Manager, not by Store Manager, GM, tele-caller or another company's Inventory Manager); `job.test.ts` 2 new. Updated: reader parity (2 reads), agent refusal sweep (2 people-only inputs), files and role × company matrices, grants list, contract values, workshop defaults, event catalogue.

**Checks:**
- `pnpm typecheck`: 10 successful, 10 total.
- `pnpm test`: 10 successful; web 1255 passed, 1 skipped; domain 2811; contracts 340; db 161.
- `pnpm test:security` (local Postgres 54331): db 1785 passed (62 files), domain 1534 passed (111 files), web 466 passed (40 files); 4 of 4 tasks.
- `pnpm copy-lint`: clean. Folder lint of every touched folder: clean. `pnpm db:docs`, `machines:docs`: regenerated.
- Real Chromium (`/opt/pw-browsers`): every kind's whole label rendered at 203 and 300 dpi decodes back to its payload with jsQR (16 of 16). A sheet of 500 labels, warm, three runs each: serial 50 × 25 mm 0.88 / 0.94 / 1.13 s (1.03 MB, 500 pages), bin 50 × 25 0.95 / 0.81 / 0.68 s (0.91 MB), package 100 × 50 0.85 / 0.89 / 0.82 s (1.09 MB); the template alone 0.15 to 0.23 s. The budget is the render route's 60 s (`maxDuration`, ADR 0009).

**Not run yet:** build, `js-budget`, journeys (screens not built). No list or search is added: the resolver and the worker's read go by primary key.

**Decisions the brief left open (assumptions):**
1. Printing is asynchronous through the render worker, as ADR 0009 requires: both commands emit `print.labels.requested`, and the PDF is a `label_sheet` file under the sheet's id that the screen waits for, as the proof page does.
2. A first print is `inventory.label.print` (audited once per sheet: kind and count); a reprint is `inventory.label.reprint` (audited once per serial or bin: kind, count, note). Both need `inventory.stock.move` at company scope and are for people only (Executive and Inventory Manager today; the Store Manager holds only `inventory.stock.read` and so neither prints nor opens a sheet). No new permission.
3. A bin is the group's, so a bin sheet is printed in the caller's chosen company and a bin reprint's audit row belongs to no company, as the hub commands write.
4. The QR carries `SP1:<letter>:<id>` and nothing else; the parser trims what a scanner adds and reads the prefix in any case. `unknown` covers our prefix with another version, letter or a bad id; anything else is `not_ours`.
5. Package labels: template, fixture and snapshot only; the loader, the resolver and the commands refuse or answer `unknown` for packages until D2 adds its table.
6. Label sheets are kept as files; no retirement of old sheets (they hold no secret).

### Done, 27-11-2026, seat (cloud VM worktree `/home/user/shakti-wt/q1-labels`, Postgres 54331, app 3031)
The lead accepted the early check with assumptions 1 to 6. Built after it from `4d64605a`. U2 is not on `main` (checked at 16:00 UTC; `main` is at `59736c74`, documents only), so the receipt is not wired, and `app.file_purpose_grant()` stays one redefinition carrying `main`'s latest lines (0235) plus `label_sheet`.

**Built (files):**
- Actions `apps/web/src/actions/labels.ts`: `printLabels`, `reprintLabels` (a request narrowed to the company named) and `resolveScannedCode(code)` (the caller's request).
- `apps/web/src/components/inventory/labels-dialog.tsx`: one dialog for Print labels and New label. A reprint first asks why (3 to 300 characters). The dialog then waits for the sheet's file and offers Open the labels. It is loaded on demand from the two screens, which kept `/inventory/serials/[id]` inside its JavaScript budget.
- `apps/web/src/components/files/wait-for-file.ts`: the proof dialog's file wait, moved out of `proof-dialog.tsx` so both dialogs share it.
- `/inventory/hubs` (`hubs-screen.tsx` and its page): Print labels for <hub>, which prints every bin of a godown or factory, and New label for <bin> on each bin row. Both are shown only with `inventory.stock.move` for a company. Transit bins get no label.
- The serial page (`serial-screen.tsx` and its page): Print the label again.
- Copy under `inventory.labels`; six button keys added to `tools/copy-lint/copy-lint.config.json`.
- Documents: the Built (Q1) record in phase3.md §7.4, the render route row in API §3.6, `files.process` and a Labels line in SECURITY.
- Journeys: `apps/web/e2e/labels.spec.ts`, with its seed `e2e/setup/labels.ts` (one serial-tracked item and serial per project in the stock journey's first bin, wired into `seed.ts`) and `LABEL_JOURNEY` in `e2e/support/users.ts`. The spec exports `loadCatalogueAsModule` from `e2e/support/quote-pdf.ts`.

**For U2:** the scan field's `resolve` prop is `resolveScannedCode` from `apps/web/src/actions/labels.ts`. It answers `ActionResult<ScannedCodeDto>`: `serial` (id, company, item, SKU, number, state, bin), `bin` (id, hub, codes, kind), `unknown` or `not_ours`. Print labels on a receipt is one call of `printLabels({ entityId, labelKind: 'serial', ids: <the receipt's serial ids> })` in a `LabelsDialog` with `mode="print"`.

**Journeys** (run here through the lock after `pnpm build` and `e2e:seed`, with `labels.spec.ts`, `print.spec.ts` and `inventory.spec.ts`; they signed in on this VM):
- **Passed:**
  - Every `labels.spec.ts` test in all three projects. The Inventory Manager prints the Journey godown's 4 bin labels and opens the PDF. The Inventory Manager prints a serial's label again: the dialog refuses an empty reason, then prints and opens the PDF. Focus returns to the button each time. Axe passed at every step.
  - On desktop light, every kind's whole label printed by Chromium at 203 dpi reads back with jsQR, and a sheet of 500 prints in under the 20 s limit (about 1 s measured). Both tests are skipped on the other two projects by design.
- **Failed only on screenshots (10 tests, 20 comparisons with retries):** each failure is a `toHaveScreenshot` mismatch against the Linux image's baselines, which this VM is not.
  - Most are pages this slice does not change: the quotation, the real quotation, the proof page, the phone proof dialog and the stock valuation.
  - `stock-hubs` is also expected to change, since the Executive now sees the label buttons.
- **Baselines the lead makes in the Linux image:** `labels-hub-dialog` and `labels-reprint-dialog` for the three projects; `print-label-serial`, `print-label-bin` and `print-label-package` (desktop light); a new `stock-hubs`; and the `/design` preview, whose label changed in the early check. I deleted the baselines this VM wrote and committed none. On this VM the reprint dialog's picture shows a small magenta box at its left edge: a masked time cell of the page behind the dialog.

**Checks before this report:**
- `pnpm typecheck`: 10 successful.
- `pnpm test`: 10 successful; web 1255 passed, 1 skipped; domain 2811.
- `pnpm lint` (whole repository, the final check): clean.
- `pnpm copy-lint`: clean.
- `pnpm build`: passed.
- `pnpm --filter web js-budget`: every page within budget (65 pages); `/inventory/serials/[id]` 238.2 of 242 kB, `/inventory/hubs` 242.1 of 246 kB.
- `pnpm test:security`: not run again. Since its full run at the early check (db 1785, domain 1534, web 466) no schema, policy, definer, command or query has changed; only actions, screens, journeys and documents.
- `EXPLAIN (ANALYZE)`: none, since no list or search was added. The resolver and the worker's read go by primary key.

**Review checklist:**
- Every payload decodes: the unit test, the e2e test and the 16 Chromium renders all read back.
- An unknown or foreign code says so and opens nothing: the resolver answers `unknown` or `not_ours`. The screen side waits for U2's scan field.
- The resolver obeys row security: tested for another company's serial, an archived bin and a caller without `inventory.stock.read`.
- The reprint is audited on each serial or bin with the kind, the count and the note.
- The batch fits the budget: about 1 s against the route's 60 s.

**Decisions after the early check:**
1. The hub's Print labels prints every live bin of a godown or factory except transit bins; a hub whose bins are all transit shows no button. A bin's single label is New label for <bin>, a reprint with why. The first print of a newly added bin is the hub's Print labels.
2. On the hubs page, labels are asked for in the company the caller acts in (the active company, else their first), since a bin belongs to the group.
3. The labels dialog is loaded on demand, as the companies screen's dialogs are, which kept the serial page inside its budget without changing `js-budget.json`.

## Review

### Review, 27-11-2026, seat (slice-reviewer, Opus 5.5 at high; worktree `/home/user/shakti-wt/q1-labels`, Postgres 54332)
Reviewed `git diff origin/main...feat/q1-labels` at `7cb4036a` (`main` at `59736c74`) against the Brief, [phase3 §7.4](../../03-roadmap-appendix/phase3.md#74-q1-labels), question 9 (a) and PRD INV-07. No critical or high finding: nothing blocks the merge. Both medium findings should be fixed before the merge. M2's fix is one line, and M1 is an item the Brief asks for.

**Findings**

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| M1 | medium | `apps/web/src/components/inventory/serial-screen.tsx:64`; `hubs-screen.tsx` bin row (`newLabel`) | A single serial or bin can't be printed for the first time. The serial page and the bin row offer only the reprint (`inventory.label.reprint`), which needs a reason. The Brief (points 3 and 6) asks for Print labels on a bin and on the serial page, beside the reprint dialog. | A serial that enters stock by an adjustment gain, a count's surplus or a transfer has no receipt (U2), so it was never labelled. To label it, the Inventory Manager must type a reason such as "torn" or "lost", and each serial's audit trail then records a reprint that never happened. A bin added to a hub can be labelled first only by printing the whole hub again, which wastes a label for every bin. | Give the serial page and the bin row a Print label button (`LabelsDialog mode="print"`, `inventory.label.print`, no reason), and keep Print the label again for reprints. Add both to the journey. | confirmed (code read end to end) |
| M2 | medium | `apps/web/src/components/inventory/hubs-screen.tsx:113` | The bin row's actions sit in a flex row that doesn't wrap (`flex justify-end gap-2`). On a phone, DataGrid puts this cell in the 3fr column of the card (about 170 px). The current phone baseline `stock-hubs` already fills that column with Edit and Archive, which spill left into the Kind column. This slice adds a third button, New label for <bin> (about 150 px). | The Executive's `/inventory/hubs` on a phone, which the `stock-hubs` phone baseline captures: the three buttons run about 370 px wide in a 170 px column. They spill past the card's left edge and overlap the Kind label. The dispatch and receiving rows get two buttons, about 300 px. | `flex flex-wrap justify-end gap-2` (one line). Then look at the new Linux `stock-hubs` phone baseline. | plausible (measured from the current phone baseline and the button text; not rendered) |
| L1 | low | `apps/web/src/print/qr.ts:14` with `label-template.ts:55` | The quiet zone around a label's QR code is about 2 modules, where ISO 18004 asks for 4. The payload `SP1:S:<uuid>` is QR version 3 (29 modules), so a module is 0.72 mm in the 21 mm code. `margin: 0` leaves only the label's 1.5 mm padding, about 2.1 modules, on the left, and about 2.8 modules above and below. The 100 × 50 label has the same ratio, about 2.2 modules. jsQR reads it, but `labels.test.ts` adds a 4-module margin before decoding, so it does not test this. | Some cheap handheld or phone scanners refuse a code with a narrow quiet zone. That would show up only in INV-07's final-phase check on the client's hardware. | For labels, give the code a 4-module margin: shrink the code to about 19 mm, or pass `margin` for labels. Or record the choice and check it first in the INV-07 hardware check. | plausible |
| L2 | low | `packages/contracts/src/inventory/labels.ts:102` | `ResolveScannedCodeInput` caps `code` at 400 characters. A longer foreign code fails with `validation_failed` instead of `not_ours`, so the parser's own over-400 rule can't be reached through the action. | A supplier's long QR code (a URL with tracking parameters) scanned into U2's field shows a generic failure, not "this isn't one of our labels", against the Brief's "an unknown or foreign code says so". | Allow a larger cap in the contract (say 4,096) and let `parseLabelPayload` answer `foreign`, or cut the code to its first 401 characters before parsing. | confirmed |
| L3 | low | `packages/domain/tests/queries/reader-parity.test.ts:437` | The reader-parity case for `resolveScannedCode` resolves an id that no row has, so both pools answer `unknown` without reading a serial. | A grant or policy on the `app_reader` side of `serials` or `items` that changes the answer would pass this case. Other queries cover the same tables, so the gap is narrow. | Resolve a serial and a bin that the parity fixture holds, or that the case creates. | confirmed |
| L4 | low | `apps/web/tests/label-render.test.ts:43` | The comment names `e2e/labels-batch.spec.ts`, which doesn't exist. The 500-label batch is timed in `e2e/labels.spec.ts`. | A reader looking for the batch measure finds no file. | Name `e2e/labels.spec.ts`. | confirmed |

**Checked and sound**
- **Data isolation.** No new table. The `label_sheet` purpose is in `FILE_PURPOSES`, the check constraint (`NOT VALID`, as earlier purpose widenings are), the schema and both matrix lists, with a fixture file per company (`per(e, 0x90)`). `app.file_purpose_grant()` is `main`'s 0235 body plus exactly two `label_sheet` lines (diffed). `files_read` (0066) then reads a sheet with `inventory.stock.move:entity` in its company, and fails closed. The label-render test confirms that the Store Manager, the GM, a tele-caller and another company's Inventory Manager cannot read a sheet.
- **Definer `app.labels_for_print`.** It checks `files.process:entity` and a non-empty company list in its body, has `search_path = ''`, caps at 500 ids, and limits serials to `app.entity_ids()` and bins to live ones. Execute is revoked from `public` and `readonly_reporter`, and granted to `app_user` and `app_reader`; the grants test lists it. The DATABASE row matches the body. The id array is a bound parameter, so nothing is spliced into SQL.
- **Commands.** Both need `inventory.stock.move` at company scope and are `peopleOnly`. Both inputs are in `PEOPLE_ONLY_INPUTS`. Tests cover the denied roles (Store Manager, GM, Accounts, Field Engineer, `agent:chief`), the wrong company, another company's serial, an archived bin, a repeated id and the happy path. Event, audit and `auditFields` are labelled in `screens/audit.ts` and `en.json`; `labelSheetId` is an id and is exempt. `print.labels.requested` is in the catalogue with ids, kind, size and count only, and never the note (tested). The idempotency key comes from `useCommand` per form. Cost permissions are untouched.
- **Resolver.** It answers under the caller's own RLS (`serials_read` needs `inventory.stock.read:entity` and a company of the request; `bins_read`). It answers `unknown` for another company's serial, an archived bin (bins are archived with their hub), a package or a bad id, and `not_ours` for foreign codes, and refuses a caller who cannot read stock. Every case is tested. The parser is pure and covers every kind, scanner suffixes, capitals, other versions and letters, `__proto__`, and foreign codes.
- **Races and money.** Neither command writes a table, and the sheet id is fresh per command (an idempotent replay answers the same sheet). The worker stores under the sheet id and claims by event id, so a repeated delivery renders nothing (tested through the route). No money or tax is involved.
- **Web layer.** Actions use only `executeCommand` and `executeQuery` with names, and narrow the request to the company named. Pages keep `screenAccess(navRequires())`. Client code imports only types from `@shakti/contracts`. The dialog is loaded on demand. Nothing runs at import time.
- **Worker path.** The route's 24 KiB cap fits a 500-id job (about 19.6 KB). A package sheet, or a sheet left with no printable label, is refused for good (404, no retry; tested). The in-process event worker and `EVENT_JOB_ROUTES` both point to the render path.
- **Copy.** Every string is in `en.json` and reads plainly; the six button keys are in the copy-lint config; the old "Scan for warranty" caption is gone. Axe runs at every step of both journeys, with dialog snapshots in all three projects.
- **Migrations.** `0240` and `0241` come after `main`'s `0239`, with later journal times.
- **Documents.** DATABASE (definer row, purpose list, `files` purposes), API §3.6, SECURITY (`files.process` row, Labels line), the phase3 §7.4 Built record and the regenerated `docs/data` match the code. No change-log wording.
- **Performance.** Every read is by primary key, so no `EXPLAIN` is needed. The builder's measurements: the 500-label batch took about 1 s warm against the route's 60 s; JavaScript is 238.2 of 242 kB on `/inventory/serials/[id]` and 242.1 of 246 kB on `/inventory/hubs`. Both pages are close to their limits.

**Runs here**
- `bash tools/integration/heavy.sh pnpm test:security` on Postgres 54332, a fresh database migrated and seeded by the suite: db 1785 passed (62 files), domain 1534 passed (111 files), web 466 passed (40 files); 4 of 4 tasks, exit 0.
- Web unit tests `src/print/labels.test.ts`, `src/workers/pdf/job.test.ts`, `src/print/templates.test.ts` and `src/screens`: 273 passed (33 files). Domain unit tests `src/labels`, `src/workshop-defaults.test.ts` and `src/command/registry.test.ts`: 13 passed (3 files).

**Not run or not checked here**
- Journeys: I ran none (this session cannot sign in). By reading their specs: `e2e/labels.spec.ts` (the hub's bin labels; the serial's reprint with a reason, axe, the two dialog snapshots and focus return; jsQR at 203 dpi and the 500-label time, on desktop light only), the three new label pages in `e2e/print.spec.ts`, and `e2e/inventory.spec.ts` `stock-hubs`, which changes because the Executive now sees the label buttons. Also by reading: the labels seed adds one serial per project to bin JA-01 of the Journey godown in company 1. That touches no snapshot company, so `stock-list`, `stock-card` and `stock-valuation` are unchanged.
- Layout (check 7): the slice commits no baselines, so I could not look at `labels-hub-dialog`, `labels-reprint-dialog`, `print-label-serial`, `print-label-bin`, `print-label-package` or the new `stock-hubs`. When the lead makes them, check M2 on phone, and check that a serial number of about 18 characters or more, which wraps at 6.5 pt in the 24.5 mm text column, is not clipped at the foot of the 50 × 25 serial label.
- `pnpm build`, `js-budget`, `pnpm lint` and `pnpm typecheck`: not run here. The lock was busy, and the builder reported all of them passing at `7cb4036a`. CI repeats them.

**For integration**
- U2 and R3 may also redefine `app.file_purpose_grant()` and widen `files_purpose_check`. At the merge, keep every purpose line from all of them.
- The DATABASE definer row's migration column says "Q1" for now: give it the migration number at renumbering. The `0241` comment cites `0235`, `main`'s own migration, and stays.

**The lead's triage (27-11-2026):**
- **Fix all six in the one fix round:** M1, M2, L1 to L4.
- **L1:** a quiet zone of at least 4 modules on every label kind and size. Shrink the code if it must, and re-run the jsQR decodes at 203 and 300 dpi.
- **M2:** the actions wrap, or move into a menu on a phone, the way the other DataGrid rows do it. Check the `stock-hubs` phone picture.
- **No re-check:** the lead reads the diff.

## Integration
