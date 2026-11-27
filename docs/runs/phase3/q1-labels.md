# Q1 Labels (wave 2)

| | |
|---|---|
| Branch | `feat/q1-labels` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): print templates, an audited reprint |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder on Opus 5.5 at high, the seat's own account (started 27-11-2026) |
| State | early check |
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

## Review

## Integration
