# U2 Purchase orders and goods receipt (wave 2)

| | |
|---|---|
| Branch | `feat/u2-purchase-orders` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): supplier rates, stock in, the moving average, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; built on the seat by Opus 5.5 at high effort (start and early check) |
| State | early check (the `receipt` opening waits for X4) |
| Next step | the lead reads the early check; X4 merges; the builder continues |

## Brief
Build [phase3 §7.2](../../03-roadmap-appendix/phase3.md#72-u2-purchase-orders-and-goods-receipt) as written, with questions 2 (a), 5 (a) and 8 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:** `reorder_rules`, `purchase_orders`, `po_lines`, `goods_receipts` and `goods_receipt_lines` with the columns of §7.2. New series kinds `purchase_order` (if absent) and `goods_receipt` (code `GRN`), numbered per company and financial year by the existing document-sequence helper. The rate columns (`po_lines.unit_rate`, `.amount`, `goods_receipt_lines.unit_rate`) are readable only with `procurement.rate.read`, as U1's `vendor_quotes` are. Use a separate restricted table or column-level grants with a definer, whichever H1's `stock_movement_costs` and U1 make the house pattern. Name your choice in the report.
2. **Opening the `receipt` reason:** X4 makes the reason registry. Open `receipt` to `procurement.grn.write:entity` with one insert into `app.stock_reason_grants` in your own migration, and its grant test. Never redefine `app.stock_move()`. If X4 has not merged when you reach this point, take `main` in once it has. Build the rest meanwhile, and say so in the report if you must stop.
3. **The `purchase-order` machine** (`draft` → `approved` → `sent` → `partially_received` → `received` → `closed`, with `cancelled` from draft, approved or sent) in `packages/domain/src/state-machines/machines/`, documented by `machines:docs`.
4. **Approval** (question 5 (a)):
   - A new `procurement.po.approve` gets its row in SECURITY §3.2, its seed (Executive all, Inventory Manager entity) and its oracle case.
   - The Inventory Manager approves below `WORKSHOP_DEFAULTS.procurement.poApprovalFromRupees` (₹2,00,000 on the grand total including GST, worked out by the tax engine with the vendor's state code and the place of supply).
   - Nobody approves a purchase order they drafted, unless they are an Executive.
   - An order is overdue 7 days after its expected date (`WORKSHOP_DEFAULTS.procurement`).
5. **Reorder:**
   - `procurement.reorder.draft` is platform-only: add it to `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX` and SECURITY §3.3, and redefine `app.platform_only_permissions()` with every key of `main`'s latest version.
   - A daily job, and every issue, compares free stock plus open purchase quantities with each rule. It drafts one order per preferred vendor and company with no rate, and tells the Inventory Manager.
   - Filling the rate from the vendor's valid quote happens only under the editing person's own `procurement.rate.read`.
6. **Commands:** `procurement.po.create`, `.update` (a draft), `.approve`, `.send` (the PDF by the mailer or marked sent by hand), `.cancel` (with a reason), `.close` (short-close with a reason), `procurement.grn.post` and `procurement.grn.reverse`.
   - Posting moves stock in through `app.stock_move()` with reason `receipt` at the receipt's rate, raises `procurement.receipt.posted` and lets H2's worker fill backorders through `inventory.stock.moved`.
   - At receipt, every serial of a tracked item is scanned or typed, matches the item's pattern (C5), is unique for the item and is counted against the quantity. A receipt with one serial missing is refused.
   - A reversal of the whole receipt is allowed only while none of its stock or serials has moved on.
   - Audit fields and events never carry a rate or an amount.
7. **The scan field** (`apps/web/src/screens/scan`, question 8 (a)): one input taking a handheld scanner's keystrokes or the camera's reading. It says at once whether a code is known, a repeat or the wrong pattern, and keeps the count. It takes a `resolve(code)` function as a prop, so Q1's `parseLabelPayload()` can be wired in by whichever of Q1 and U2 merges second.
   - The camera path uses only what the browser and the installed packages give. A missing barcode decoder is a gap to report, never a new package.
8. **Documents:** the purchase order PDF (letterhead, lines, rates and the tax split, light, A4) as a template in the print registry. Rates print only for a holder of `procurement.rate.read`.
9. **Screens:** `/procurement/orders` (by state, reorder alerts on top), the order sheet, Receive goods (by order, line by line, serials by scan), `/procurement/receipts`, and reorder rules on the item's stock card. Journeys: the Inventory Manager (draft, approve, send, receive with serials) and the General Manager (no rate anywhere), with axe and snapshots.

**Early check (Tier A):** once the tables, row security, grants, the `receipt` opening, the machine, the commands and their security tests are committed, write a short report with the policies' text and push `report: u2-purchase-orders early check`, then stop. The tests to commit first: rates per role on every table and pool; approval limits and self-approval; a receipt with a missing serial refused; the moving average after a receipt; reorder drafts without rates.

Files owned: the five tables and their migrations; the `purchase-order` machine; `packages/contracts/src/procurement/` additions; `packages/domain/src/commands/procurement/` (orders, receipts, reorder); `packages/domain/src/queries/procurement/` additions; `apps/web/src/app/(bos)/procurement/orders`, `/receipts`; `apps/web/src/screens/scan`; the purchase order print template.

Do not touch: vendors and quotes beyond reading them (U1, merged); `items` (C5); reservations (H2); counts (H3); label templates (Q1); warranty (R3).

Review checklist: no rate or amount in any DTO, PDF, export, event, audit value, notification, log or error for a person without `procurement.rate.read`; the General Manager and the Store Manager see orders and receipts without values; every serial accounted for at receipt; a reversal impossible once stock moved on; the moving average equals the hand calculation in the test.

### Brief addendum (the lead, 27-11-2026 14:35 UTC)
X4 now also moves the serial rules of `app.stock_move()` into a table (`app.stock_reason_serial_moves`, X4's brief point 5): today the definer creates a serial only for `opening` and `adjust_gain`, so a receipt of new serials is refused with `stock_serial_unknown`. Open `receipt` with two inserts in your own migration once X4 has merged: the grant row (`procurement.grn.write:entity`) and the move row `receipt` / `in` / creates / `in_stock`. Never redefine `app.stock_move()`. Build everything else first; if X4 has not merged when only this remains, stop at the early check and say so.

### Brief addendum 2 (the lead, 27-11-2026 17:00 UTC): from X4's review
X4's fix round keys reversal move rows by the reason reversed, and a reversal takes the reversed reason's permission, so `procurement.grn.reverse` needs `procurement.grn.write` only. Your opening migration therefore adds:
- the grant row `receipt` → `procurement.grn.write:entity`, `reversible` true;
- the move row `receipt` / `in` / creates, with `from_states '{scrapped}'` so a serial whose receipt was reversed can be received again (X4's review, finding 4);
- the reversal move row (`reversal`, `out`, `reverses_reason` `receipt`, from `in_stock` → `scrapped`).

Read X4's final comment block for the exact columns once it merges.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: u2-purchase-orders <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: u2-purchase-orders blocked` with the question and stop.
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
Built on the seat in `/home/user/shakti-wt/u2-purchase-orders` (Postgres 54331). Skills loaded: `add-table`, `add-command`.

**Where it stands.** Everything of the early check is committed except the `receipt` opening, which needs X4's two tables: X4 has not merged (its branch holds `wip: x4 serial moves as data` only). Per the addendum I stop here. One more ledger point needs the lead (below, "Blocker for the lead").

**Built (files).**
- Schema `packages/db/src/schema/procurement.ts`: `reorder_rules`, `purchase_orders`, `po_lines`, `po_line_rates`, `goods_receipts`, `goods_receipt_lines`, `goods_receipt_line_rates`; `serials.vendor_id` and `serials.receipt_line_id` get their foreign keys and `serials_receipt_line_idx` (the comments in `stock.ts` said they arrive with U1 and U2). Series kind `goods_receipt` (code `GRN`) in the check, `DocTypeSchema` and `WORKSHOP_DEFAULTS.numbering`.
- Migrations `0240_u2_purchase_orders.sql` (generated; the widened `document_sequences_doc_type_check` is `NOT VALID`) and `0241_u2_purchase_orders_rls.sql` (custom).
- **House pattern for rates: a separate restricted table** (as H1's `stock_movement_costs` and U1's `vendor_quotes`), not column grants: `po_line_rates` (`unit_rate`, `amount`, `quote_id`) and `goods_receipt_line_rates` (`unit_rate`, append-only, written only by the receipt definer). So `po_lines` and `goods_receipt_lines` carry no value at all, and both pools apply one policy.
- Definers (all `search_path = ''`, execute revoked from `public`, `readonly_reporter`, `app_reader`): `app.goods_receipt_post(receipt, serials)` (checks `procurement.grn.write:entity` and the company, copies each order line's rate to the receipt line, builds the `receipt` batch at rate ÷ unit factor per stock unit and calls `app.stock_move()`, then stamps the new serials' vendor, receipt line and supplier warranty from the IST receipt date), `app.goods_receipt_unpost(receipt)` (refuses `goods_receipt_moved_on` when a serial is no longer `in_stock` in its bin or moved since, or the line's item left the bin since, or the bin's free quantity is below the line; then a `reversal` per movement), `app.reorder_shortfalls(company)` and `app.reorder_draft_po(...)` (both `procurement.reorder.draft:all`, the first under a per-company advisory lock held to the end of the transaction). Guards `app.purchase_orders_guard()` and `app.po_lines_guard()`. `app.next_document_no()` redefined from 0201's latest with `goods_receipt` → `procurement.grn.write` and `purchase_order` also for `procurement.reorder.draft`. `app.platform_only_permissions()` redefined from 0222's latest (all 19 keys) plus `procurement.reorder.draft`. **`app.stock_move()` is not redefined.**
- Permissions: `procurement.po.approve` (catalogue, scopes, seed Executive all and Inventory Manager entity, SECURITY §3.2 row, `AGENT_FORBIDDEN_PERMISSIONS`); `procurement.reorder.draft` (platform-only: `PLATFORM_ONLY_PERMISSIONS`, `PERMISSION_SCOPES`, `SYSTEM_MATRIX`, seed label, SECURITY §3.2 and §3.3 rows).
- `WORKSHOP_DEFAULTS.procurement`: `poApprovalFromRupees: 200_000`, `overdueAfterDays: 7`.
- Machine `packages/domain/src/state-machines/machines/purchase-order.ts` (`purchase_order`, in `MACHINES_IN_USE`), `docs/state-machines/purchase-order.md` by `machines:docs`.
- Contracts `packages/contracts/src/procurement/orders.ts`; events `procurement.po.drafted`, `.approved`, `.sent`, `.cancelled`, `.closed`, `procurement.receipt.posted`, `.reversed` (ids, codes, counts only); `inventory.stock.moved` also from `procurement.grn.post` and `.reverse`.
- Commands `packages/domain/src/commands/procurement/{po-shared,orders,receipts,reorder}.ts`: `procurement.po.create`, `.update`, `.approve` (also needs `procurement.rate.read`), `.send`, `.cancel`, `.close`, `procurement.grn.post`, `.reverse`, `procurement.reorder_rule.set`, `.remove`, `procurement.reorder.draft` (platform, `auditWhen: 'changed'`). Pure helpers `packages/domain/src/procurement/po-totals.ts` (`poLineAmount`, `stockUnitCost`, `purchaseOrderTotals` by the tax engine) and `receipt-moves.ts`.
- Web registrations only (no screen yet): activity-log names, fields and values (`apps/web/src/screens/audit.ts`, `activity-details.tsx`, `contract-values.ts`), 33 error sentences in `en.json`.
- Documents: DATABASE §4.3 and §6.5 rows, the append-only list; `pnpm db:docs` regenerated.

**The policies (from `0241`).**
```sql
-- rates: only procurement.rate.read in the row's company, both pools
create policy po_line_rates_read on po_line_rates for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.rate.read:entity')));
create policy po_line_rates_insert ... with check (company and rate.read and po.write
  and created_by = (select app.user_id()) and the order is a draft);   -- update and delete alike
create policy goods_receipt_line_rates_read on goods_receipt_line_rates for select
  to app_user, app_reader using (same as po_line_rates_read);         -- no write grant at all
-- orders and lines: read without values by stock readers (GM, Store Manager) and order writers
create policy purchase_orders_read on purchase_orders for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))));
create policy purchase_orders_insert ... with check (company and po.write and state = 'draft'
  and source = 'manual' and created_by = drafted_by = (select app.user_id())
  and approved_by is null and sent_at is null);
create policy purchase_orders_update ... using/with check (company and (po.write or po.approve
  or grn.write)) and updated_by = (select app.user_id());  -- the guard decides what each grant may change
create policy po_lines_insert/delete ... (company and po.write and the order is a draft);
create policy po_lines_update ... (company and (po.write or grn.write));  -- guard: only qty_received after draft
-- receipts: read as orders plus grn.write; inserted posted by the caller; updated only to reversed
create policy goods_receipts_reverse on goods_receipts for update to app_user
  using (company and grn.write and state = 'posted')
  with check (company and grn.write and state = 'reversed' and reversed_by = (select app.user_id()));
-- reorder_rules: read as orders, written with po.write in the company
```
`app.purchase_orders_guard()`: company, number, source and creator fixed; terms only in draft and only by a `procurement.po.write` holder who becomes `drafted_by`; approval once, sending once; the state moves only along the machine's pairs; `approved` needs `procurement.po.approve`, `approved_by` the caller, not the drafter unless `app.role` is `executive`, and every line with a rate row and a GST rate; send, cancel and close need `procurement.po.write`; receiving moves need `procurement.grn.write`. The ₹2,00,000 limit is checked in the command only (the total comes from the tax engine), as the guard comment says.

**Tests added.**
- `packages/db/tests/security/purchase-orders.test.ts`: 11 cases (two `it.each` over both pools): rates for every role key on `app_user` and `app_reader` (only Executive, Inventory Manager and Accounts read `po_line_rates` and `goods_receipt_line_rates`); GM and Store Manager read orders, lines, receipts and receipt lines with no rate, another company's people nothing; no value column on the four rows; no grant to `readonly_reporter`; fail closed with no context; the guard (a rate by a writer without the rate grant, self-approval, a line without GST, a sent order's terms and lines, an illegal move, a receipt rate's immutability); the definers refused to GM, Store, Accounts, an agent, another company, a receipt already in stock; the reorder definers refused to every person, Executive included; no execute for the reporting or reading role.
- The seven tables in `ENTITY_TABLES`, a row per company in `entity-matrix-fixture.ts`, rules in `role-entity-matrix.test.ts`, `NARROWER` in `grants.test.ts`, nine pairs in `enum-sync.test.ts`.
- `packages/domain/tests/commands/purchase-orders.test.ts`: 25 cases: denied and another-company cases for all eleven commands; create (number, amount, no rate in audit or event), the quote fill (company's quote before the group's, `po_quote_missing`), a rate refused without `procurement.rate.read`; update keeping rates and making the editor the drafter; **approval**: another Inventory Manager below the limit, refused at ₹1,69,491.53 + 18 % (= ₹2,00,000 after rounding) with `po_approval_limit` and approved there by an Executive, self-approval refused (`po_self_approval`) but an Executive's own above the limit approved, an incomplete order refused; send by email to a vendor's person, cancel with and without a reason; **a receipt with one serial missing refused** (`goods_receipt_serial_missing`, `missing: 1`, nothing written); repeated, off-pattern, over-order and wrong-bin refusals; **the moving average**: 10 m on hand at ₹100, 0.3 coils of 100 m at ₹20,000 received → 30 m at ₹200, average ₹175.0000 = (10 × 100 + 30 × 200) / 40, the movement's cost ₹200.0000, no rate in events or audit; serials received with vendor and receipt line; reversal back to ₹50.0000 from ₹61.2000 = (2 × 50 + 8 × 64) / 10; reversal refused once stock moved on; **reorder drafts**: one order per preferred vendor and hub (2 orders, 1 item without a vendor counted), quantities in purchase units (250 m in coils of 100 → 3), no `po_line_rates` row, drafted by the workers principal, a second run drafts nothing; refused to every person and another company.
- Unit: `po-totals.test.ts` 6, `purchase-order.test.ts` 6, five guard cases and a fixture in `machines.test.ts`; `agent-refusals.test.ts` inputs for the ten people-only commands.

**Checks run.**
- Unit: `@shakti/domain` `vitest run src` 112 files, 2924 passed; `@shakti/contracts` 25 files, 340 passed.
- `pnpm --filter @shakti/db exec vitest run --config vitest.security.config.ts` on `purchase-orders`, `grants`, `enum-sync`, `role-entity-matrix`: 4 files, 340 passed.
- `pnpm --filter @shakti/domain exec vitest run --config vitest.security.config.ts tests/commands/purchase-orders.test.ts`: 21 passed, 4 failed on `stock_reason_not_open`, as expected without X4. **With X4's opening simulated** (the `receipt` grant, `receipt` creating serials and `receipt` among the reversible reasons, patched into the slot database's `app.stock_move()` by hand and restored byte for byte afterwards, never committed): 25 passed.
- `agent-refusals.test.ts`: 60 passed. Web `errors-catalogue`, `audit`, `contract-values`: 29 passed. `pnpm copy-lint`: clean. Typecheck of contracts, db, domain and web: clean. ESLint on every touched folder: clean. Prettier: clean.
- `pnpm test:security` (through the lock): db 63 files, 1826 passed; domain 111 files, 1540 passed and 4 failed, the four receipt tests on `stock_reason_not_open` (X4); turbo stopped before web, so `pnpm --filter web test:security` ran on its own: 39 files, 461 passed. No full `pnpm lint`, `pnpm build` or `js-budget` yet: no screen or route is built.

**Blocker for the lead: a receipt's reversal.** `app.stock_move()` refuses to reverse a movement whose reason is not in `('opening', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'transfer')` (0231, kept by X4's redefinition), so `procurement.grn.reverse` is refused with `stock_reversal_not_allowed`. The ledger's own reversal is the right path (it takes the receipt's cost back out of the average, which an issue at the average would not). It needs `'receipt'` in that list, a body change I may not make. Either X4 (still open) or H2's body change could add it; my command, definer and tests are written for it. Without it, `procurement.grn.reverse` stays refused and its two tests fail. Also: a `reversal` needs `inventory.stock.adjust:entity` (H1's registry row), so a custom role with `procurement.grn.write` and not `inventory.stock.adjust` cannot reverse; the seed gives both to the same roles.

**What I add once X4 merges** (one migration of my own, after taking `main` in):
```sql
insert into app.stock_reason_grants (reason, permission, opened_by)
values ('receipt', 'procurement.grn.write:entity', 'u2-purchase-orders') on conflict (reason) do nothing;
insert into app.stock_reason_serial_moves (reason, direction, from_states, creates, to_state, opened_by)
values ('receipt', 'in', '{}', true, 'in_stock', 'u2-purchase-orders') on conflict (reason, direction) do nothing;
```
with its grant test.

**Decisions the brief did not settle.**
- Seven tables, not five: the two rate side tables are the house pattern (above).
- `drafted_by` is whoever last wrote the draft (the workers principal for an unedited reorder draft), so the Inventory Manager who fills a reorder draft's rates cannot approve it alone.
- "Executive" for the self-approval and limit rules is the role key `executive` (`app.role` in the guard).
- `procurement.po.approve` also requires `procurement.rate.read` (the approver weighs the total), and is agent-forbidden.
- A line's GST rate is resolved by the tax engine (item row, else HSN) when the line is written and stored as `tax_rate_id`/`tax_rate_pct`; with none in force the line has none and approval is refused (`po_lines_incomplete`), never a default rate. The supply is intra-state when the vendor's state equals the hub's state; an unregistered vendor (no state) is taken as within the state.
- Unit rates keep four decimals as quotes do; the amount rounds half-up to the paisa; the tax engine taxes each line's amount.
- Updating a draft's lines replaces them as a set; a line whose rate is left out keeps its item's previous rate only for a caller who reads rates (otherwise nothing is read and the rate is dropped).
- A rate filled from a quote takes the vendor's live quote on the IST day, the company's own before the group's, lowest first.
- Receiving needs the order `sent` or `partially_received`; one line per order line per receipt; no over-receipt; bins: receiving (default), storage or quarantine of the order's hub; quantities in the purchase unit, the ledger in stock units (`qty × unit_factor`); tracked items in whole units.
- A serial number the item already has (any company) is refused, so a serial of a reversed receipt cannot be received again until the lead decides otherwise.
- Reorder: free stock counts storage and receiving bins (goods received and not yet put away), on order counts draft to partially received; one draft per company, preferred vendor and hub; quantities rounded up to whole purchase units when a purchase unit holds several stock units; items without a preferred active vendor are counted, not drafted.
- Reorder rules need a writer, so `procurement.reorder_rule.set` and `.remove` (`procurement.po.write`) exist beside the brief's commands.
- Close is allowed from partially received or received, always with a reason; a receipt of a closed order cannot be reversed (the machine has no move).
- No `unmaskedFields` on receipt serials or invoice numbers (as H1's stock commands); a 12-digit serial with a valid Aadhaar check digit would be masked. Flagged, not changed.

**Not yet built (after the early check):** the notice to the Inventory Manager on a reorder draft and the daily and on-issue triggers (workers), the mailer and PDF for `send`, the queries and DTOs for the screens, the scan field, the purchase order PDF template, the screens and journeys, `EXPLAIN (ANALYZE)` evidence for the lists, docs/06-api.md.

**Shared registration points touched** (each under a U2 comment): permission catalogue and seed, `SYSTEM_MATRIX`, `WORKSHOP_DEFAULTS`, event catalogue, machine registry, testing lists, `en.json`. Migration redefinitions to recheck at the merge: `app.platform_only_permissions()` (H2 adds `inventory.reservations.process`), `app.next_document_no()` and `document_sequences_doc_type_check` (R3 adds `warranty_claim`).

## Review

## Integration
