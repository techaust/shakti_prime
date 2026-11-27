# U2 Purchase orders and goods receipt (wave 2)

| | |
|---|---|
| Branch | `feat/u2-purchase-orders` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): supplier rates, stock in, the moving average, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

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

## Review

## Integration
