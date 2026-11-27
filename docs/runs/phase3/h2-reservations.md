# H2 Reservations and availability (wave 2)

| | |
|---|---|
| Branch | `feat/h2-reservations` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): stock, the ledger's definers, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase3 §7.1](../../03-roadmap-appendix/phase3.md#71-h2-reservations-and-availability) as written, with questions 3 (a) and 4 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) for each table and [AGENTS §5](../../../AGENTS.md#5-domain-commands) for each command. Points the design leaves to you, settled here:

1. **ATP** (`packages/domain/src/stock/atp.ts`, pure): `itemAvailability`, `kitAvailability` (the floor of each component's free stock over its quantity per kit, naming the limiting component) and `lineAvailability` (`covered`, `partly_covered` or `short`, plus the expected date from open purchase quantities when they are passed in). Property tests run on generated kits and lines. Free stock is on-hand minus reserved, in storage bins only: never the `receiving`, `dispatch`, transit or quarantine bins.
2. **Table `reservations`** with the columns of §7.1 and the `reservation` machine (`active`, `picked`, `released`, `lapsed`) in `packages/domain/src/state-machines/machines/`. `stock_balances.qty_reserved` is kept only by `app.stock_reserve()` and `app.stock_unreserve()`, security definers locking in H1's fixed order. Reserved never exceeds on-hand per bin. `sales_order_lines.qty_backordered` is a new column (H2 owns that column only).
3. **`app.stock_move()` body:** H2 is the one wave 2 slice that changes it, and only for one rule. An outbound line (`adjust_loss`, `damage`, `count` loss, `transfer` out) may not take a bin's quantity below its `qty_reserved` (`stock_reserved_insufficient`, naming the item and bin). Build on X4's version when X4 has merged (take `main` in first). Otherwise build on 0231 and say so in the report; the lead re-bases the change at integration. Diff your redefinition against the latest one on `main` before you report.
4. **On confirmation:** `sales.order.confirm` (`packages/domain/src/commands/sales/confirm-order.ts`) reserves each line's free stock.
   - Hubs are taken in the order's preferred order: the hub whose PIN-code list holds the site's PIN first, else the default hub. That list is a new `warehouses.pin_codes text[]` column, empty by default, edited on the hub form.
   - A kit line reserves each component.
   - The short quantity becomes a backorder.
   - `sales.order.cancel` releases the order's reservations through the machine's `release_reservations`.
   - Keep the confirm command's existing tests green and add the reservation cases.
5. **Worker and jobs:**
   - `inventory.reservation.fill`, platform-only through `inventory.reservations.process` (add it to `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX` and SECURITY §3.3; redefine `app.platform_only_permissions()` with every key of `main`'s latest version). It runs on `inventory.stock.moved` when stock enters a storage bin and fills backorders of that item and company in order of confirmation.
   - A daily scan lapses reservations past `expires_at` and sends the reminder 2 days before (notification to the order's owner and the Inventory Manager). The defaults go in `WORKSHOP_DEFAULTS.stock`: a 15-day hold and the reminder 2 days before.
6. **Commands:** `inventory.reservation.extend` (once, with a reason: `inventory.stock.adjust`, or `sales.order.cancel` for the General Manager), `.release` (with a reason) and `.move` (to another hub's free stock). Each is audited with no cost, has its denied, wrong-company and happy-path tests, and its event.
7. **Availability on documents:** `app.line_availability(kind, id)` is a definer.
   - With `inventory.stock.read`, it answers the status and the quantities.
   - With only `sales.quote.create`, it answers the status and the expected date and never a count. The column holding a count is absent from that DTO, built without reading it.
   - The quote builder and the order page show it. The order page shows reserved, backordered and dispatched quantities per line (dispatched is 0 until D2).
   - A quote never reserves.
   - **The Lead Converter's grant** (owner, 27-11-2026, Q14): the Lead Converter no longer holds `inventory.stock.read`, and sees only the status, as question 4 (a) says. Take the grant off in the seed, the oracle and SECURITY §3.2 in this slice, and note it for the role editor's customised roles: `pnpm db:seed` gives a customised role only permissions newer than its customisation and removes none. The stock screens built in H1 then refuse a Lead Converter: check the access journey's expectations.
8. **Screens:** the availability column on the quote builder and the order page, the reservation list on the order page with Extend, Release and Move, and the backorders on the item's stock card. Journeys: the Inventory Manager (confirm, see the reservation, extend) and a Lead Converter (a status, no count), with axe and snapshots.

**Early check (Tier A):** once the table, the two definers, the `stock_move` rule, the confirm and cancel changes and their tests are committed (two concurrent confirmations of the last units reserve without overselling; the property test that `qty_reserved` equals the active reservations after random confirm, cancel, lapse and fill; the Lead Converter's DTO without counts), write a short report with the definers' signatures, push `report: h2-reservations early check` and stop.

Files owned: `packages/domain/src/stock/atp.ts`; the `reservations` table and its migrations; the `reservation` machine; `packages/domain/src/commands/inventory/reservations*.ts`; the reservation queries; `sales_order_lines.qty_backordered`; `warehouses.pin_codes` and the hub form's PIN field; the availability column of the quote builder and order page.

Do not touch: purchase orders and receipts (U2); counts (H3); labels (Q1); warranty (R3); the scan field (U2).

Review checklist: no count reaches a holder of only `sales.quote.create` (DTO, route, event, notification); reserved never exceeds on-hand; the lock order is H1's on every path; backorders fill in order of confirmation; a lapsed reservation's stock is free and the next backorder takes it.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: h2-reservations <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: h2-reservations blocked` with the question and stop.
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
