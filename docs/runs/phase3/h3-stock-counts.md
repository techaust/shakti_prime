# H3 Stock counts (wave 2)

| | |
|---|---|
| Branch | `feat/h3-stock-counts` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the ledger, values behind `finance.cost.read`, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase3 §7.3](../../03-roadmap-appendix/phase3.md#73-h3-stock-counts) as written. The exit gate's physical audit runs on this tool (§11). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:** `stock_counts` and `stock_count_lines` with the columns of §7.3, and the `stock-count` machine (`open` → `counting` → `review` → `posted`, or `cancelled`).
   - A new series kind for counts if a number is printed. Name your choice.
   - `expected_qty` is frozen at the start by a definer, and is readable only by holders of `inventory.stock.adjust`. A counter with `inventory.stock.move` reads lines through a view or definer that never selects it.
2. **Blind counting:** the counter's DTO, route, screen, export and error messages never carry the expected quantity, and neither does a "difference" hint. Serials are counted by scan. Until U2's scan field merges, use a plain input with the same `resolve` shape, and say in the report which one you used.
3. **Movements during a count:** a movement into or out of a counted bin after the start is listed on the review and folded into the expected quantity. The count never freezes the hub.
4. **Posting:** the `count` reason is already open (H1). Each variance becomes a `count` movement through `app.stock_move()` in one batch.
   - A serial found becomes `in_stock` through the serial machine's transitions H1 defined.
   - A serial missing becomes a loss with its reason.
   - Posting is refused while any line is uncounted or under recount.
   - Values show on the review only with `finance.cost.read`.
   - The count's sheet prints for the record from a template in the print registry.
5. **Commands:** `inventory.count.start` (scope: a whole hub, chosen bins or chosen items), `.record` (a counter's line), `.recount` (asks for a line again), `.submit` (to review), `.post` and `.cancel`, each audited with no value, with its denied, wrong-company and happy-path tests.
6. **Screens:** `/inventory/counts` (by state), the counting screen built for a phone held in one hand (bins and items only), and the review (variances, recount and post). Journeys: a counter (Store Manager: counts with no expected quantity anywhere) and the Inventory Manager (review, recount, post), with axe and snapshots.

**Early check (Tier A):** once the tables, the definers, the machine, the commands and their tests are committed, write a short report and push `report: h3-stock-counts early check`, then stop. The tests to commit first: no role without `inventory.stock.adjust` reads `expected_qty` on either pool; a posted count leaves the ledger equal to what was counted, including movements during the count; serial found and missing.

Files owned: the two tables and their migrations; the `stock-count` machine; `packages/domain/src/commands/inventory/counts*.ts` and their queries; `apps/web/src/app/(bos)/inventory/counts`; the count sheet template.

Do not touch: the scan field (U2); reservations (H2); `app.stock_move()` (H2 and X4).

Review checklist: the expected quantity never reaches a counter by any path; posting equals the count; no value without `finance.cost.read`; a count over a busy bin stays right.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: h3-stock-counts <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: h3-stock-counts blocked` with the question and stop.
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
