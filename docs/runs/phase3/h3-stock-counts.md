# H3 Stock counts (wave 2)

| | |
|---|---|
| Branch | `feat/h3-stock-counts` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the ledger, values behind `finance.cost.read`, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder Opus 5.5 at high on the seat's own account from 27-11-2026 14:35 UTC; screens finished on seat 2, Opus 5.5 at high, 28-11-2026 01:40 to 06:00 UTC; fix round (lane 106), Opus 5.5 at high, 28-11-2026; the owner's answers (lane 112) and the addendum's fixes (lane 114), Opus 5.5 at high, 28-11-2026 |
| State | addendum fixes |
| Next step | integration: C1 with H2 (whichever merges second), renumbering after 0246, and the Linux baselines of `stock-counts.spec.ts` |

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

### 27-11-2026, seat (early check)
**Built** (tables, definers, machine, commands, queries and their tests; no screen yet):
- Schema `packages/db/src/schema/stock-counts.ts`; migrations `0240_h3_stock_counts` (generated) and `0241_h3_stock_counts_rls` (custom).
- `stock_counts`: company, hub, scope (`hub`, `bins`, `items` with the chosen ids), state (the `stock-count` machine), start, submit, post (with `post_note`) and cancel stamps. One live count (open, counting or review) per company and hub (`stock_counts_live_unique` → `stock_count_live`), so two counts never post the same variance.
- `stock_count_lines`: one line per untracked item in a bin, or per serial in a bin; `expected_qty` frozen at the start; first count, recount request and recount, each with who and when.
- Row security:
  - `stock_counts_read`: company and (`inventory.stock.read:entity` or `inventory.stock.move:entity`).
  - `stock_counts_insert`: company, `inventory.stock.adjust:entity`, `started_by` the caller, state `open`.
  - `stock_counts_update`: company and move or adjust, `updated_by` the caller. Column grants: only the state and its stamps.
  - `app.stock_counts_guard()`: the machine's moves only, each with its grant (submit and the first count with move; recount from review, post and cancel with adjust); nothing changes once posted or cancelled.
  - `stock_count_lines_read`: company and `inventory.stock.adjust:entity`. **Column grants: `expected_qty` is selected by no request role on either pool** (`app_user`, `app_reader`; `readonly_reporter` has nothing). No request role inserts, updates or deletes a line.
- Definers (`search_path = ''`, each checking its grant and the count's company):
  - `app.stock_count_start` (adjust) freezes the expected quantities: untracked balances above zero and every serial in a bin of the scope.
  - `app.stock_count_record` (move) records one item in one bin: a quantity, or the serials found (none is a count too). It adds a line for stock found where none was listed, with what the bin held at the start. It is the recount while one is asked. A serial must be the company's (else `stock_count_serial_unknown`) and is counted in one bin of the count at a time (`stock_count_serial_counted_elsewhere`).
  - `app.stock_count_recount` (adjust).
  - `app.stock_count_sheet` (move): the counter's view per item in a bin (to count, counted, recount) and what they entered. It has no column for an expected quantity or a difference, and a recount hides the first count.
  - `app.stock_count_progress` (move or adjust): counted per item in a bin, never per serial, so it never tells a counter how many serials to find.
  - `app.stock_count_review` (adjust): each line's expected quantity at the start and when it was counted, the count that stands, and, for a serial, whether it moved since its count.
  - Helpers no role may execute: `app.stock_count_of`, `app.stock_count_moved`, `app.stock_count_refuse`.
- **Movements during a count:** the expected quantity a variance is taken from is the ledger's when the line was counted: the balance now less the net movements into or out of the bin since. For a serial, it is where its first movement since took it from, or else where it is now. So a movement before the count is folded in, one after it is left alone, and a movement committing while the count posts changes the balance and the movements since by the same amount: what posts does not change. The count never freezes the hub.
- Machine `packages/domain/src/state-machines/machines/stock-count.ts` (`open` → `counting` → `review` → `posted`, `cancelled` from the three live states; `recount` from counting or review back to counting); registered, in use, documented (`docs/state-machines/stock-count.md`).
- Contracts `packages/contracts/src/inventory/counts.ts`.
- Commands, all people only, each audited with no value and no expected quantity:
  - `packages/domain/src/commands/inventory/counts.ts`: `inventory.count.start`, `.record`, `.recount`, `.submit`, `.cancel`.
  - `counts-post.ts`: `inventory.count.post`.
  - `counts-plan.ts` (pure): variance to movements, outs before ins.
  - `counts-shared.ts`: header lock, machine, progress, refusals.
- Posting: one `app.stock_move()` batch of `count` movements (ref `stock_count`), the poster's note on each, a missing serial's own reason where given. It emits `inventory.stock.moved` (the event catalogue now names `inventory.count.post` as an emitter). Serials:
  - a serial missing is written off (`scrap`);
  - a serial written off and found is brought back (`reinstate`);
  - a serial the ledger has in another bin is written off there and brought back here;
  - a serial that moved since its count refuses the post (`stock_count_serial_moved`: ask for a recount);
  - one recorded as having left the stock (with a customer or a supplier) refuses the post (`stock_count_serial_elsewhere`).
- Queries `packages/domain/src/queries/inventory/counts.ts`:
  - `listStockCounts` (move or read; keyset on start and id);
  - `getStockCountSheet` (move);
  - `getStockCountReview` (adjust): variances, the movements during the count, and each value at the moving average only with `finance.cost.read`, read under the viewer's own grant.
- Registration blocks: command registry, domain index, machine registry, event catalogue emitter line, testing lists (`ENTITY_TABLES`), matrix fixture rows and rules, `NARROWER` and `COLUMN_SELECT`, the reader definer list, `enum-sync` pairs, agent refusal inputs, Activity log labels (`audit.ts`, `en.json` `activity.*`), `errors.*` sentences. DATABASE §4.1 and §6.5 rows; `pnpm db:docs` and `machines:docs` rerun.

**Tests added:**
- `packages/db/tests/security/stock-counts.test.ts`: 11. Every role on both pools is refused `expected_qty` and `select *` on the lines (42501). The review answers only holders of `inventory.stock.adjust`, on both pools; a counter, every other role and another company's Inventory Manager are refused. The sheet and progress have no expected or difference column and count per item in a bin. Lines are read only with adjust and written by no request role. The definers' execute grants. The state guard refuses a counter's post or cancel by hand. Insert only as `open` in the caller's company.
- `packages/domain/tests/commands/stock-counts.test.ts`: 9. Each command is denied without its grant, to an agent and in another company; one live count per company and hub; no count of a transit hub. A counter is blind (sheet, answer, audit rows). **A posted count leaves the ledger equal to what was counted, with movements during the count folded in.** It stays right over a busy bin: the post runs at once with 12 transfers and gains in and out of the counted bin, and the bin ends at the count plus what moved after it. **A serial missing is written off; a serial found is brought back, including one the ledger had in another bin.** Submit and post wait for every count and every recount; a blind recount stands. Values only with `finance.cost.read`. The list for counters.
- `packages/domain/src/commands/inventory/counts-plan.test.ts`: 7 unit tests. `machines.test.ts`: the `stock_count` fixture (every legal and illegal move, grant and platform refusal) and 3 guard cases. `reader-parity.test.ts` covers the three queries.

**Checks:**
- `pnpm --filter @shakti/contracts --filter @shakti/domain --filter @shakti/db --filter web typecheck`: no errors.
- `pnpm exec eslint --max-warnings 0` on every folder touched: clean.
- `pnpm --filter @shakti/domain exec vitest run src`: 2866 passed.
- `pnpm --filter web exec vitest run src/screens/audit.test.ts src/errors-catalogue.test.ts`: 25 passed.
- `pnpm copy-lint`: clean.
- `pnpm test:security` (local Postgres on 54331):
  - db 1804 passed (63 files); domain 1528 passed (111 files); web 460 passed, 1 failed (39 files). The one failure is `apps/web/tests/demo-data.test.ts` ("puts the items, kits and prices…", the retail list's `PUMP-3HP` price read as undefined). It fails alone as well. It is the known paging fault `fix/demo-data-ist-day` fixes (`699a5817`, "demo-data reads every page of the retail list's prices") and touches nothing of this slice.
  - Slot database: an earlier run failed 4 of H1's hub tests (`MAX_PARAMETERS_EXCEEDED`). Three suite runs had left over 60 test transit hubs and about 150 test sites live, and `inventory.hub.create` pairs a new hub with every one of them. This slice's tests now make one godown each, with no transit hub, and archive it when the file ends. I archived the old test hubs in the slot database by hand (test data only; no hub is seeded). This slice's migrations were also rolled back and regenerated there once, before they were committed in their final form. A fresh database needs neither step.

**Decisions the brief left to me:**
1. **No series kind.** A count is not a statutory document. A new series would redefine `app.next_document_no()`, which U2 redefines in this wave. The sheet will name the count by its company, hub and start time.
2. The expected quantity is hidden by column grants from every request role, not only by a view, so no query, report or future screen can select it by mistake. The Inventory Manager reads it only through `app.stock_count_review()`.
3. A serial-tracked item has one line per serial. The counter's unit is the item in a bin, and progress counts those units, so nothing tells a counter how many serials the ledger holds.
4. An unknown serial is refused when counted. The Inventory Manager adds it by Adjust stock, and it then counts as found or matching.
5. Each recount is blind and stands once taken. A recount asked during review returns the count to counting. Submit and post are both refused while a recount is open.
6. Posting takes a required note (3 to 300 characters) for every movement, and an optional reason per missing serial.
7. The transit hub is not counted. A count of chosen bins or items takes up to 200 of them.
8. Serial numbers are masked like any other text (not in `unmaskedFields`), as H1's adjust and transfer do.

**Questions for the lead (needed before the screens and journeys):**
- **A. The Store Manager holds no `inventory.stock.move`** (SECURITY §3.2 and the seed: only the Executive, the Inventory Manager and the Field Engineer at `own`). The brief's counter journey is the Store Manager, and the design names the counter by `inventory.stock.move`. Options:
  - (a) the owner grants the Store Manager `inventory.stock.move` at `entity`, which also lets them move stock between bins;
  - (b) a new permission for counting alone;
  - (c) the counter journey uses the Inventory Manager or a customised role.

  The tests use a principal holding only `inventory.stock.move` and `inventory.stock.read`.
- **B. Blindness against `inventory.stock.read`.** No count path carries the expected quantity. But a counter who also holds `inventory.stock.read` still sees the balances on `/inventory/stock` and the stock card (H1's screens and policies). Options:
  - (a) hide the balances and movements of bins under a live count from holders without `inventory.stock.adjust`, a restrictive policy on H1's tables;
  - (b) accept it and say so in SECURITY.

**Not done yet:** the screens (`/inventory/counts`, the one-handed counting screen with a plain input in the scan field's `resolve` shape until U2 merges, the review), the count sheet print template, the journeys, `EXPLAIN (ANALYZE)` evidence, the design's Built record, `pnpm build` and `js-budget`, and copy-lint (to run with the screens' copy).

### 28-11-2026, seat 2 (done)
Builder on Opus 5.5 at high effort, continuing from the branch as seat 3 left it (screens, sheet, journeys, Built record and budgets were committed but unchecked). The VM restarted once during the run; the seat pushed what was left (`34a559e3`) and the run went on from there. Skills: `add-command` and `add-table` were loaded for the early check; none was loaded again for the screens.

**Built (whole slice, since the early check):**
- Server actions `apps/web/src/actions/stock-counts.ts` (each call narrowed to the count's company); screen helpers `apps/web/src/screens/stock-counts.ts`.
- Screens under `apps/web/src/app/(bos)/inventory/counts`:
  - `/inventory/counts`: by status, with Start a count (whole hub, chosen bins or chosen items). Component `counts-screen.tsx`, `item-finder.tsx`.
  - `/inventory/counts/[id]`: the counting screen for a phone in one hand (`counting-screen.tsx`). One item open at a time; a quantity, or serials typed or scanned into a plain field that resolves in the scan field's `resolve` shape (`resolveSerial`: ok, repeat, pattern, empty) until U2's scan field merges; stock found where none was listed. **Added in this run:** a count of more than 100 items in bins shows one bin at a time (`?bin=`, a Bin to count chooser with the items left per bin; All bins is offered up to 100), so a whole hub's count does not send every row to a phone (5.7 MB for 20,000 lines at the volume below).
  - `/inventory/counts/[id]/review` (`review-screen.tsx`): differences against the records when each line was counted, what moved in the counted bins during the count, Count again, Post (note, optional reason per missing serial), Cancel; values only with `finance.cost.read`.
  - `/inventory/counts/[id]/sheet`: the print template `apps/web/src/print/stock-count-template.ts`, shown full size in a sandboxed frame (`count-sheet-frame.tsx`) and printed from the browser.
- Menu Inventory › Stock counts (`nav.ts`); copy in `en.json` (`inventory.counts.*`, `print.stockCount.*`); JavaScript budgets in `js-budget.json` (a checks file: the owner's `checks-ok`).
- Journeys `apps/web/e2e/stock-counts.spec.ts` with their seed `e2e/setup/stock-counts.ts` and users in `e2e/support/users.ts`.
- Plan spike `packages/domain/tests/spike/count-explain.ts` (`pnpm --filter @shakti/domain exec tsx tests/spike/count-explain.ts`, local only).
- Fixed in this run: the journeys' hub and serial fields found by their exact labels; the review's Count again button named `Count again: {item} in bin {bin}` and the print link given its new-tab words as hidden text (axe `label-content-name-mismatch`); axe on the sheet page runs without its print frame (`removeFrames`, as the design preview does).

**Tests added in this run:** `apps/web/src/screens/stock-counts.test.ts` 8 (links, tones, typed quantities, serial resolution, signed differences, the bins and the bin shown); `apps/web/src/print/templates.test.ts` +2 (the sheet escapes and prints every line in IST on A4; values only for a reader of costs). The early check's tests are unchanged (db security 11, domain commands 9, plan unit 7, machine fixture, reader parity).

**Checks (seat 2, local Postgres on 54331, migrated and seeded after the restart):**
- `pnpm test:security` (before the restart, on the same code below the web layer): db 1804 passed (63 files); domain 1528 passed (111 files); web 461 passed (39 files). The demo-data failure of the early check no longer occurs.
- `pnpm typecheck`: 10 successful. `pnpm lint` (whole repository, through the lock): clean. `pnpm format:check`: clean. `pnpm copy-lint`: clean.
- `pnpm --filter web exec vitest run`: 1251 passed, 1 skipped (168 files). `pnpm --filter @shakti/domain exec vitest run src`: 2866 passed (111 files).
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within its budget (69 pages); `/inventory/counts` 243.3 kB of 256, `/inventory/counts/[id]` 207.5 of 218, `/inventory/counts/[id]/review` 243.2 of 256, `/inventory/counts/[id]/sheet` 190.8 of 201.
- Journeys: `pnpm --filter web e2e:seed` then `playwright test e2e/stock-counts.spec.ts --ignore-snapshots --retries 0`: **24 passed** (the counter's count, the review with a recount and the post, and the Store Manager, in all three projects, axe included). Sign-in works on this VM. Snapshots were not compared (`--ignore-snapshots`): `count-to-count`, `count-serials` and `count-review` have no Linux baseline yet.
- One earlier run of the whole journey set (the file filter did not take) also showed screenshot differences on most other specs and `/leads` at 45.3 kB against its 45 kB document budget in the second and third projects only. Both come from this VM's browser and from one database aging across projects (CI gives each project a fresh one), not from this slice; the lead's Linux image run decides.

**`EXPLAIN (ANALYZE)` at volume** (`count-explain.ts`; one godown of 20 bins holding 1,000 items in each, 424,520 movements, 20,015 counts over four companies, 60,060 count lines; as the Inventory Manager under the policies, the definers' inner statements through `auto_explain`):

| Read | Plan | Time |
|---|---|---|
| Count list, first page (50) | Bitmap Index Scan `stock_counts_list_idx` (company 1's 5,002 counts), top-N heapsort, hub hashed, principals memoised | 5.1 ms |
| Count list, next page | the same with the keyset `(started_at, id) <` in the index condition | 4.8 ms |
| Count list, posted only | `stock_counts_list_idx`, state filtered, top-N heapsort | 4.6 ms |
| Count list, in review | Index Scan `stock_counts_live_unique` | 0.08 ms |
| `inventory.count.start`, whole hub | freezes 20,000 lines | 650 ms |
| Counter's sheet, whole hub (20,000 rows) | inside `app.stock_count_sheet()`: Seq Scan of the lines (a third of the table is this count), grouped per item in a bin, sorted by bin and code | 87 ms in the definer; 150 to 180 ms for the query with progress |
| Counter's sheet, five items (100 lines) | Index Scan `stock_count_lines_group_idx` on the count | 0.5 ms in the definer |
| `app.stock_count_progress()`, whole hub | HashAggregate over the count's lines | 12 ms |
| Review, whole hub | `app.stock_count_review()`: one `app.stock_count_moved()` per line, each an Index Scan `stock_movements_card_idx` (company, item, moved since) at about 0.01 ms; the movements during the count by `stock_movements_card_idx` (6 ms); names and costs by key | 660 to 710 ms (800 ms for the whole query) |
| Review, five items | lines by `stock_count_lines_group_idx`, balances by `stock_balances_entity_item_idx` and `stock_balances_bin_idx`, serial moves by `stock_movements_serial_idx` | 9.7 ms |
| `inventory.count.post`, whole hub | one `app.stock_move()` batch of 2,086 `count` movements | 1.6 s |

A whole-hub review of 20,000 lines takes under a second because each line asks the ledger what moved since its count; a count of a few hundred lines, the usual case, is a few milliseconds.

**Decisions taken in this run (the brief did not settle them):**
9. A count of more than 100 items in bins shows one bin at a time on the counting screen, starting with the first bin that has items left. The counter sees the number of items left per bin, never a quantity.
10. The count sheet is not a document of the render worker's registry (`DOCUMENT_TYPES`): a worker would need `inventory.stock.adjust` and `finance.cost.read` to read expected quantities and values, which `system:workers` must never hold (ADR 0020). The sheet is the print template rendered on the Inventory Manager's own request, from the review as they may read it, and printed from the browser.
11. Questions A and B of the early check were not answered. The branch as built takes A (c) and B (b): the counter journey is the Inventory Manager (the only seeded role with `inventory.stock.move` at `entity` besides the Executive); the Store Manager's journey reads the list and cannot start, count or review; SECURITY §4 says a counter who also holds `inventory.stock.read` still reads the balances on the stock screens. Either can change without touching the count's code: (a) is a seed grant, B (a) a restrictive policy on H1's tables.

**Not done or uncertain:**
- The Linux screenshot baselines (`count-to-count`, `count-serials`, `count-review`) for the lead's integration.
- `pnpm test:security` was not run again after the restart; nothing below the web layer changed since its green run.
- U2's scan field: the counting screen uses the plain field; swapping in U2's field is one component once U2 merges.

### 28-11-2026, lane 106 (fixes)
Opus 5.5 at high. This is the one fix round: H1 parts (1) and (3), M1, L1 and L2, as the lead's triage says. L3 is accepted. No role gets a new permission, and `main` was not taken in. No skill was loaded again; each fix follows the slice's existing code.

**H1 (1): counting without `inventory.stock.read`.**
- **Menu:** the Stock counts entry (`nav.ts`) has no required grant and a new `anyOf`: `inventory.stock.read` or `inventory.stock.move` at `entity`.
  - `NavItem.anyOf` and `navAnyOf(id)` are new in `nav.ts`.
  - `visibleNav()` (`screens/menu-access.ts`) checks `anyOf`.
  - The list page refuses anyone who holds neither grant.
  - The counting page checks `inventory.stock.move` (unchanged).
  - The review and sheet pages check `inventory.stock.adjust` (unchanged).
- **Hub name:** two definers are added to `0241_h3_stock_counts_rls.sql` (unmerged, edited in place), both with `search_path = ''`, executable by `app_user` and `app_reader`, and revoked from `public` and `readonly_reporter`. The first is `app.stock_count_hub(hub)`: the code and name of a hub that has a count in the request's companies, for a holder of read or move. The list and the count's header now read the hub through it, since H1's `warehouses_read` needs `inventory.stock.read`.
- **Bins:** the second definer is `app.stock_count_bins(count)`: the count's chosen bins, or its hub's bins in use, as codes only, with `inventory.stock.move` for the count's company. `StockCountSheetDto` gains `bins`, so the counting page no longer calls `listHubs`.
- **Found stock:** the item finder (`listItems`) needs no stock grant.

**H1 (3): tests.**
- db `stock-counts.test.ts`, new case: a counter with `inventory.stock.move` alone reads the count's hub name, the sheet and the bins through the definers. On both pools they read no row of `stock_balances`, `stock_movements`, `serials`, `warehouses` or `bins`. Another company's counter is refused the bins and reads no hub name, and so is a caller who neither reads stock nor counts.
- domain `stock-counts.test.ts`, new case: that counter lists the count with its hub's code and name, opens the sheet with its bins, counts the cable and the serials, and sends the count for review. On either pool they read no balance, movement, serial, hub or bin, and the review stays forbidden to them.
- `nav.test.ts` (2 new cases): the menu shows Stock counts to a holder of read or move at `entity`, and not for `own` or for adjust alone. Every page of an `anyOf` screen calls `navAnyOf()`.
- SECURITY's H3 line now says the following:
  - Blind counting holds for a counter with `inventory.stock.move` alone.
  - A counter who also holds `inventory.stock.read` reads the balances until the owner decides question B.
  - No seeded role counts without that grant today (question A).

**M1: held serials.**
- `serialLineRefusal()` (`counts-plan.ts`) is one rule, used by both the review and the post:
  - a serial that moved since its count: `stock_count_serial_moved`, as before;
  - missing, or found in another bin than the ledger's, while reserved or picked: `stock_count_serial_reserved`;
  - the same while faulty: `stock_count_serial_faulty`;
  - found while on its way, with a customer or with a supplier: `stock_count_serial_elsewhere`.
- `planCountMoves()` checks every line in its first pass, before it plans any movement.
- The review's lines carry `postRefusal`, a new field from `STOCK_COUNT_POST_REFUSALS` in contracts. The review screen shows the sentence under the item, and instead of the post form it says that some lines can't be posted yet.
- New `errors.*` sentences: reserved ("Release the reservation or put the unit back first") and faulty ("Settle the faulty unit first"). The `_elsewhere` sentence is corrected.
- Tests:
  - unit `counts-plan.test.ts`, 2 new cases: faulty, reserved and picked serials, missing or in another bin, are refused even after an untracked line, `in_transit` gives `_elsewhere`, free stock posts, and `serialLineRefusal`'s null cases.
  - domain, 1 new case: a serial is made faulty through the serial machine (`replace` then `return_faulty`) and is missing from the count. The review names `stock_count_serial_faulty` on its line only, the post is refused with that reason and the serial number, the count posts no movement, the serial stays faulty in its bin, and the count stays in review.

**L1: values.**
- A live count is valued at the moving average now, and an item with no average has no value instead of 0.00.
- A posted count is valued from its own movements at the cost each one posted with (`stock_movement_costs`, read under the viewer's `finance.cost.read`, found through `stock_movements_ref_idx`), so a later print reads the same. A line with no difference is worth 0.00.
- The domain values test now covers no average (null, net 0.00), the average (-37.50), the post, then an average moved to 99 with the posted value still -37.50, and no value without `finance.cost.read`.
- I did not measure the posted-values read with `EXPLAIN (ANALYZE)`: it reads one count's movements by the reference index, at most one per line.

**L2: stamps.**
- `app.stock_counts_guard()` now refuses, with `stock_count_stamp` (mapped in `COUNT_CONSTRAINTS`, with a catalogue sentence):
  - a sent stamp that changes outside counting → review;
  - a posting stamp or note that changes outside review → posted;
  - a cancelling stamp or reason that changes outside the move to cancelled;
  - `state_changed_at` without a state move.
- db test, new case: each of the five stamp writes by hand, and one step that carries another step's stamp, are refused (23514, "its own step"), and the count is unchanged.
- The stamp check runs before the transition check. The earlier "counter posts by hand" case now accepts either refusal: posting from open carries posting stamps outside their step.

**Checks** (each through `heavy.sh`, on the slot database migrated and seeded fresh at the start of this round):

| Check | Result |
|---|---|
| `pnpm format:check` | all files use Prettier code style |
| `pnpm copy-lint` | clean |
| `pnpm db:docs`, `pnpm --filter @shakti/domain machines:docs` | no change |
| `pnpm typecheck` | 10 successful |
| `pnpm lint` | clean |
| Unit tests (`turbo run test --force`) | contracts 340, db 161, domain 2,868, web 1,253 passed (1 skipped), ui 107, tokens 146, copy-lint 17, voice 49, voice-agent 23 |
| `pnpm test:security` | db 1,806 passed (63 files), domain 1,530 passed (111 files), web 461 passed (39 files) |
| `pnpm build` | passed |
| `js-budget` | every page within its budget (69 pages); the count pages are unchanged in weight (243.3, 243.3, 207.5 and 190.8 kB) |
| Journeys: `e2e:seed`, then `playwright test e2e/stock-counts.spec.ts --ignore-snapshots --retries 0` | 24 passed |

**For the lead:**
- 0241 was edited in place again (the guard and two new definers). My slot database migrated it in this form before the suites ran.
- The guard's first edit and the database's copy are the same text. I re-applied the function once by hand while trying an order that I then reverted, so the file on disk is exactly what the migrator recorded.
- Question A's answer (a role given `inventory.stock.move`, or a counting permission) needs no change to the count's code. Question B (a) is a restrictive policy on H1's tables.

### 28-11-2026, lane 112 (owner answers)
Opus 5.5 at high. This lane builds the addendum at the end of the Review section: question A (b), a counting-only permission, and question B (a), blind counting by restrictive policies. Skills loaded: `add-command` and `add-table`, as checklists. `main` was not taken in.

**A (b): `inventory.count.record`**
- **The permission:**
  - added to the catalogue (`permissions.ts`) with the scopes own, entity and all;
  - labelled "Count stock" (`seeds/permissions.ts`, and `en.json` `permissions.inventory_count_record` for the role editor);
  - granted in `STAFF_MATRIX` at entity to the Store Manager and the Inventory Manager, and at all to the Executive. "all" is the Executive's column for every permission, and the oracle reads it from SECURITY §3.2, which has the new row.
  - No agent principal holds it, and it is not platform-only.
  - A customised role gets it only as `pnpm db:seed` gives permissions created after its customisation (the seed's existing rule).
- **Where it replaces `inventory.stock.move`:** the counting paths only.
  - Commands: `inventory.count.record` and `.submit`.
  - Machine: the `stock-count` transitions open → counting and counting → review. `docs/state-machines/stock-count.md` is regenerated.
  - Database (`0241_h3_stock_counts_rls.sql`, unmerged, edited in place):
    - the read and update policies of `stock_counts`;
    - the state guard;
    - the definers `app.stock_count_record()`, `_sheet()`, `_progress()`, `_hub()` and `_bins()`.
  - Queries `listStockCounts` and `getStockCountSheet`.
  - Screens:
    - the menu's `anyOf` is now `inventory.stock.read` or `inventory.count.record`;
    - the counting page;
    - the list's Count links;
    - the review's link back to counting.
- **What stays as it was:**
  - Starting, asking for a recount, reviewing, posting and cancelling stay with `inventory.stock.adjust`.
  - H1's stock commands and the stock card's Move between bins keep `inventory.stock.move`.
  - The journey seed's `app.stock_move()` call keeps `inventory.stock.move`.

**B (a): blind counting**
- **The definer:** `app.stock_count_hidden(company, bin, item)` (stable, `search_path = ''`, `app_user` and `app_reader`, revoked from `public` and `readonly_reporter`). It returns true when the caller holds `inventory.count.record` without `inventory.stock.adjust` and a live count of the company covers the bin, and the item for an items count. It finds the count through the bin's hub and `stock_counts_live_unique` (company and hub, live states).
- **The policies:** three restrictive select policies for `app_user` and `app_reader`.
  - `stock_balances_count_blind`
  - `stock_movements_count_blind` (either bin)
  - `serials_count_blind`

  Each first asks, as an initplan, whether the caller is such a counter, so nobody else pays for the per-row check. These are new policies only; nothing on `main` is redefined.
- Decision: "live" includes `open` as well as `counting` and `review` (`LIVE_STOCK_COUNT_STATES`), so a counter cannot read the shelves between the start and their first entry. An items count hides only its items in the bins it covers.

**Tests**
- **db `stock-counts.test.ts`, new "blind counting" case:** one bin of a hub is under a live count. The Store Manager, on both pools, reads:
  - no balance (untracked or serial), movement or serial of the counted bin;
  - the bin outside the count as before.

  Also:
  - The Inventory Manager, the GM and the Lead Converter (`tele_caller_lc`, the selling role that reads stock) read everything throughout.
  - Another company's Store Manager reads nothing of company 1's count.
  - Once the count is cancelled, the Store Manager reads the bin again.
  - An items count hides only its item.

  The definer grants and the reader definer list in `grants.test.ts` gain `app.stock_count_hidden`. The matrix rule for `stock_counts` reads "`inventory.stock.read` or `inventory.count.record`".
- **domain `stock-counts.test.ts`, new case:** the seeded Store Manager runs `listStockBalances` and `getStockCard` while a count of one bin is live.
  - They see only the other bin: on hand 5 of 45, and its movement alone.
  - They count and submit, are refused the post, and the Inventory Manager posts.
  - Then they read both bins (on hand 43).
  - The other counters in the file now hold `inventory.count.record`.
- **`nav.test.ts`:** the anyOf cases now use `inventory.count.record`.
- **Journey `stock-counts.spec.ts`, rewritten in three steps:**
  1. The Inventory Manager opens the cable's stock card (to keep its address) and starts the count.
  2. The Store Manager:
     - opens that stock card, which shows "The company holds none of this item.", no hub name, no 40 or 10, and passes axe;
     - opens the count from the list (no Start button for them), counts the cable in both bins and the pump's serials with axe and the two snapshots, and sends it for review;
     - sees no review link.
  3. The Inventory Manager reviews, asks again, counts again, posts and opens the sheet, as before.

  The old Store Manager list-only test is gone.
- **The count spike (`count-explain.ts`):** now also explains the stock list and card as the Store Manager and the Inventory Manager while the whole-hub count is live.

**`EXPLAIN (ANALYZE)` of the blind policies** (the spike's volume: 20,000 balances in the counted hub, about 422,000 movements):

| Read | Who | Plan | Time |
|---|---|---|---|
| Stock list of the counted hub, first page | Store Manager | Index Scan `stock_balances_key_unique` on company and hub; filter `not initplan or not app.stock_count_hidden(...)` removes all 20,000 rows (every row of the hub is hidden, so the page scans the hub) | 233 ms, 0 rows |
| Stock list of the counted hub | Inventory Manager | the same scan; the initplan is false, so no per-row call | 0.4 ms, 50 rows |
| Stock list of company 1 | Store Manager / Inventory Manager | key order, stops at the page | 1.4 ms / 0.3 ms |
| Stock card of a counted item (the movements statement) | Store Manager / Inventory Manager | `stock_movements_card_idx`, the per-row check on the item's 21 movements | 8.0 ms, 0 movements / 1.2 ms, 50 movements |

Each per-row check is one `bins_pkey` lookup and one `stock_counts_live_unique` probe, about 11 µs. The cost falls only on a counter who cannot adjust, and only on rows of a hub under a live count. The slowest case is a counter paging the stock list of a whole hub they are counting, which finds nothing to show.

**Checks** (each through `heavy.sh`, on the slot database migrated and seeded fresh at the start of the lane):

| Check | Result |
|---|---|
| `pnpm format:check` | all files use Prettier code style, after fixing `nav.test.ts` |
| `pnpm copy-lint` | clean |
| `pnpm db:docs` | `data-dictionary.md` updated with the policies, committed |
| `machines:docs` | `stock-count.md` updated |
| `pnpm typecheck` | 10 successful |
| `pnpm lint` | clean |
| Unit tests (`turbo run test --force`) | contracts 340, db 162, domain 2,868, web 1,253 (1 skipped), ui 107, tokens 146, copy-lint 17, voice 49, voice-agent 23 |
| `pnpm build` | passed |
| `js-budget` | 69 pages within budget; the count pages unchanged (243.3, 243.3, 207.5, 190.8 kB) |
| Journeys (`e2e:seed`, then `playwright test e2e/stock-counts.spec.ts e2e/inventory.spec.ts --ignore-snapshots --retries 0`) | 39 passed (H1's stock journeys included) |

The security suites (`turbo run test:security --concurrency=1 --continue`):
- **db: 1,806 passed, 1 failed.** `alert-counts.test.ts` failed with a duplicate `agent_configs` row for `agent:copilot` in company 3. The journey seed wrote that row on this database at 09:11 UTC, before the suite ran, so it is not this slice's code. CI runs the suites on a database no journey has seeded.
- **domain: 1,531 passed.**
- **web: 460 passed, 1 failed.** `demo-data.test.ts` misread the retail list's `PUMP-3HP` price. This is the paging fault of the early check, fixed on `main` by `699a5817`; it shows once the journeys have added price list rows.
- An earlier run also failed H1's `stock-ledger.test.ts` "a movement and its cost stay as written". Its `select id from stock_movements limit 1` picked a movement my new db test had written without a cost row. The test now writes each movement's cost, as `app.stock_move()` does. I added cost rows by hand to the 6 cost-less movements that test's earlier runs had left in the slot database (test data only). Rerun, `stock-counts` and `stock-ledger` passed 61 of 61.

**Decisions taken in this lane:**
12. A count is live for blinding from `open`, not only `counting` and `review` (the addendum's wording), so the shelves are hidden from the start.
13. An items count hides only its items in its bins. A bins or whole-hub count hides every item in its bins.
14. The Executive holds `inventory.count.record` at `all`, as every Executive column does; the Executive also holds `inventory.stock.adjust`, so is never blinded.

### 28-11-2026, lane 114 (addendum fixes)
Opus 5.5 at high. This lane fixes L1 to L4 of the addendum's re-check, as the lead's triage says. C1 is left to the integration, and `main` was not taken in. No skill was loaded again.

**L1: the screens say stock is being counted, never that the company holds none.**
- New definer `app.stock_count_hides(company, item)` in `0241_h3_stock_counts_rls.sql`, which is unmerged and edited in place.
  - It is stable and sets `search_path = ''`.
  - It is executable by `app_user` and `app_reader`, and revoked from `public` and `readonly_reporter`.
  - It is true only for the blinded counter (`inventory.count.record` without `inventory.stock.adjust`) and only in a company the request acts in, when a live count:
    - with an item: covers a bin that holds some of that item;
    - with no item: is live anywhere in the company.
- H1's `StockBalancePageDto` and `StockCardDto` gain `hiddenByCount`, set through that definer (`hiddenByCount()` in `queries/inventory/stock.ts`).
- The stock card:
  - shows "Some of this item's stock is being counted, so it doesn't show here. It shows again once the count is posted." when some hubs still show;
  - replaces its empty state ("The company holds none of this item.") with "This item's stock is being counted, so it doesn't show here. It shows again once the count is posted."
- The stock list shows "Some stock is being counted, so it doesn't show here. It shows again once the count is posted."
- The Store Manager journey now asserts the counting sentence and that "holds none" is absent.

**L2: the three missing cases**, added to the db blind case (`stock-counts.test.ts`):
- a count still `open` hides the bin on both pools;
- a movement out of the counted bin (`from_bin_id`) is hidden and shown again;
- Accounts reads the counted bin throughout.

The same case also covers:
- `app.stock_count_hides()` for the Store Manager (true), Accounts and the Inventory Manager (false), using an item held only in the counted bin so the answer is this test's own;
- L4 below.

The domain Store Manager case also asserts `hiddenByCount`: true on the list and the card during the count for the Store Manager, false for the Inventory Manager, and false on the card after the post.

**L3:** the `inventory-counts` menu comment now names `inventory.count.record`.

**L4:** `app.stock_count_hidden()` answers only for a company the request acts in (`p_entity = any (app.entity_ids())`). Tested with a company 3 count of the same bin:
- a Store Manager acting in company 1 gets false for company 3;
- one acting in company 3 gets true;
- `app.stock_count_hides(3, …)` is false from company 1.

**Checks** (each through `heavy.sh`; the slot database was migrated and seeded fresh, and the security suite ran before any journey):

| Check | Result |
|---|---|
| `pnpm test:security` | db 1,807, domain 1,531, web 461: all passed |
| `pnpm format:check`, `pnpm copy-lint` | clean |
| `db:docs`, `machines:docs` | no change |
| `pnpm typecheck` | 10 successful |
| `pnpm lint` | clean |
| Unit tests | contracts 340, db 162, domain 2,868, web 1,253 (1 skipped), ui 107, tokens 146, copy-lint 17, voice 49, voice-agent 23 |
| `pnpm build` | passed |
| `js-budget` | 69 pages within budget; `/inventory/stock` 239.0 of 250 kB, the stock card 239.2 of 251 |
| Journeys (`e2e:seed`, then `stock-counts.spec.ts` and `inventory.spec.ts`, `--ignore-snapshots --retries 0`) | 38 passed, 1 failed |

The failure is H1's "as an Executive, the stock screens" on the phone project, at its time limit. It failed again when run alone. It ended on `/inventory/hubs`, which the security suite had just filled with its test hubs (70 hubs in use; the page snapshot shows them), so the phone's accessibility check does not finish in time. The Executive holds `inventory.stock.adjust`, so this round changes nothing they see beyond one definer call per list and card. I expect it to pass on the Linux image's fresh database per project.

**For integration:** C1 (H2's `app.line_availability()` for a blinded counter) is still open for whichever of H2 and H3 merges second.

## Review

### 28-11-2026, slice reviewer (cloud, Opus 5.5 at high), on `5a8079c3`
**Verdict: blocked by H1** (the brief's review checklist: "the expected quantity never reaches a counter by any path"). The code fix for H1 is small; the role it serves needs the owner's answer to the early check's questions A and B.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| H1 | high | `apps/web/src/nav.ts` (the `inventory-counts` entry, `requires: inventory.stock.read:entity`); `apps/web/src/app/(bos)/inventory/counts/[id]/page.tsx` 39-40 (`screenAccess(navRequires('inventory-counts'))`, then `listHubs({})`, which needs `inventory.stock.read:own`); H1's `stock_balances_read`, `stock_movements_read`, `serials_read` (0231, `inventory.stock.read:entity`); `docs/07-security.md` (the H3 line) | Every person who can open the counting screen must hold `inventory.stock.read` at `entity`, and that grant reads the live balance, the movements and every serial's bin of the counted bins. Blind counting holds only on the count's own paths. A principal holding only `inventory.stock.move` (the design's counter) gets not-found on the counting screen. No seeded role counts blind today: `inventory.stock.move:entity` is held only by the Executive and the Inventory Manager, and both hold `inventory.stock.adjust`. SECURITY says "a counter who *also* holds `inventory.stock.read`", but every counter must. The domain test's counter (`stock-counts.test.ts` 147-152) holds `inventory.stock.read:entity` itself, so "a counter counts blind" proves only the count's own paths. | Probed on the slot database: as `app_user` with `inventory.stock.move:entity,inventory.stock.read:entity` (the least a counter needs to open the screen), `select qty_on_hand from stock_balances` for a live count line's bin and item answered `10.000`, the line's frozen `expected_qty`. The same counter opens `/inventory/stock` or an item's stock card in the middle of a count and reads what to type. With `inventory.stock.move` alone, `stock_balances` answers 0 rows, but the screen will not open. | (1) Let a holder of `inventory.stock.move:entity` alone open `/inventory/counts` and the counting screen: gate the counting page on `inventory.stock.move` (and the list on read or move, as `listStockCounts` already does), and take the count's bins from the count (its scope, or the hub's bins through a count definer) instead of `listHubs`. (2) Owner: question A (who counts: Store Manager given `inventory.stock.move`, or a counting-only permission) and B (a restrictive policy hiding the balances, movements and serial bins of bins under a live count from non-holders of `inventory.stock.adjust`, or accept it). Until B is settled, SECURITY must say that every counter reads the balances. (3) Tests: a principal with `inventory.stock.move` only opens the sheet, counts and submits; with B (a), that principal reads no balance of a counted bin. | confirmed |
| M1 | medium | `0241_h3_stock_counts_rls.sql` §7 (`s.state in ('in_stock', 'reserved', 'picked', 'faulty')`); `counts-plan.ts` (`scrap` for every missing serial; `stock_count_serial_elsewhere` for a found serial that is not `in_stock`/`scrapped`); `serial.ts` (`scrap` from `in_stock`, `faulty` only); X4 on `main` (`('count', 'out', '{in_stock}', …)`) | The start lists reserved, picked and faulty serials as expected, but posting cannot write any of them off. A missing reserved or picked serial fails the serial machine (`serial_transition_not_allowed`, "Refresh the page…"), and a missing faulty one passes the machine but fails `app.stock_move()` (`stock_serial_state`). A recount does not help, since the serial is still missing, so the count can only be cancelled. A found faulty, reserved or picked serial in another bin is refused as "recorded as having left our stock", which is not true. | Latent until R3 (`return_customer` → `faulty`) or H2/sales (`reserved`, `picked`) merge in this wave. Then a whole-hub count with one faulty pump nobody can find never posts, including the exit gate's audit (§11). | Either list only `in_stock` serials at the start (and count the others by their own workflow), or refuse at review and post with a named reason ("release the reservation" or "return the faulty unit first") before any movement. If faulty stock is to be written off by a count, open a `count`/`out` row from `faulty` through X4's registry insert. Correct the `_elsewhere` sentence. Add a test with a faulty serial missing. | confirmed by reading (machine, plan and X4's move rows); not reproduced, since no path on this branch makes a serial faulty |
| L1 | low | `packages/domain/src/queries/inventory/counts.ts` (`getStockCountReview`: `item_costs.moving_avg_cost` read now; `costs.get(l.itemId) ?? '0'`) | A value is the moving average when the review or sheet is read, not when the count posted, so the printed sheet "for the record" of a posted count changes as costs move. An item with no cost row shows a value of 0.00 instead of no value. | An auditor reprints a posted count a month later and its net value differs from the first print. | Snapshot the unit cost per line at post time (behind `finance.cost.read`, e.g. in `stock_movement_costs`, which the post already writes) and value posted counts from it. Show no value where there is no cost. | confirmed |
| L2 | low | `0241_h3_stock_counts_rls.sql` §2 (`grant update (… posted_by, post_note, cancelled_by, cancel_reason, submitted_by …)`; `app.stock_counts_guard()` checks only state moves) | Any holder of `inventory.stock.move` passes the update policy and may change the posted, submitted and cancelled stamps and notes without a state move. The guard does not tie a stamp to its transition. Only the command layer reaches `app_user`, so this is defence in depth. | A future command or a bug writes `post_note` on a live count, or rewrites `submitted_by`, and nothing refuses it. | In the guard: a stamp changes only with its transition (`posted_*` with review→posted, `cancelled_*` with →cancelled, `submitted_*` with counting→review), and never afterwards. | confirmed |
| L3 | low | the brief point 4 ("prints … from a template in the print registry"); decision 10 | The sheet is a browser print of a live render, not a document of `DOCUMENT_TYPES` stored for the record. The reason given (no worker may hold `inventory.stock.adjust` or `finance.cost.read`, ADR 0020) is sound. | No stored copy of what was posted. | Lead: accept decision 10 in the design's Built record (it is there), or follow up with a stored PDF rendered on the poster's own request. | confirmed |

**Checked and sound:**
- **The count's own paths are blind** (attacked per the lead's note). The columns of `app.stock_count_sheet()` and `app.stock_count_progress()` (per item in a bin, never per serial; a recount hides the first count). `StockCountSheetDto`, `StockCountDto`, `StockCountRowDto` and the list. The answers and refusals of `inventory.count.record` (ids, codes and serial numbers only: `stock_count_serial_unknown` tells that a number exists, never a quantity). The audit rows (`quantity` is the counter's own entry; the start keeps its line count to itself). The counting page (it reads only the sheet and `listHubs`, whose `BinDto` carries no stock). The item finder (`ItemDto`, no stock and no cost). The review, sheet and print pages (each `notFound()` without `inventory.stock.adjust`, and the queries check again). No `/api/v1` route, export, notification or event before posting. `expected_qty` is selected by no request role on either pool, and the lines are read only with adjust.
- **Posting:** the variance is "counted less the ledger at the count", recomputed in one statement, then posted as deltas through `app.stock_move()`, so movements committing during the post land on top. Every count command locks the header (`for no key update`), so record, submit, recount, post and cancel serialise. Serial found or missing: outs before ins, and a serial written off by its own line is not written off twice. A serial moved since its count refuses. Checked against X4 on `main`: `count` in `{scrapped}` → `in_stock` and out `{in_stock}` → `scrapped` are what the plan uses for in-stock serials. The slice does not redefine `app.stock_move()` and opens no reason.
- **Shared functions:** none redefined (`app.platform_only_permissions()`, `app.next_document_no()`, `app.file_purpose_grant()`, `files_purpose_check`, notification checks untouched).
- **Data isolation:**
  - `ENTITY_TABLES`, the matrix fixture rows and rules, `NARROWER`/`COLUMN_SELECT`, `enum-sync` and the reader definer list are all present.
  - The policies fail closed.
  - Every definer has `search_path = ''`, checks its grant and the count's company in its body, and revokes `public` and `readonly_reporter`. The helpers are executable by no role, and DATABASE §4.1 lists them.
- **Commands:**
  - All six are `peopleOnly`, `auditFields` are labelled in `audit.ts`, and each has one `ctx.audit()` per changed aggregate.
  - The events come from the catalogue (`inventory.stock.moved`, emitter line added).
  - The keys are per run (`useCommand`).
  - The agent refusal inputs and the denied, wrong-company and happy-path tests are present.
  - Cost permissions are untouched, and values are computed in paise (BigInt).
- **Money:** no discount or price path.
- **Performance:** the `EXPLAIN (ANALYZE)` table at volume is adequate. JS budgets are within limits (`js-budget.json` is a checks file and needs the owner's `checks-ok`).

**Tests run on the slot database (54331, migrated and seeded fresh), each through the lock:**
- db: `stock-counts`, `grants`, `role-entity-matrix` and `enum-sync`: 328 passed.
- domain: `commands/stock-counts`, `queries/reader-parity` and `security/agent-refusals`: 77 passed.
- web unit: `screens/stock-counts`, `print/templates`, `screens/audit` and `errors-catalogue`: 50 passed.

**Not checked:**
- **Journeys:** none was run, since this session cannot sign in. From the specs of `apps/web/e2e/stock-counts.spec.ts`:
  - The counter journey is the Inventory Manager (who holds adjust), so it shows only that the counting screen prints no number.
  - The Store Manager journey checks that the list is read-only.
  - No Linux baselines exist, so no screenshot was reviewed for layout.
- The whole `pnpm test:security`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and `js-budget` were not re-run (the builder's are green).

**For integration:**
- The migrations `0240_h3_stock_counts` and `0241_h3_stock_counts_rls` collide with `main`'s `0240_x4_stock_reasons` and `0241_q1_label_sheet_files`. Renumber them after `main`'s last (0246), and update DATABASE §4.1 and §6.5, which cite 0240 and 0241.
- Regenerate `docs/data/`.

### 28-11-2026, the lead's triage
- **Fix in the one fix round:**
  - **H1, parts (1) and (3), with no role change:** the counting page and the count list open for a holder of `inventory.stock.move:entity` without `inventory.stock.read`. The counting page takes the count's bins from the count (its scope, through a count definer that checks the grant and the company, `search_path = ''`), never `listHubs`. Tests: a principal with `inventory.stock.move` only opens the sheet, counts and submits, and reads no balance, movement or serial bin. SECURITY's H3 line says plainly that blind counting holds for a counter without `inventory.stock.read`, and that a counter who also holds it reads the balances until the owner decides question B.
  - **M1:** a missing or misplaced serial that is `reserved`, `picked` or `faulty` is refused at review and at post with a named reason and a catalogue sentence ("release the reservation first", "return the faulty unit first"), before any movement. Correct the `_elsewhere` sentence. Add a test with a faulty serial missing (made through the serial machine in the test).
  - **L1:** snapshot each line's unit cost at post time behind `finance.cost.read` (in `stock_movement_costs`, which the post already writes), value posted counts from it, and show no value where there is no cost.
  - **L2:** as written: in the guard, a stamp changes only with its own transition and never afterwards, with a test.
- **Accepted, not changed:** **L3** (decision 10: a browser print of the live render; no worker may hold `inventory.stock.adjust` or `finance.cost.read`, ADR 0020).
- **Waiting on the owner (asked 28-11 06:20 UTC):** question A (who counts: the Store Manager given `inventory.stock.move`, or a counting-only permission) and B (hide balances of bins under a live count, or accept). The answer comes as a separate small change after this round. Do not grant any role a new permission in this round.
- Run `pnpm format:check` before the `report: h3-stock-counts fixes` commit. Do not take main in (the prep renumbers after 0246).

### 28-11-2026, addendum: the owner's answers to questions A and B (owner, 28-11-2026 ~09:30 UTC: "Go with recommended options")
- **A (b): a counting-only permission.**
  - Add `inventory.count.record` (scopes `own` and `entity`, as `inventory.stock.move`) to the permissions list, the seed and the oracle. Grant it at `entity` to the Store Manager, the Inventory Manager and the Executive.
  - No agent principal holds it, and it is not platform-only.
  - The counting commands (`inventory.count.record`, submit, and recount where a counter does it) and the counting screen and list use it instead of `inventory.stock.move`. Starting, reviewing, posting and cancelling stay with `inventory.stock.adjust`.
  - The count definers check it where they checked `inventory.stock.move` for counting.
  - Update the counts menu entry's `anyOf`, SECURITY §3.2's role table, the H3 line in SECURITY, and phase3 §7.3's Built record.
  - Customised roles get it only as `pnpm db:seed` gives new permissions (created after their customisation).
- **B (a): counters count blind.**
  - Add restrictive select policies on `stock_balances`, `stock_movements` and `serials` (H1's tables) for `app_user` and `app_reader`. A row whose bin is under a live count (state `counting` or `review`, and the bin in the count's scope, through one stable definer with `search_path = ''`) is hidden from a caller who holds `inventory.count.record` and does not hold `inventory.stock.adjust`.
  - Nobody else is affected: a caller without `inventory.count.record` (sales, quotes, H2's availability, the GM, Accounts) or with `inventory.stock.adjust` reads as before.
  - The definer is indexed for the live-count lookup. Record its `EXPLAIN (ANALYZE)` on the stock card and the stock list at the volume in the report.
  - Tests:
    - the Store Manager (read and count, no adjust) reads no balance, movement or serial bin of a counted bin during the count, and reads them again once it is posted or cancelled;
    - a bin outside the count is unaffected;
    - a Sales Executive and the Inventory Manager read the counted bin throughout;
    - the role × company matrix and `NARROWER` updated.
  - This is a redefinition of nothing on `main`: new policies only. If H2 or another slice later reads these tables under the viewer, it keeps working for non-counters.
- **The journey:** the counter journey becomes the Store Manager (count, submit) with axe, and asserts that their stock card shows no quantity for a counted bin while the count is live.
- Run `pnpm format:check` and the slice's checks, then commit `report: h3-stock-counts owner answers`. Do not take main in.

### 28-11-2026, slice reviewer (lane 113): the owner-answers addendum checked, `788c4bd6..9eb3e8fc`
I read the diff from my review `788c4bd6` to `9eb3e8fc`. It contains no merge of `main`, so it is the fix round (lane 106) followed by the addendum (lane 112). I checked the addendum's row security, and the fix round only where it bears on H1.

**Verdict: the addendum is sound and H1 is closed. Nothing blocks the merge.** One cross-slice item (C1) is for whichever of H2 and H3 merges second. The rest are low follow-ups.

**H1: closed** (confirmed by reading the code and the tests, which I ran):
- **Gates:**
  - The counting page needs only `inventory.count.record:entity` (`[id]/page.tsx`).
  - The menu entry has no required grant and an `anyOf` of `inventory.stock.read` or `inventory.count.record` at `entity`. The list page refuses anyone holding neither (`navAnyOf`).
  - `listStockCounts` and `getStockCountSheet` check the counting permission.
- **No call needs `inventory.stock.read`:** the page no longer calls `listHubs`. The bins come from the count through `app.stock_count_bins()`, and the hub name through `app.stock_count_hub()`. Both have `search_path = ''`, check the grant and the company in their bodies, are granted to `app_user` and `app_reader`, and are revoked from `public` and `readonly_reporter`.
- **Tests:**
  - The db and domain suites each have a counter holding `inventory.count.record` alone (`stock-counts.test.ts` 49-52 and 161-163). That counter opens the count, counts and submits, and reads no balance, movement, serial, hub or bin on either pool.
  - The seeded Store Manager, who also reads stock, sees no stock of the counted bin on `listStockBalances` or `getStockCard` while the count is live.

**The new permission:**
- `inventory.count.record` has the scopes `own`, `entity` and `all`, the same as `inventory.stock.move`.
- The seed grants it to the Store Manager and the Inventory Manager at `entity`, and to the Executive at `all`, the Executive's column for every permission (decision 14; the Executive also holds adjust, so it is never blinded).
- SECURITY §3.2 has the matching row, which the oracle reads, and the role-editor, seed and cost-permission suites pass.
- No agent principal holds it, and it is not in `app.platform_only_permissions()`, which is untouched.
- It replaces `inventory.stock.move` only on the counting paths: the two commands, the two machine moves, the `stock_counts` read and update policies, the guard, and the record, sheet, progress, hub and bins definers. Start, recount, post and cancel keep `inventory.stock.adjust`, and H1's stock commands keep `inventory.stock.move`.

**The restrictive policies** (`stock_balances_count_blind`, `stock_movements_count_blind` on either bin, `serials_count_blind`; select only, for `app_user` and `app_reader`):
- **Who is blinded:** only a caller holding `inventory.count.record` (any scope, since `serializeGrants` expands scopes) without `inventory.stock.adjust:entity`. For everyone else the first part of the check (computed once per query) is false and the per-row definer never runs.
- **Readers left unchanged:**
  - The GM, Accounts, `tele_caller_lc`, the Project Manager and the Field Engineer hold no counting permission.
  - The Inventory Manager and the Executive hold adjust.
  - H1's and H2's definers, and `app.stock_move()`, read as the table owner, outside these policies.
- **Fail closed:** a restrictive policy only removes rows. With no settings, `has_perm` is false and the restrictive check passes, but the permissive `*_read` policies still deny on a null `app.entity_ids`, so nothing opens.
- **`app.stock_count_hidden()`:** stable, `search_path = ''`, granted to `app_user` and `app_reader`, and revoked from `public` and `readonly_reporter`. Its live-count lookup matches the predicate of `stock_counts_live_unique`. It is listed in DATABASE §4.1 and in the reader definer list.
- **`main`:** nothing on `main` is redefined.

| # | Severity | Where | What | Scenario | Fix | Status |
|---|---|---|---|---|---|---|
| C1 | medium (cross-slice, at integration) | `origin/feat/h2-reservations` `0248_h2_reservations_rls.sql` §20, `app.line_availability()`: `v_counts := app.has_perm('inventory.stock.read:entity')`; `app.free_availability()` reads `stock_balances` as owner | SECURITY's new H3 line says availability is unaffected, which holds for non-counters. But the Store Manager is both a counter and a seller (`sales.quote.create:own`, `inventory.stock.read:entity`). Once H2 merges, a quote line shows them the company's free quantity of an item, read by a definer that the blind policies do not reach. | During a live count of the only godown holding an item, the Store Manager adds the item to a draft quote and reads the free quantity: the counted bin's balance less what is reserved. | In whichever slice merges second: H2's `v_counts` is also false while `app.stock_count_hidden()` would hide any bin the line's item is free in (or simply for a holder of `inventory.count.record` without adjust while a live count covers the item). Covered and short statuses stay. Add one H2 test with a live count. | plausible (read on H2's branch; not run) |
| L1 | low | `apps/web/e2e/stock-counts.spec.ts` 90 (asserts "The company holds none of this item." on the Store Manager's stock card) | Hiding the rows makes H1's stock card and list tell a counter, who also sells, something untrue: that the company holds none. The design's copy rule is plain and true sentences. | A Store Manager asked by a customer during a whole-hub count reads "holds none" and turns the sale away. | A follow-up in H1's screens: when the caller is blinded (`app.stock_count_hidden` for any bin of the item), say that some stock is being counted and shows again once the count is posted. | confirmed (code and journey spec) |
| L2 | low | `packages/db/tests/security/stock-counts.test.ts` 439-575 | The blind case covers `counting`, `review` and cancelled, the GM, the Lead Converter and the Inventory Manager, both pools, and an items count. It does not cover `open` (decision 12 hides from the start, but nothing tests it), a movement *out of* the counted bin (only `to_bin_id` is tested), or Accounts. | A later edit drops `open` from the state list, or the `from_bin_id` branch, and no test fails. | Add the three cases to the same test. | confirmed |
| L3 | low | `apps/web/src/nav.ts` (the `inventory-counts` comment) | The comment still says the list reads with "inventory.stock.read or .move" and that "counting needs .move". | Misleads the next reader. | One line: `inventory.count.record`. | confirmed |
| L4 | low | `app.stock_count_hidden(p_entity, …)` | It answers for any company and does not check `p_entity` against `app.entity_ids()`. A counter in company 1 can learn whether company 3 has a live count covering a bin. No quantity leaks. | None of consequence. | Add `p_entity = any (coalesce(app.entity_ids(), '{}'))` to the `exists`. | confirmed |

**Decision 12** ("live" includes `open`) is stricter than the owner's wording (counting or review) and blinds the Store Manager from the start rather than from the first entry. That matches the intent, but the lead should accept it in the record.

**EXPLAIN:** the builder's table covers the stock list and the stock card at volume, for the Store Manager and the Inventory Manager. The worst case is 233 ms: a counter paging the stock list of the very hub they are counting, where every row is filtered out (about 11 µs per row). Non-counters pay nothing (0.4 ms). This is acceptable. I did not re-run the spike.

**Tests run on the slot database (54331, migrated and seeded fresh), each through the lock:**
- db `stock-counts`, `stock-ledger`, `grants`, `role-entity-matrix`, `enum-sync`: 378 passed.
- db `seeds`, `cost-permissions`, `role-editor`: 123 passed.
- domain `commands/stock-counts`, `queries/reader-parity`, `security/agent-refusals`: 80 passed.
- web `nav.test.ts`: 12 passed.
- contracts `permissions.test.ts`: 8 passed.
- domain unit `counts-plan.test.ts` and `machines.test.ts`: 1,326 passed.

**Not run:**
- I ran none of the journeys in `apps/web/e2e/stock-counts.spec.ts`, since this session cannot sign in. That covers the Inventory Manager's start, the Store Manager's blind count with the stock card check and the snapshots `count-to-count` and `count-serials`, and the Inventory Manager's review and post with `count-review`. They still need their Linux baselines.
- I did not run the whole `test:security`, typecheck, lint or build (the builder's are green), nor the M1, L1 and L2 fixes beyond the files above (out of scope for this re-check).

### 28-11-2026, the lead's triage of the addendum's re-check
- **Fix now, one short lane:**
  - **L1:** when the caller is blinded for any bin of the item (`app.stock_count_hidden()`), H1's stock card and stock list say that some of this item's stock is being counted and shows again once the count is posted. They never say the company holds none. Add a catalogue sentence and update the journey's assertion.
  - **L2:** add the three cases (`open`, a movement out of the counted bin, Accounts).
  - **L3:** correct the comment.
  - **L4:** check `p_entity` against `app.entity_ids()`.
- **At integration (whichever of H2 and H3 merges second), C1:** H2's `app.line_availability()` treats a holder of `inventory.count.record` without `inventory.stock.adjust` as not reading counts while a live count covers the item's bins. Covered and short statuses stay. One H2 test with a live count.
- Run `pnpm format:check`, then commit `report: h3-stock-counts addendum fixes`. Do not take main in.

## Integration
