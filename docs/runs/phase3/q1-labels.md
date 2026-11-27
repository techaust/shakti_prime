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

## Review

## Integration
