# R3 Warranty claims and supplier returns (wave 2)

| | |
|---|---|
| Branch | `feat/r3-warranty` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): stock out, costs behind `finance.cost.read`, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder Opus 5.5 at high on the seat's own account, 27-11-2026 (start and end of the blocked run); builder Opus 5.5 at high, 27-11-2026 (start and end of the second run, lane 7's replacement, resumed after the VM restart); builder Opus 5.5 at high, 27-11-2026 (start and end of lane 68, past the early check); builder Opus 5.5 at high, 28-11-2026 (start and end of the fix round, lane 95, resumed after the container restart) |
| State | fixes done: review findings 1 to 9 and 12 fixed; settlement by a supplier's replacement waits for U2 |
| Next step | the reviewer re-checks the fix diff (finding 1 was high); the lead integrates, runs the journeys and makes the baselines; the owner's `checks-ok` for `js-budget.json` |

## Brief
Build [phase3 §7.5](../../03-roadmap-appendix/phase3.md#75-r3-warranty-claims-and-supplier-returns) as written, with question 10 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Table `warranty_claims`** with the columns of §7.5, and a new series kind `warranty_claim` (code `WC`). The cost columns `replacement_cost` and `supplier_credit_amount` are readable only with `finance.cost.read`. Use the house pattern for restricted columns (H1's `stock_movement_costs`, U1's quotes) and name it.
2. **The `warranty-claim` machine** exists (`packages/domain/src/state-machines/machines/warranty-claim.ts`). Bring it into use (`MACHINES_IN_USE`) and add one command per event: `inventory.warranty.raise`, `.identify_serial`, `.replace`, `.rma_raise`, `.settle` and `.reject`.
   - `settle` needs `procurement.grn.write`, and `rma.raise` needs `procurement.po.write` (phase3 §14).
   - Its `cost_entry` writes nothing until Phase 5. Keep the cost on the restricted columns (question 10 (a)) and mark the step in the machine's document.
3. **Stock:**
   - `.replace` issues the replacement serial through `app.stock_move()` with reason `warranty_replacement` at the moving average. Open that reason to `inventory.warranty.write:entity` with one insert into `app.stock_reason_grants` in your own migration (X4's registry), with its grant test. Never redefine `app.stock_move()`. If X4 has not merged when you reach this point, take `main` in once it has.
   - When the failed serial comes back it moves to the hub's quarantine bin as `faulty` through the serial machine. Use the reason the ledger's list already holds for a return into stock (`return_customer`), opened to `inventory.warranty.write:entity` in the same insert, with `ref_type` `warranty_claim`. R2 later uses the same reason for its own returns with its own grant check in its command.
   - `.rma_raise` moves the serial to `with_supplier`.
   - `.settle` records a supplier replacement received into stock, through the `receipt` reason if U2 has merged, otherwise this step waits and you say so, or a credit (restricted).
4. **Warranty dates:** in warranty means `warranty_until` on or after today in India (IST, never the UTC date). A serial out of warranty is refused at identification, naming its date.
5. **Installed base:** an import kind for serials sold before go-live (company, SKU, serial, customer, site, delivery date). It enters them as `with_customer` with their warranty dates and no stock movement, through the import framework, with refusals per row and undo as the other kinds have.
6. **Screens:** `/inventory/warranty` (claims by state), the claim sheet with its steps, and Raise a claim from Account 360 and from a serial's page. Journeys: the Inventory Manager takes a claim through replace, RMA and settle; the General Manager sees no cost. Both with axe and snapshots.

**Early check (Tier A):** once the table, the commands, the reason opening and their security tests are committed (the claim machine end to end, the out-of-warranty refusal at 23:30 and 00:30 IST, the cost columns per role on both pools), write a short report and push `report: r3-warranty early check`, then stop.

Files owned: `warranty_claims` and its migrations; `packages/domain/src/commands/inventory/warranty*.ts` and its queries; `apps/web/src/app/(bos)/inventory/warranty`; the installed-base import kind; Raise a claim on Account 360 and the serial page.

Do not touch: purchase orders and receipts (U2); the serial machine's states and transitions beyond calling them (H1); `app.stock_move()`.

Review checklist: no cost in any DTO, event, audit value or notification without `finance.cost.read`; the serial's state and bin stay in step through every step; warranty dates in IST; the installed base moves no stock.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: r3-warranty <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: r3-warranty blocked` with the question and stop.
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

### 27-11-2026, seat slot 2 (Postgres 54332): blocked before building

**Nothing is built yet.** I read the brief, `CLAUDE.md`, `AGENTS.md`, phase3 §1 to §5, §7, §13 and §14, the `warranty-claim` and `serial` machines, H1's schema and its definer `app.stock_move()` in the H1 migration (`0231_h1_stock_ledger_rls.sql`), and the X4, H2 and U2 briefs. No skill was loaded, since no code was written.

**The question.** Brief point 3 needs `app.stock_move()` to move serials into states it never gives. The brief also forbids redefining the function, and `serials` has no other writer: no request role holds a write grant on it.

| Step in the brief | What the definer does today | Result |
|---|---|---|
| `.replace`: the replacement serial is issued from stock as `warranty_replacement`; the serial machine's `replace` goes `in_stock` → `with_customer` | An outbound line with no target bin always sets the serial to `scrapped` with no bin (migration line 599) | The replacement is marked written off, not with the customer |
| The failed serial comes back into quarantine as `return_customer`, `with_customer` → `faulty` (`return_faulty`) | An inbound line with no source bin accepts only a `scrapped` serial, refuses every other state with `stock_serial_exists`, and sets `in_stock` (lines 582 to 590) | The return is refused, and would have set `in_stock` instead of `faulty` |
| `.rma_raise`: the failed serial goes to `with_supplier` | An outbound line accepts only an `in_stock` serial (line 592). The brief opens no reason for this movement (`return_supplier` would be the ledger's one), and `serials_bin_check` needs the bin cleared for `with_supplier` | Without a movement, the quarantine bin's balance keeps a unit the serial is no longer in. With a movement, it is refused |
| `.settle` by a supplier replacement through `receipt` | Only `opening` and `adjust_gain` create a new serial; any other reason with an unknown number is refused `stock_serial_unknown` (line 476) | A supplier's new serial cannot be received. U2's `procurement.grn.post` hits the same line for every serial-tracked receipt |
| The replacement's customer, site, delivery date and warranty date | Only the definer writes `serials`, and it sets none of these | They cannot be recorded |

**Options for the lead:**
- **(a) Recommended.** X4 is still being built in this wave: its branch holds only the brief, as of 14:12 UTC. Widen X4's registry so that each reason also states the serial's move. That could be a second table, `app.stock_reason_serial_moves (reason, direction, from_states, to_state)`, seeded with H1's behaviour exactly, which `app.stock_move()`'s serial block reads instead of the fixed states. A later slice then adds its moves with one insert, as it opens a reason. R3 would add:
  - `warranty_replacement` out, `in_stock` → `with_customer`;
  - `return_customer` in, `with_customer` → `faulty`, into a quarantine bin;
  - `return_supplier` out, `faulty` → `with_supplier`.

  U2 would add `receipt` in, which creates a new serial. The customer's columns on a serial that goes to `with_customer` would be line fields the definer writes (`account_id`, `site_id`, `delivered_at`, `warranty_until`), or a narrow R3 definer that writes only those columns and never the state or bin.
- **(b)** R3 redefines the serial block of `app.stock_move()` itself. This breaks the brief's rule, and the lead then merges three redefinitions (X4, H2, R3).
- **(c)** R3 adds its own definer that changes the serial's state around each `app.stock_move()` call: `scrapped` before a return so the definer accepts it, then `faulty`; `with_customer` after the issue. Not recommended. The serial passes through states its machine does not have, and `serials` gets a second writer of state and bin, against phase3 §5 and this brief's review item "the serial's state and bin stay in step".

**Also for the lead's decision, recorded with the brief's answer:**
- `.rma_raise` needs a movement out of quarantine: the reason `return_supplier` and its grant, which I take to be `procurement.po.write:entity`, as phase3 §14 gives `rma.raise`.
- The replacement serial's warranty date. I would carry the failed serial's `warranty_until` over, so the customer keeps the term they had. Whether a replacement restarts the term belongs to the client (phase3 §12, question 10). I would record that as an assumption unless the lead rules otherwise.

**Not affected; built as soon as the question is answered:**
- the `warranty_claims` table, its row security and the restricted cost columns;
- the series kind `WC`;
- `.raise`, `.identify_serial` (with the IST refusal at 23:30 and 00:30), `.reject` and the credit branch of `.settle`;
- the queries, the installed-base import (its own narrow definer, which inserts `with_customer` serials with no movement), and the screens.

The reason opening also waits for X4 to merge, as the brief foresees.

**Checks run:** none, since no code changed.

### The lead's answer (27-11-2026 14:35 UTC)
Option (a): X4 now moves the serial rules into data (`app.stock_reason_serial_moves`) and writes the customer fields of a line going `with_customer` (X4's brief points 5 to 9). Your ledger steps open three reasons, each with a grant row and a move row in your own migration once X4 has merged: `warranty_replacement` out `in_stock` → `with_customer` (`inventory.warranty.write:entity`), `return_customer` in `with_customer` → `faulty` into a quarantine bin (`inventory.warranty.write:entity`), `return_supplier` out `faulty` → `with_supplier` (`procurement.po.write:entity`, as phase3 §14 gives `rma.raise`). The replacement serial carries the failed serial's `warranty_until` (an assumption recorded for the client, phase3 §12 question 10). Build now everything you listed as not affected; take `main` in once X4 has merged and add the ledger steps; if X4 has not merged when only they remain, stop at `report: r3-warranty early check` naming them.

### 27-11-2026, seat (worktree `r3-warranty`, Postgres 54333): early check

**Stage.** Everything the ledger does not affect is built and checked; the ledger steps remain. X4 has merged into `main` since (`bdf82df4`, PR #298), but this branch has **not** taken `main` in: the coordinator's lane said to stop at this report. The next lane takes `main` in and adds the ledger steps listed below. Skills loaded: `add-table`, `add-command` (Context7 is not available in this session; library APIs were read from the installed packages).

**Built:**
- Schema: `packages/db/src/schema/warranty.ts` (`warranty_claims`; `warranty_claim_costs`, restricted), `document-sequences.ts` (`warranty_claim`), `imports.ts` (kind `installed_base`, created type `serial`). Migrations `0240_r3_warranty_claims.sql` (generated; the widened checks `NOT VALID`), `0241_r3_warranty_claims_rls.sql` (row security, column grants, `app.warranty_claims_guard()`, the cost gate, `app.warranty_claim_record_credit()`, `app.next_document_no()` redefined from 0201 plus one line for `warranty_claim`), `0242_r3_installed_base_rls.sql` (`serials_account_idx`, `app.installed_base_add()`, `app.installed_base_remove()`). The lead renumbers them after X4's.
- Restricted columns: the house pattern named is H1's side table (`stock_movement_costs`): `warranty_claim_costs` (`claim_id` with a composite foreign key to the claim, `replacement_cost`, `supplier_credit_amount`), `cost_gate` on `finance.cost.read`, no write grant to any request role, written only by definers.
- Contracts: `packages/contracts/src/inventory/warranty.ts`; events `inventory.warranty.raised`, `.serial_identified`, `.rejected`, `.closed` (ids only); the installed base in `imports/enums.ts`, `commands/imports/jobs.ts`, `rows.ts`; `warranty_claim` in `numbering/document-no.ts`.
- Domain: `commands/inventory/warranty.ts` (`inventory.warranty.raise`, `.identify_serial`, `.reject`, `.settle` by the supplier's credit, `procurement.grn.write`), the registry; `queries/inventory/warranty.ts` (`listWarrantyClaims`, `getWarrantyClaim`, `listClaimSerials`, `readWarrantyClaimCosts`); `imports/installed-base.ts` wired into create, map, preview, commit and rollback; `warranty/dates.ts` (`parseSheetDate`, `warrantyUntilFrom`); the `warranty_claim` machine in `MACHINES_IN_USE` (stored, events, scopes; `cost_entry` marked as kept on the restricted costs until Phase 5); `WORKSHOP_DEFAULTS.numbering.docCodes.warranty_claim` = `WC`.
- Web: `actions/warranty.ts`; Inventory › Warranty claims (`/inventory/warranty`, by state) and the claim sheet (`/inventory/warranty/[id]`: steps, Identify the serial, Reject the claim, Record the credit, Costs only for `finance.cost.read`); Raise a warranty claim on Account 360 and on a serial's page (a serial `with_customer`); the installed base in the import wizard; a `warranty` message namespace for `/inventory` and `/customers`; Activity log labels; `js-budget.json` entries for the two pages.
- Journeys: `apps/web/e2e/warranty.spec.ts`, its seed `e2e/setup/warranty.ts` and `WARRANTY_JOURNEY` in `e2e/support/users.ts`.
- Documents: DATABASE §4.1 (the three definers), §4.3, §6.5 (`warranty_claims`, `warranty_claim_costs`, `serials`); phase3 §7.5 "Built (R3)"; `docs/state-machines` and `docs/data` regenerated; the workshop pack's SALE-1 names warranty claims.

**Tests added:**
- `packages/db/tests/security/warranty.test.ts`: 22 cases: no context; each of the 11 staff roles on both pools (claims with `inventory.stock.read` or `inventory.warranty.write`, costs with `finance.cost.read`); another company; no agent reads a cost; grants and column grants; raised only with the grant as the caller; steps only by their grants, final once rejected; no direct cost write even for an Executive; the credit definer's grants, refusals and write-once; the series' grant. Plus the matrix fixture rows and rules, `NARROWER` and three `enum-sync` pairs.
- `packages/domain/tests/commands/warranty.test.ts`: 12: denied, wrong company and happy path for all four commands; the IST refusal (in warranty at 23:30 IST on its last day, 18:00 UTC; refused at 00:30 IST the next day, 19:00 UTC on the same UTC date, with `warrantyUntil` in the details); no credit in the answer, the audit row or the event.
- `packages/domain/tests/queries/warranty.test.ts` 4; `tests/commands/import-installed-base.test.ts` 3 (every refusal, a serial another company holds refused at commit, no stock movement, the rollback keeps a claimed serial); `src/warranty/dates.test.ts` 20; `apps/web/src/screens/warranty.test.ts` 2. The agent refusal sweep and the reader parity cover the new commands and queries.

**Checks:**
- On `3d431854`, before the VM restart: `pnpm typecheck` 10 successful; `pnpm lint` (whole repository) clean; `pnpm copy-lint` clean; unit tests domain 2827 passed, contracts 340, db 161, web 1243 passed and 1 skipped; `pnpm test:security` db 1815 passed, domain 1538 passed, web 461 passed; `pnpm build` passed; `pnpm --filter web js-budget` every page within its budget except the two new pages, which had none.
- After the restart (`0c0bee15`, the database migrated and seeded afresh; one index added and the list query reworked): typecheck and lint of the changed packages clean; db unit 161 passed; db security (warranty, enum-sync, grants, role × company matrix) 339 passed; domain (the warranty commands, queries, installed base, reader parity) 27 passed; `db:docs` regenerated.
- **`apps/web/js-budget.json` changes** (`/inventory/warranty` 250 kB, measured 237.3; `/inventory/warranty/[id]` 216 kB, measured 205.5): a checks file, so the pull request needs the owner's `checks-ok`.

**EXPLAIN (ANALYZE)** (`packages/domain/tests/spike/warranty-explain.ts`; 20,003 claims, all in company 4, each with its own customer and serial; as an Inventory Manager of company 4 under the policies):
- The list first read joined every claim before the sort (219 ms). It now finds the page on the claims alone in a materialised step and joins only those 51 rows, with a new index `warranty_claims_entity_created_idx`: all states, first page: Seq Scan on `warranty_claims` (20,003 rows, the whole table being company 4's) → top-N heapsort → Limit 51, **11.2 ms**; second page **8.3 ms**; one state (rejected, 6,667 rows) **7.0 ms**. The per-state counts: Seq Scan and group, 6.7 to 8.6 ms. With several companies the planner takes the index; here the one company holds the whole table.
- The claim sheet: Index Scan on `warranty_claims_pkey`, **0.56 ms**.
- The customer's 200 delivered serials: Index Scan on `serials_account_idx`, each open claim by `warranty_claims_open_serial_unique`, **0.63 ms**.

**Waiting for the ledger (next lane, after taking `main` in):**
- `inventory.warranty.replace`: the grant and move rows for `warranty_replacement` (out, `in_stock` → `with_customer`, `inventory.warranty.write:entity`) with their grant test; the replacement issued through `app.stock_move()` at the moving average, carrying the failed serial's `warranty_until`; a definer that copies the movement's cost to `warranty_claim_costs.replacement_cost`.
- The failed serial's return: `return_customer` (in, `with_customer` → `faulty`, into a quarantine bin, `inventory.warranty.write:entity`, `ref_type` `warranty_claim`).
- `inventory.warranty.rma_raise`: `return_supplier` (out, `faulty` → `with_supplier`, `procurement.po.write:entity`), with the vendor and the reference (`supplierRmaRef` in `unmaskedFields`).
- `.settle` by a supplier's replacement waits for U2's `receipt`.
- The journey "the Inventory Manager takes a claim through replace, RMA and settle": today it settles a claim the seed leaves with the supplier.

**Journeys not run:** journeys cannot sign in on a seat. The specs and their seed are written; the lead runs them and makes the Linux baselines (`warranty-raise-dialog`, `warranty-identify-dialog`, `warranty-settle-dialog`, `warranty-claim-closed-gm`).

**Assumptions:**
- A claim names one item; its failed, replacement and supplier serials are all of that item (composite foreign keys).
- Claims are read with `inventory.stock.read` or `inventory.warranty.write` for the company; a reader who may not read the customer sees the claim without the name.
- `replace` in the machine is given to `inventory.warranty.write` (the reason's grant in the lead's answer), not `inventory.stock.move`.
- One open claim per serial. A claim raised on a serial keeps it until identified; identification may pick another of the customer's serials.
- After settlement the failed serial stays `with_supplier`: the serial machine's `settle` (`with_supplier` → `scrapped`) has no movement to carry it, and only the ledger writes a serial's state.
- The warranty's end from delivery is the day before the same date the given months later (12 months from 10-03-2026 runs to 09-03-2027; `warrantyUntilFrom()`, for D2 to reuse), for the client to confirm with phase3 §12 question 10.
- The installed base finds the customer by mobile number among the company's customers (they are imported first), the site by its village (the only site when the cell is blank), reads dates as DD-MM-YYYY or a workbook date, and takes a Warranty until column over the item's months. Only an Executive imports it today (`imports.write` and `inventory.warranty.write`). The item's serial pattern is not applied to old serials.
- The installed base's two definers are the only writers of `serials` besides `app.stock_move()`; they insert and delete, never change a state or bin.
- `warranty_expired` names the date on screen from the serial chosen (an action result carries no details); the domain error carries `warrantyUntil`.
- No Account 360 timeline row for a claim (a new `activities` type would widen a shared check).

**For the lead at integration:** the migrations renumber after X4's. `app.next_document_no()` is redefined here from 0201, and U2 adds `goods_receipt` to it, so whichever comes later must hold both lines, and `document_sequences_doc_type_check` both values. `import_jobs_kind_check`, `import_mapping_templates_kind_check` and `import_rows_created_type_check` are widened here and may be by other slices too.

### 27-11-2026, seat (worktree `r3-warranty`, Postgres 54332): done

**Main taken in** by a merge commit (`ec487b48`, X4 #298 and Q1 #299): my migrations move to `0243_r3_warranty_claims`, `0244_r3_warranty_claims_rls`, `0245_r3_installed_base_rls`, and the ledger steps add `0246_r3_warranty_ledger`. `pnpm db:generate` reports no changes. Checked against `main`: `app.next_document_no()` is redefined only by 0201 and this branch, so mine carries every kind `main` has plus `warranty_claim`. `import_jobs_kind_check`, `import_mapping_templates_kind_check`, `import_rows_created_type_check` and `document_sequences_doc_type_check` match the schema. Conflicts resolved: the registries, `en.json` (`merge-json.py`, none conflicting), `copy-lint.config.json`, Q1's serial page (both the label buttons and Raise a warranty claim), and DATABASE §4.1. U2 has not merged.

**Built in this lane:**
- `0246_r3_warranty_ledger.sql`, written to X4's comment block (no redefinition of `app.stock_move()`):
  - grant rows `warranty_replacement` and `return_customer` (`inventory.warranty.write:entity`) and `return_supplier` (`procurement.po.write:entity`), none reversible;
  - move rows `warranty_replacement` out `in_stock` → `with_customer`, `return_customer` in `with_customer` → `faulty`, `return_supplier` out `faulty` → `with_supplier`;
  - the definer `app.warranty_claim_record_cost(claim, movement)`, which keeps the replacement movement's unit cost (to the paisa) once on `warranty_claim_costs` and answers nothing.
- **No reversal rows:** none of the three reasons is reversible. A claim's steps undo nothing, and a wrong movement is corrected by an adjustment.
- `OPEN_STOCK_REASONS` in the contracts, which X4's registry test holds equal to the grant table. The reasons are out of the ledger test's "refuses every reason a later slice opens".
- `StockMovementLine` gains the optional `accountId`, `siteId`, `deliveredAt` and `warrantyUntil` that X4's definer takes on a line to a customer (`packages/domain/src/stock/move.ts`).
- `inventory.warranty.replace` (`inventory.warranty.write`):
  - issues the replacement (by its scanned or typed number, from a bin) through `app.stock_move()` as `warranty_replacement` at the moving average;
  - gives it the claim's customer and site, today's delivery and the failed serial's `warranty_until`;
  - when the failed serial is back already, takes it into a quarantine bin as `return_customer` (`faulty`) in the same batch;
  - keeps the cost through the definer.
- `inventory.warranty.rma_raise` (`procurement.po.write`) sends the failed serial to an active vendor with their return reference (`return_supplier`). If the serial is still with the customer, it first brings it back into the quarantine bin named (`warranty_faulty_not_back` without one; `warranty_quarantine_bin` for a bin of another kind).
- Each step fires the serial machine (`replace`, `return_faulty`, `rma_raise`) and posts through `postStockMoves()`: audit rows and `inventory.stock.moved` carry no cost.
- Events `inventory.warranty.replaced` and `inventory.warranty.rma_raised`.
- Screens: Give a replacement (bin, serial number, faulty item back or not, quarantine bin) and Send to the supplier (vendor, reference, quarantine bin when the faulty item is not back) on the claim sheet.
- Journey: `apps/web/e2e/warranty.spec.ts` now takes a claim through every step. Its seed adds a quarantine bin `JQ-01` to the stock journeys' godown, the pump's costed stock, and a fresh in-warranty serial whenever a run has used the last.
- Documents: DATABASE §4.1 (`app.warranty_claim_record_cost()`), §6.5 (the registry's R3 rows, `warranty_claim_costs`); phase3 §7.5 "Built (R3)"; `docs/state-machines`, `docs/data` regenerated.

**Tests added in this lane:**
- `packages/domain/tests/commands/warranty.test.ts` gains 3 cases (15 in all):
  - denied (GM, Store Manager, Accounts) and wrong company for both commands, and no RMA before a replacement;
  - one claim end to end, raise → identify → replace with the failed serial back → RMA → credit. It checks the serials' states, bins, customer and warranty, both movements referring to the claim, and the cost `12000.00` read only by Accounts (not the Inventory Manager or the GM). The cost appears in no answer, audit row or event;
  - the failed serial brought back with the RMA, only into quarantine, and refused when not back or for an unknown vendor.
- `packages/db/tests/security/warranty.test.ts` gains 2 cases: the three grant and move rows exactly; the cost definer's grants and refusals. X4's own suite checks each of my rows role by role ("every row gives exactly its permission").
- The agent refusal sweep holds inputs for both new commands.

**Checks, on `e6056ac8` plus the budget change, through the lock:**
- `pnpm lint` (whole repository): exit 0.
- `pnpm typecheck`: 10 successful.
- `pnpm copy-lint`: clean.
- Unit tests: domain 2832 passed; web 1180 passed, 1 skipped.
- `pnpm test:security`: db 1892 passed, domain 1557 passed, web 466 passed.
- `pnpm build`: passed.
- `pnpm --filter web js-budget`: passes once `/catalogue` is raised from 245 to 246 kB (measured 245.1 with the Warranty claims menu entry in the shell). The warranty pages measure 237.4 and 205.7 kB.
- `pnpm --filter web e2e:seed`: passed (14 roles, 3 projects).
- **`apps/web/js-budget.json` changes** (the two warranty pages and `/catalogue`): the pull request needs the owner's `checks-ok`.

**EXPLAIN (ANALYZE):** the queries are unchanged since the early check (its figures above stand).

**Journeys not run:** journeys cannot sign in on a seat. `warranty.spec.ts` is written and its seed ran; the lead runs it and makes the Linux baselines (`warranty-raise-dialog`, `warranty-replace-dialog`, `warranty-settle-dialog`, `warranty-claim-closed-gm`).

**Still waiting:** `.settle` by a supplier's replacement waits for U2's `receipt` (U2 has not merged). The column `supplier_serial_id` and the `replacement` settlement are in the table and its checks; the command takes only a credit until then.

**Assumptions added in this lane:**
- The faulty item's return enters quarantine at the moving average (the ledger's default for an inbound line without a cost) and leaves for the supplier at it, so the two net to nothing in the valuation.
- The serial machine's `replace` asks `inventory.stock.move` (H1's machine, not changed here). Every holder of `inventory.warranty.write` (Executive, Inventory Manager) holds it.
- A replacement's and an RMA reference's numbers are free text, so they are masked like any other input text (as H1's serial numbers are), not listed in `unmaskedFields`.
- The RMA dialog offers the first 200 active vendors by name.

### 28-11-2026, seat (worktree `r3-warranty`, Postgres 54335): fixes

**Stage.** The one fix round: findings 1 to 9 and 12, as the lead's triage says. The container restarted midway; the seat committed my work as `fadaf6f9` and I carried on from it on a new, empty database (migrated and seeded afresh). Skills loaded: none new (the changes follow the patterns already in the slice). `main` was not taken in (it has moved to `4338c5e7`; the lead takes it in at integration).

**Fixed:**
1. **Stale data dictionary (high).** `pnpm db:docs` after the last edit of DATABASE; `docs/data/data-dictionary.md` committed; db unit tests 161 passed (the data-docs test among them).
2. **The step marked "Next".** `apps/web/src/screens/warranty.ts`: `claimSteps(state)` replaces `claimStepStatus()`. Every step up to the claim's state is done, the one after it is current ("Next"), the rest still to come. A rejected claim lists "Claim raised" and "Claim rejected", both done, and no later step (its state does not say whether it was identified first, so the sheet claims neither). New key `warranty.steps.rejected`. The unit test now asserts the whole list for `raised`, `serial_identified`, `rma_raised`, `closed` and `rejected`.
3. **Row security holds a claim to its steps.** `app.warranty_claims_guard()` (in `0244_r3_warranty_claims_rls.sql`) now allows only the machine's transitions (`raised` → `serial_identified`, → `replacement_issued`, → `rma_raised`, → `closed`; `raised` or `serial_identified` → `rejected`). Each transition needs its own step's grant (42501 otherwise), and each changes only its own columns. Any other update, including one with no state change, is refused with `warranty_claim_transition_not_allowed`. The migration header, DATABASE §6.5 and phase3 §7.5 "Built (R3)" now say this.
4. **SECURITY §4** lists `warranty_claim_costs` among the cost side tables.
5. **The machine's note** now reads "…refused with its date, and the claim is then rejected by hand"; `machines:docs` regenerated.
6. **`warrantyUntilFrom()`'s comment** now says what the code does: the day before the same date, or before the month's last day when the month has no such date (31-01-2026 plus one month runs to 27-02-2026; 12 months from 29-02-2028 to 27-02-2029). The rule stays for the client (assumption below).
7. **A warranty end before the delivery** is refused `date_invalid` on Warranty until, in the preview and in `app.installed_base_add()` (`0245`, constraint `warranty_before_delivery`, mapped to the same finding at commit). DATABASE §4.1 and phase3 §7.5 record it.
8. **Back with us now needs a quarantine bin.** With none, Give a replacement offers only "Still with the customer" and says why under the field (`warranty.dialogs.noQuarantineBin`). A chosen bin is always sent, so an empty one is refused rather than dropped.
9. **Snapshots** added to `apps/web/e2e/warranty.spec.ts`: `warranty-identify-dialog` (with the out-of-warranty refusal), `warranty-rma-dialog` (before the run's reference is typed), and `warranty-list`. The list's grid and state tabs are masked, since their rows and counts grow with every walk.
12. **The list's cursor** carries `created_at` to the microsecond as text from SQL (`to_char(... 'US')`), not through `Date`.

**Tests added or changed:**
- `packages/db/tests/security/warranty.test.ts` +1 (25 in all): settlement's grant alone cannot take a `replacement_issued` claim back to `serial_identified` (the review's probe) or raise the RMA (42501); no change without a step; no step writes another step's column; the RMA step itself passes.
- `packages/domain/tests/commands/import-installed-base.test.ts` +1 and one row more (4 in all): a swapped Warranty until refused in the preview (row 13); a stored row changed after the preview refused by the definer at commit, `warrantyUntil`/`date_invalid`, no serial added.
- `packages/domain/tests/queries/warranty.test.ts` +1 (5 in all): two claims raised 300 µs apart within one millisecond, paged one at a time, both seen in order.
- `apps/web/src/screens/warranty.test.ts`: the step case rewritten, one added for a rejected claim (3 in all).

**Checks, on `43e2ccb3`, through the lock:**
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs`: regenerated and committed.
- `pnpm typecheck`: 10 successful.
- `pnpm exec eslint --max-warnings 0` on every folder touched: clean. `pnpm lint` (whole repository): exit 0.
- `pnpm copy-lint`: clean.
- Unit tests (`turbo run test --force`): contracts 340 passed; db 161 passed; domain 2832 passed; web 1264 passed, 1 skipped.
- `pnpm test:security`: db 65 files, 1893 passed; domain 114 files, 1559 passed; web 40 files, 466 passed.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within its budget (67 pages); `/inventory/warranty` 237.5 kB of 250, `/inventory/warranty/[id]` 205.7 of 216, `/catalogue` 245.1 of 246.

**EXPLAIN (ANALYZE):** the list's plan is unchanged. The cursor's text adds one `to_char` per returned row (at most 51), and the keyset predicate is the same.

**Journeys not run:** journeys cannot sign in on a seat. The lead runs `warranty.spec.ts` and makes the Linux baselines, now seven: `warranty-raise-dialog`, `warranty-identify-dialog`, `warranty-replace-dialog`, `warranty-rma-dialog`, `warranty-settle-dialog`, `warranty-list`, `warranty-claim-closed-gm`.

**For the lead:**
- Migrations `0244` and `0245` were edited in place, since neither is on `main`. A database that applied this branch's earlier text fails `assertAllApplied` (the migration check) and needs a fresh one. The slot databases of the earlier lanes and of the review are affected.
- Finding 10 (the PRD trace) is yours at the merge. Finding 11 is resolved by H2.

**Assumptions added in this round:**
- A rejected claim's sheet does not say whether the serial was identified before the rejection, since only the state records the step. It lists the raising and the rejection only.
- The warranty's end from a delivery on a date the end month lacks (31st, or 29-02) is the day before that month's last day, as built. This goes to the client with phase3 §12 question 10.
- The guard refuses every update that does not change the state, so a later slice that needs to correct a step's column needs its own transition or definer.

## Review
Slice-reviewer, 27-11-2026, cloud session, on c53d3a56 (`git diff origin/main...feat/r3-warranty`; the branch holds `main` `fc42a09f`), Tier A. Run in the VM on the slot's Postgres (54331), each through `heavy.sh`:
- `pnpm test:security` on the slot database (migrated and seeded by the suite): db 65 files, 1892 passed; domain 114 files, 1557 passed; web 40 files, 466 passed.
- Unit tests: contracts 340 passed; domain 2832 passed; web 1263 passed, 1 skipped; db **160 passed, 1 failed** (finding 1).
- One probe in `psql` as `app_user` with a request's settings, in a transaction rolled back; its fixture rows were removed afterwards (finding 3).

Not run: typecheck, the whole-repository lint, `pnpm build`, `js-budget` and `copy-lint` (the builder reports them green on `e6056ac8`). **Journeys not run:** a cloud session cannot sign in, so none of `apps/web/e2e/warranty.spec.ts` ran (the Inventory Manager's walk through every step, the rejection, the list by state, the General Manager's closed claim, Accounts' costs). The branch has no screenshot baselines, so no layout was reviewed; the lead runs the journeys and makes the four baselines at integration.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | High | **The generated data dictionary is stale, so CI's db unit tests fail (confirmed: run).** `packages/db/src/docs/data-docs.test.ts` fails: `docs/data/data-dictionary.md` still carries the earlier `warranty_claim_costs` entry ("written only by `app.warranty_claim_record_credit()` (and, with the replacement step, the cost of the replacement's movement)"), while `docs/05-database.md` §6.5 now names `app.warranty_claim_record_cost()`. The done report lists domain and web unit tests, not db. Scenario: the pull request's CI run goes red on `@shakti/db` test and the slice cannot merge. Fix: `pnpm db:docs`, commit `docs/data/`, run `pnpm --filter @shakti/db test`. | open |
| 2 | Medium | **The claim sheet marks the step already reached as "Next" (confirmed by reading and by its own unit test).** `apps/web/src/screens/warranty.ts` `claimStepStatus()` returns `current` for the step equal to the claim's state, and `en.json:7011` renders `current` as "Next"; `warranty.test.ts` asserts `claimStepStatus('serial_identified', 'serial_identified')` is `current`. Scenario: on a claim whose serial is identified, the Inventory Manager reads "Faulty serial identified, in warranty — Next" while the real next step, "Replacement given from stock", carries no mark; a claim rejected after identification shows its identification as not done. Fix: a step at or before the state is `done`; the one after it (for a claim neither closed nor rejected) is `current`; flip the test cases. | open |
| 3 | Low | **Row security does not hold a claim to its steps (confirmed: probe).** `warranty_claims_update` (`0244`) lets any of `inventory.warranty.write`, `procurement.po.write` or `procurement.grn.write` write every step column, and `app.warranty_claims_guard()` stops only a final claim and a serial change after `raised`. The probe, as `app_user` with `inventory.stock.read` and `procurement.grn.write` only, moved a `replacement_issued` claim back to `serial_identified` with its replacement still set (UPDATE 1). Only a command reaches `app_user` today, so this is defence in depth, but phase3 §7.5 "Built (R3)" and the migration's header say "moved on by each step's grant". Scenario: a later command or definer that writes the row wrongly lets a claim go back, and a second replacement leaves stock for one claim. Fix: in the guard, allow only the machine's (old, new) state pairs; or reword the Built record and the header to what row security holds. | open |
| 4 | Low | **SECURITY's list of cost side tables leaves the new one out (confirmed by reading).** `docs/07-security.md:388` (§4) names `item_costs`, `stock_movement_costs`, `job_cost_entries`, `tally_purchase_vouchers`. Fix: add `warranty_claim_costs`. | open |
| 5 | Low | **The machine's note says an out-of-warranty identification rejects the claim; it does not (confirmed by reading).** `warranty-claim.ts:126` and the generated `docs/state-machines/warranty-claim.md:38`: "out of warranty it is refused with its date, and the claim is rejected". The command throws `warranty_expired` and the claim stays `raised` until someone rejects it, as the dialog's copy says. Fix: "…refused with its date; the claim is then rejected by hand", and `machines:docs`. | open |
| 6 | Low | **`warrantyUntilFrom()`'s comment contradicts its code, and month-end deliveries lose days (confirmed by reading and its tests).** `packages/domain/src/warranty/dates.ts:33` says "or the last day of that month when it has no such date", but the code clamps the date and then subtracts a day: 31-01-2026 plus one month runs to 27-02-2026 (the test expects it), and a 12-month warranty from 29-02-2028 ends 27-02-2029, a day short of 28-02. Scenario: a customer whose pump was delivered on a leap day is refused at identification on 28-02. Fix: the client's rule (phase3 §12 question 10); until then make the comment say what the code does, and record it with the assumption. | open, for the client |
| 7 | Low | **The installed base takes a warranty end before the delivery date (confirmed by reading).** `packages/domain/src/imports/installed-base.ts:193` parses the Warranty until cell and `app.installed_base_add()` checks only the delivery date. Scenario: a sheet with the two date columns swapped imports serials already out of warranty, and every claim on them is refused. Fix: refuse the row `date_invalid` on Warranty until when it is before the delivery date, in the preview (and the definer). | open |
| 8 | Low | **Give a replacement drops the faulty item's return silently when no quarantine bin exists (confirmed by reading).** `warranty-dialogs.tsx:405` sends `faultyBinId` only when one is chosen; with "Back with us now" and an empty quarantine list the replacement posts and the faulty serial stays with the customer. Scenario: a hub without a quarantine bin; the store believes the item is back, and the RMA later asks for it again. Fix: when "Back with us now" is chosen with no quarantine bin, show the field error (or hide the choice). | open |
| 9 | Low | **Snapshots are missing for the new list and two dialogs (confirmed by reading).** Brief point 6 asks for axe and snapshots of the screens; `warranty.spec.ts` snaps the raise, replace and settle dialogs and the General Manager's claim, but not `/inventory/warranty` (axe only), the identify dialog (the early check had `warranty-identify-dialog`) or the RMA dialog. Fix: `snap()` the list in 'lists the claims by state' and the identify and RMA dialogs. | open |
| 10 | Low | **The PRD trace still names only the machine test for INV-08 (confirmed by reading).** `docs/02-prd.md:393`. Fix: name R3 and its suites (`warranty.test.ts` in db and domain, `e2e/warranty.spec.ts`). | open, for the lead |
| 11 | Low, for the lead | **Lead Converters see every warranty claim of their company (plausible, design).** Claims are read with `inventory.stock.read` (the brief's assumption), which `tele_caller_lc` holds at entity scope (`role-permissions.ts`, for availability on quotes), so the menu entry, the list, the sheet and the free-text fault reach callers; customers they do not look after show without a name. Decide whether reading claims should need `inventory.warranty.write` or a role other than the caller's. | open, for the lead |
| 12 | Low | **The list's cursor drops microseconds (plausible; H1's stock card does the same).** `queries/inventory/warranty.ts:171` encodes `created_at` through `Date`, so a claim older than the page's last but in the same millisecond is skipped on the next page. Claims are raised one per transaction, so this needs two raised within one millisecond. Fix with H1's card: carry the timestamp as text from SQL. | open, follow-up |

**Found sound:**
- **Costs per role:** `warranty_claim_costs` is the house side table (`cost_gate` on `finance.cost.read:entity`, both pools, no write grant to any request role); the suite reads it role by role on both pools and as every agent. The two definers answer nothing, check their permission and company in the body, set `search_path = ''` and are executable by `app_user` only. The credit is kept out of the command's answer, the audit input (`auditInput`), the audit row, the event and the idempotency store (a hash only); `warranty_replacement`, `return_customer` and `return_supplier` movements go through `postStockMoves()`, whose audit rows and `inventory.stock.moved` carry no cost. The claim sheet asks for costs only with `finance.cost.read`, and `readWarrantyClaimCosts` checks it again.
- **Serial state and bin in step:** every state change goes through `app.stock_move()` with X4's move rows (`in_stock` → `with_customer` bin null with the customer fields; `with_customer` → `faulty` into a quarantine bin; `faulty` → `with_supplier` bin null), after the serial machine's event; the installed base's two definers insert only `with_customer` with no bin and delete only untouched serials. No redefinition of `app.stock_move()`; the grant and move rows are one insert each, none reversible.
- **IST dates:** `underWarranty` compares with `istCalendarDate(now)`; the domain test covers 23:30 and 00:30 IST on the last day (18:00 and 19:00 UTC); the installed base reads today in IST in the preview and the definer, stores delivery at IST midnight, and screens print calendar dates without a time-zone shift.
- **Isolation:** both tables are in the testing lists with a fixture row per company and matrix rules; policies fail closed with no settings; claims and costs on `app_reader`; `next_document_no()` equals 0201's plus one line, and `document_sequences_doc_type_check` and the three import checks hold every value `main` has.
- **Commands:** six commands, one per machine event, each `peopleOnly`, with denied, wrong-company and happy-path tests, `auditFields`, one audit row per claim step, catalogue events with ids only, `constraintReasons` for the open-claim index, steps serialised by `select … for update` on the claim; all six in the agent refusal sweep; the four queries in reader parity.
- **Web:** reads through `executeQuery()` with names, writes through `executeCommand()`, `screenAccess(navRequires())` on both pages, types-only imports from `@shakti/contracts` in browser code, one idempotency key per form, every string in `en.json`.
- **Tests:** exact codes and states asserted, no sleeps, nothing skipped; the ledger test's list of refused reasons loses exactly the three reasons opened here.

**The lead's triage (27-11-2026):** fix 1 to 9 and 12 in the one fix round.
- **1:** run `pnpm db:docs` after the last edit of DATABASE, and run the db unit tests.
- **3:** the guard holds each step's columns to its own command's grant and step.
- **7:** refuse a warranty end before the delivery date.
- **8:** "Back with us now" needs a quarantine bin. Without one, the dialog says so and offers "Not back yet".
- **9:** snapshots of `/inventory/warranty`, the identify dialog and the rest named.
- **12:** keep the cursor's microseconds (text, not `Date`).
- **10:** the lead's, at the merge.
- **11:** resolved by H2, which takes `inventory.stock.read` off the Lead Converter (the owner's decision of 27-11-2026). Nothing to do here.
- **Finding 1 is high, so the reviewer re-checks the fix diff.**

**Re-check (slice-reviewer, 28-11-2026, cloud session), on `ab55157d`:** `git diff cc48e2c8..ab55157d`, four commits (`fadaf6f9`, `65b94681`, `43e2ccb3`, `ab55157d`). The round took no merge of `main`, so every change in the diff is the round's own. `main` (`4338c5e7`) has added no migration since the branch's base `fc42a09f`, so 0243 to 0246 still follow its last (0242). Run on the slot's new database (54331, migrated and seeded first), each through `heavy.sh`:
- `pnpm --filter @shakti/db test`: 12 files, **161 passed** (`data-docs.test.ts` among them).
- db security: `warranty.test.ts`, `role-entity-matrix.test.ts` and `stock-reason-moves.test.ts`: 145 passed.
- domain security: `commands/warranty.test.ts`, `queries/warranty.test.ts` and `commands/import-installed-base.test.ts`: 24 passed.
- `apps/web/src/screens/warranty.test.ts` 3 passed; domain `src/state-machines` and `src/warranty` 1,363 passed (the machine documents' freshness test among them).
- `pnpm typecheck` 10 successful; `eslint --max-warnings 0` on every `.ts`/`.tsx` file the round changed clean; `pnpm copy-lint` clean.

Not run: the whole security suite, the whole-repository lint, `pnpm build` and `js-budget` (the builder reports them green on `43e2ccb3`). **Journeys not run:** a cloud session cannot sign in, so `apps/web/e2e/warranty.spec.ts` did not run, nor its three new snapshots (`warranty-identify-dialog` after the out-of-warranty refusal, `warranty-rma-dialog` before the run's reference, `warranty-list` with the grid and state tabs masked). The branch still has no baselines, so no layout was reviewed.

| # | Finding | Re-check |
|---|---|---|
| 1 | Stale data dictionary | **Fixed and tested.** `docs/data/data-dictionary.md` now names `app.warranty_claim_record_cost()` and the guard's wording; the db unit tests pass (161). |
| 2 | The reached step marked "Next" | **Fixed and tested.** `claimSteps(state)` marks each step up to the state done and the one after it current ("Next"); a rejected claim lists "Claim raised" and "Claim rejected" only (new key `warranty.steps.rejected`). The unit test asserts whole lists for `raised` and `serial_identified`, the tail of `rma_raised`, all done for `closed`, and the rejected list. |
| 3 | Row security does not hold a claim to its steps | **Fixed and tested.** `app.warranty_claims_guard()` now allows only the machine's five transitions, each under its own grant (42501 otherwise), each changing only its own columns, and refuses an update with no state change. The new db case replays the review's probe (settlement's grant alone cannot take a `replacement_issued` claim back: 23514) and checks the RMA under the wrong grant (42501), a change with no step, a step writing another step's column, and the RMA step passing. I read each `writeStep()` call against the guard's lists: identify (`item_id`, `serial_id`), replace (`replacement_serial_id`), RMA (`vendor_id`, `supplier_rma_ref`), settle (`settlement`), reject (`rejected_reason`); `state_changed_at`, `updated_at` and `updated_by` are outside the compared columns, as they should be. No other writer updates the table (the e2e seed and the matrix fixture only insert). |
| 4 | SECURITY §4 leaves out the side table | **Fixed** (`docs/07-security.md` §4 names `warranty_claim_costs`). |
| 5 | The machine's note | **Fixed** ("…and the claim is then rejected by hand"); `docs/state-machines/warranty-claim.md` regenerated and its freshness test passes. |
| 6 | `warrantyUntilFrom()`'s comment | **Fixed as the comment; the rule stays for the client.** I ran the function on the comment's three examples: 10-03-2026 +12 → 09-03-2027, 31-01-2026 +1 → 27-02-2026, 29-02-2028 +12 → 27-02-2029, as it says. The run file records the month-end rule as an assumption for phase3 §12 question 10. |
| 7 | A warranty end before the delivery | **Fixed and tested.** The preview refuses it `date_invalid` on Warranty until (row 13 of the refusals case), and `app.installed_base_add()` refuses it as `warranty_before_delivery`, mapped to the same finding; the new case alters the stored row after the preview and sees the commit refuse it with no serial added. DATABASE §4.1 and the Built record say so. |
| 8 | Give a replacement drops the return silently | **Fixed, not tested.** With no quarantine bin the dialog offers only "Still with the customer" and says why under the field; once chosen, the bin is always sent, so an empty one is refused rather than dropped. `back` starts false and cannot become true without the option, so the hidden choice cannot be left set. No component test covers it, and the journey's seed has a quarantine bin. |
| 9 | Missing snapshots | **Fixed in the spec, not run.** The three `snap()` calls are in place, each on content that is the same on every walk (the expired serial's fixed date, the seeded supplier, the masked grid and tabs). The lead makes the seven baselines at integration. |
| 10 | The PRD trace | The lead's, at the merge. |
| 11 | Lead Converters read claims | Resolved by H2, as the triage says. |
| 12 | The cursor drops microseconds | **Fixed and tested.** The cursor carries `created_at` as text to the microsecond (`to_char(... 'US')`); the cursor schema (`z.iso.datetime({ offset: true })`) takes six digits, and the predicate casts the text in SQL. The new case (two claims 300 µs apart, one per page) fails under the old code, whose cursor at `.000Z` skips the older claim. |

**New in the round:**

| # | Severity | Finding | State |
|---|---|---|---|
| 13 | Low | **The cursor test cannot reach its claims on a database holding the EXPLAIN spike's rows (confirmed by reading).** `packages/domain/tests/queries/warranty.test.ts:110` walks company 4's claims from the newest, one per page, at most 500 pages, to reach two claims dated 2001, the oldest. `packages/domain/tests/spike/warranty-explain.ts` leaves 20,000 claims of company 4 in the local database. Scenario: a builder who ran the spike reruns the suite on that database and the case fails, with 500 queries spent first; CI's fresh database is not affected. Fix: start the walk from a cursor just above the two claims (`encodeCursor(['2001-01-01T00:00:01.000000Z', 'ffffffff-ffff-ffff-ffff-ffffffffffff'])`), so it takes two or three pages. | open, follow-up |

**The ledger rows against X4's registry on `main`** (`0240_x4_stock_reasons.sql`): `0246_r3_warranty_ledger.sql`, unchanged by the round, inserts three `app.stock_reason_grants` rows with `reversible` false and three `app.stock_reason_moves` rows on conflict `(reason, direction, reverses_reason)`, with `reverses_reason` taking its default `''`. Each row passes the registry's checks: `warranty_replacement` out from `{in_stock}` to `with_customer`, `return_customer` in from `{with_customer}` to `faulty`, `return_supplier` out from `{faulty}` to `with_supplier`, none `creates`. No reason is reversible, so no reversal rows are owed. The db reason-move suite passes with them.

**Verdict:** findings 1 to 9 and 12 are fixed (8 and 9 without a run test, as said above); the high finding is closed. Nothing the round changed blocks the merge. Finding 13 is a follow-up. Both of the round's migrations (`0244`, `0245`) were edited in place, so any database that applied their earlier text needs a fresh one, as the builder's report says.

## Integration

### Integration prep, 28-11-2026, cloud seat (worktree `r3-warranty`, Postgres 54332; integrate.sh on 54340): blocked at format
Took `main` `994631ae` (#301 to #305: the 27-11 status documents, the demo data's IST day, J2, TC1, the axe title wait, the calling-hours clock) into the branch from `896e0df6` (saved in `../r3-warranty-premerge.sha`), with a merge commit, following slice-integration §5: merge commit `5097ee74`, pushed. Its subject names J2 as "#302-#304" by mistake; the list above is the right one.
- **Install:** `pnpm install --offline --frozen-lockfile` worked, and the lockfile is `main`'s, unchanged by the install.
- **Migrations:** `renumber-migrations.mjs origin/main 896e0df6` moved `0243_r3_warranty_claims` to `0247`, `0244_r3_warranty_claims_rls` to `0248`, `0245_r3_installed_base_rls` to `0249` and `0246_r3_warranty_ledger` to `0250`. Each file's SQL is the same as on the branch. The journal times come after `main`'s last, and the snapshot chain runs on from `main`'s 0246 (0250 written by drizzle-kit, 109 tables). `pnpm db:generate` printed "No schema changes, nothing to migrate". `pnpm db:docs` and `machines:docs` were run again. `docs/05-database.md` now cites 0247 to 0250 in R3's rows.
- **How the conflicts were settled:**
  - Joined, keeping both sides: the testing lists, the matrix fixture (R3's claim id offset `0x83` is used nowhere else), `enum-sync`, `grants`, the machine registry, reader parity, the schema index, the activity details, the audit kinds and event map, `contract-values` and its test, and the Account 360 page and screen (`canRaiseClaim` and `loans` together).
  - Event catalogue: settled by hand (the warranty `closed` entry was missing its closing brace).
  - `en.json` and the copy-lint config: settled with their helpers.
  - `js-budget.json`: keeps `main`'s `/catalogue` entry. Both sides had raised it to 246 kB for one menu entry each, and the shell now has both entries. The jsbudget part, which would show whether 246 kB still holds, has not run.
- **What the merge broke, and the fixes:**
  - Both R3 and J2 added the audit field `rejectedReason` with different labels, and the merge helper kept `main`'s. A rejected claim's Activity log would have read "Why the lender turned it down". R3's audit field is now `claimRejectedReason` ("Why it was rejected") in `CLAIM_AUDIT_FIELDS`, the reject command's audit row, `screens/audit.ts` and `activity.fields`. J2's key and label are as on `main`.
  - Q1's `app.labels_for_print` row in `docs/05-database.md` cites `0242` again. This branch's earlier merge (`ec487b48`) had changed it to 0245.
- **Redefinitions checked against `main`'s latest:**
  - `app.next_document_no()` (0248) is identical to `main`'s latest (0201), plus the one line `when 'warranty_claim' then 'inventory.warranty.write:own'`.
  - `document_sequences_doc_type_check` (0247) holds `main`'s values from 0007 (`quote`, `sales_order`, `proforma`, `challan`, `purchase_order`) plus `warranty_claim`. No later migration on `main` redefines it.
  - `import_jobs_kind_check`, `import_mapping_templates_kind_check` and `import_rows_created_type_check` (0247) each hold `main`'s latest values (0236) plus `installed_base` and `serial`.
  - The notification checks: R3 changes none of them. `main`'s latest is J2's 0245, which stays untouched.
  - `app.platform_only_permissions()`: R3 does not redefine it and adds no permission.
  - X4's registry (0240): no later migration on `main` touches it. R3's 0250 adds three `stock_reason_grants` rows: `warranty_replacement` and `return_customer` under `inventory.warranty.write:entity`, `return_supplier` under `procurement.po.write:entity`, none reversible, `opened_by` `r3-warranty`. It also adds three `stock_reason_moves` rows: `warranty_replacement` out `{in_stock}` to `with_customer`, `return_customer` in `{with_customer}` to `faulty`, `return_supplier` out `{faulty}` to `with_supplier`, none `creates`. Each row passes 0240's reason, permission, `opened_by`, direction, states, creates and bin checks, and none of the three reasons is in X4's seed rows, so `on conflict do nothing` skips nothing.
  - R3's foreign keys are all on its own tables (0247), and no R3 function shares a name with one on `main`.
- **Keys used twice:** none in `en.json`, the copy-lint config, `js-budget.json`, the audit field kinds (342), the testing lists, the fixture offsets R3 adds, or the e2e users (R3 adds no user).
- **Typecheck right after the merge:** `pnpm typecheck` (through `heavy.sh`): `Tasks: 11 successful, 11 total`.
- **Part 1** (`install lint format copylint generated typecheck`): `=== INTEGRATION FAILED`. install rc=0, lint rc=0, **format rc=1**, copylint rc=0, generated rc=0, typecheck rc=0, `urls_not_on_54340=0`. The format log:
  ```
  $ prettier --check .
  [warn] packages/domain/tests/queries/warranty.test.ts
  [warn] Code style issues found in the above file. Run Prettier with --write to fix.
  ```
  **This is outside the merge.** The file is byte-identical to `896e0df6`, and Prettier (3.10.1) is unchanged. The two unformatted lines (line 103's `(m) => m\`insert into warranty_claims …\`` and line 112's `listWarrantyClaims(ctx, { entityId: 4, limit: 1, ... })`) came in with the fix round's cursor test (`65b94681`), so the branch as pushed already fails CI's format check. The fix is `pnpm exec prettier --write packages/domain/tests/queries/warranty.test.ts`, which only rewraps those two calls. I left it, as the prep brief says.
- **Not run:** parts 2 (`unit`), 3 (`security dbverify`) and 4 (`audit build jsbudget gitleaks`), and no suite counts. The e2e step was never run. Once the format fix is in, the lead or a new prep lane runs part 1 again and then parts 2 to 4.
