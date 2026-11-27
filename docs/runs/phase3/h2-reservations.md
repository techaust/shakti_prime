# H2 Reservations and availability (wave 2)

| | |
|---|---|
| Branch | `feat/h2-reservations` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): stock, the ledger's definers, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder Opus 5.5 at high: 14:20 UTC to the early check at 16:13 UTC, then from 16:30 UTC to done at 17:31 UTC; the fix round Opus 5.5 at high, 18:05 to 19:58 UTC |
| State | fixes done |
| Next step | the reviewer re-checks finding 1's fix; at integration, X4's `app.stock_move()` once it merges (one rule to carry over) |

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

### 27-11-2026, cloud (the lead's VM, worktree `h2-reservations`, port 54332): early check
Built on H1's `app.stock_move()` of 0231: X4 had not merged (`main` at `2d8be80`, last migration 0239). Skills loaded: `add-table`, `add-command`.

**What is built (schema, definers, commands and their tests):**
- Migrations `0240_h2_reservations` (generated) and `0241_h2_reservations_rls` (custom); the numbers follow 0239 and the lead renumbers them.
  - Tables `reservation_needs` and `reservations` (`packages/db/src/schema/reservations.ts`), row security forced, read by company with `inventory.stock.read:entity` (app_user and app_reader), no insert, update or delete grant for any request role.
  - `sales_order_lines.qty_backordered` (0 ≤ it ≤ `qty`; the insert policy holds it at 0; the append-only trigger, same name, now lets that one column change); `warehouses.pin_codes text[]` (six-digit codes, empty by default); `stock_balances_reserved_on_hand_check` (`qty_reserved <= qty_on_hand`).
  - `app.platform_only_permissions()` redefined with every key of 0222 plus `inventory.reservations.process`.
- `app.stock_move()` redefined with one rule: an outbound line may not leave its bin below `qty_reserved` (`stock_reserved_insufficient`, with the item, SKU, bin and bin code). Diffed against `main`'s latest (0231): the only changes are the `v_reserved` declaration, the balance read taking `qty_reserved` too, and the new check after `stock_insufficient`.
- The definers (all `security definer`, `search_path = ''`, revoked from `public` and `readonly_reporter`):

  | Signature | Who may call it | What it does |
  |---|---|---|
  | `app.stock_reserve(p_need uuid, p_qty numeric, p_hubs uuid[], p_whole boolean, p_expires_at timestamptz) returns numeric` | no request role (the entry points below) | takes up to `p_qty` (at most the need's backorder) from the free stock of the company's storage bins, hub by hub in the order given, the bin with most free first; one active reservation per bin; adds to `qty_reserved`; lowers the need's and the line's backorder; `p_whole` refuses a short take (`reservation_stock_short`) |
  | `app.stock_unreserve(p_ids uuid[], p_state text, p_kind text, p_reason text) returns table (reservation_id, sales_order_id, item_id, qty)` | no request role | ends each active reservation as `lapsed` or `released` (`by_hand`, `order_cancelled`, `moved`), takes it off `qty_reserved`, puts it back on order (behind the queue for a lapse or a release by hand; in place for a move; not at all for a cancellation) |
  | `app.reserve_order(p_order uuid, p_expires_at timestamptz) returns table (need_id, sales_order_line_id, item_id, qty_reserved, qty_backordered)` | `app.may_confirm_order()` on a confirmed order with no needs | confirmation's reservations |
  | `app.release_order_reservations(p_order uuid, p_reason text) returns integer` | `sales.order.cancel:entity`, on a cancelled order | the cancellation's release; nothing left backordered |
  | `app.fill_backorders(p_entity smallint, p_item uuid, p_expires_at timestamptz, p_limit integer) returns table (need_id, sales_order_id, qty_reserved)` | `inventory.reservations.process:all` | backorders of the item and company in queue order, each from its order's hubs |
  | `app.lapse_reservations(p_entity smallint, p_limit integer) returns table (reservation_id, sales_order_id, item_id)` | `inventory.reservations.process:all` | lapses what is past `expires_at` |
  | `app.reservation_reminders(p_entity smallint, p_before timestamptz, p_limit integer) returns table (reservation_id, sales_order_id, owner_id, expires_at)` | `inventory.reservations.process:all` | marks those due a reminder, once per reservation and extension |
  | `app.reservation_release(p_id uuid, p_reason text)`, `app.reservation_extend(p_id uuid, p_days integer, p_reason text) returns timestamptz`, `app.reservation_move(p_id uuid, p_hub uuid) returns uuid[]` | `inventory.stock.adjust:entity` (the extension also `sales.order.cancel:entity`) | a person's change, the order locked first |
  | `app.line_availability(p_kind text, p_id uuid) returns table (line_id, line_position, status, expected_on, qty_free, qty_reserved, qty_backordered)` | `inventory.stock.read:entity` (with quantities), or `sales.quote.create` with the lead's (or a dealer's order's customer's) read scope (quantities null) | availability per line; app_user and app_reader |
  | `app.stock_lock_free()`, `app.sync_line_backorders()`, `app.order_hubs()`, `app.reservation_for_change()` | no request role | the lock in H1's order over an item's storage balances, a line's backorder from its needs, an order's hubs, a reservation's order locked first |
- The lock order on every path: the sales orders touched (a person's command holds its order `for update`; the fill and the lapse take theirs `for share`, by id), then H1's order (hubs `for share` by id, bins `for share` by id, balances `for update` by company, hub, bin, item), then needs and reservations, then the order lines.
- `sales.order.confirm` reserves through `app.reserve_order()` (the `reservation` machine's `reserve`, then the sales order machine's `request_reservations`); the answer and the audit row carry no quantity. `sales.order.cancel` of a confirmed order releases through `app.release_order_reservations()` (`order_cancel`). The confirm suite's cleanup removes its orders' needs.
- Commands `inventory.reservation.extend` (`PermissionByInput`: `authority: 'stock'` → `inventory.stock.adjust:entity`, `'order'` → `sales.order.cancel:entity`), `.release`, `.move` (people only), and the platform's `inventory.reservation.fill` and `.scan` (`inventory.reservations.process:all`); events `inventory.reservation.filled`, `.extended`, `.released`, `.moved`, `.lapsed`, `.expiring` (ids and dates only, `subscribed: false` until the workers).
- The `reservation` machine (`docs/state-machines/reservation.md`), in `MACHINES_IN_USE`.
- `packages/domain/src/stock/atp.ts` (pure: `itemAvailability`, `kitAvailability`, `lineAvailability`, thousandths), `stock/reserve.ts` (the definer calls), `queries/inventory/availability.ts` (`readLineAvailability`: two DTOs; the one without counts is selected without naming the count columns).
- `WORKSHOP_DEFAULTS.stock.reservationHoldDays` 15 and `.reservationReminderDays` 2; `inventory.reservations.process` in the catalogue, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, the seed and SECURITY §3.1 to §3.3; the Lead Converter's `inventory.stock.read` taken off in the seed (the oracle) and SECURITY §3.2, with the note for customised roles in SECURITY §4.
- The testing lists (`ENTITY_TABLES`, a fixture row per company, the role × company rule, `NARROWER`, `enum-sync`), the reader definer list, the agent refusal sweep's people-only inputs, the audit labels and event names in `apps/web` and `en.json`, the error sentences, DATABASE §4.1 and §6.5, `pnpm db:docs` and `machines:docs` regenerated.

**Tests added:**
- `packages/domain/src/stock/atp.test.ts` (8, three of them property tests on generated balances, kits and lines); `state-machines/machines/reservation.test.ts` (3) and the machine's fixture in `machines.test.ts`.
- `packages/domain/tests/commands/reservations.test.ts` (16): confirmation reserves the PIN code's hub first, a kit by its components, the short backordered, nothing for a service, never from a receiving bin; a second confirmation refused; the Lead Converter's availability in the shape with no count and the Inventory Manager's with counts; a Field Engineer refused; the cancellation's release; `stock_reserved_insufficient` on a loss and a transfer; extend, release and move each denied, wrong company and happy path (extend once, by the Inventory Manager and the General Manager; move refused when short and to the same hub); the jobs refused to every person and outside the request; the fill in order of confirmation; a lapse whose stock the next backorder takes, the lapsed order waiting behind; the reminder once to the order's owner.
- `packages/domain/tests/stock/reservations-concurrency.test.ts` (4): two confirmations of the last unit (one reserves, the other waits and backorders), three orders confirmed at once through the command, a loss racing a confirmation both ways.
- `packages/domain/tests/stock/reservations-property.test.ts` (1, 60 seeded steps of confirm, cancel, lapse, release, gain, loss and fill): `qty_reserved` equals the active reservations and never exceeds on hand; a need is its reservations plus its backorder; a cancelled order holds and waits for nothing; each line's backorder is what its needs leave; after the fill no backorder waits beside free stock.
- `packages/db/tests/security/reservations.test.ts` (15): no write by any request role; the reserved and backorder checks for the table owner; the lines append-only but for the backorder; the six helpers not callable; each entry point's grant; the platform-only key held by `system:workers` alone and the three jobs refused to every staff and agent role and outside the request; availability refused without either grant.

**Checks run (this worktree, its Postgres on 54332, through `heavy.sh`):**
- `pnpm --filter @shakti/contracts --filter @shakti/db --filter @shakti/domain --filter web typecheck`: exit 0.
- `pnpm exec eslint --max-warnings 0` over `packages/contracts/src`, `packages/db/src`, `packages/db/tests`, `packages/db/seeds`, `packages/domain/src`, `packages/domain/tests`, `apps/web/src/screens`, `apps/web/src/components/activity`: exit 0.
- Unit tests: `@shakti/contracts` 340 passed, `@shakti/db` 162 passed, `@shakti/domain` 112 files, 2872 passed (after two fixes: the workshop defaults' approved values and the fill's wrong-company case); `web` 1241 passed, 1 skipped.
- `pnpm copy-lint`: exit 0.
- `pnpm test:security`: `@shakti/db` 63 files, 1808 tests passed; `@shakti/domain` 1539 passed, 1 failed (the reader parity list lacked `readLineAvailability`), fixed and rerun alone: 8 passed; the `web` suite, which turbo skipped after that failure, run alone (`pnpm --filter web test:security`): 39 files, 461 passed.
- `pnpm db:docs`, `pnpm --filter @shakti/domain machines:docs`: regenerated and committed.
- Not run yet: `pnpm build`, `js-budget`, the whole-repository `pnpm lint`, journeys (no screen yet).

**EXPLAIN:** no list or search yet; the backorder queue (`reservation_needs_queue_idx`), the lapse scan (`reservations_expiry_idx`) and the stock card's backorders get their plans at volume with the screens.

**Decisions the brief did not settle:**
1. **A table `reservation_needs`** beside `reservations`: what each confirmed line needs of each item (a kit's components at the kit's quantities when the order was confirmed, so a later kit edit leaves a sold order as it was), its backorder, and its place in the queue (`queued_at`). `sales_order_lines.qty_backordered` is derived from it (a kit line: the kits not yet wholly reserved).
2. **`reservations.bin_id`** besides `warehouse_id`: a reservation is a quantity in one storage bin, so each bin's `qty_reserved` is exactly its active reservations and a move between bins of a hub is refused rather than silently under-reserving.
3. **The default hub:** the data has none, so the hubs whose `pin_codes` list the site's PIN come first, then every other godown and factory by code, until the client names which hub serves which districts (§12 question 5). A `warehouses.is_default` flag is one column if the lead prefers it.
4. **A lapse or a release by hand re-queues the quantity at the back** (`queued_at` = now), so "the next backorder takes it"; a move keeps its place; a cancellation clears it.
5. **The fill is its own transaction**, run on the event that freed or brought stock (stock into a storage bin, a lapse, a release, a move), never inside the scan, so each transaction takes its locks in the one order.
6. **Quantities are reserved, not serials:** the `serial` machine's `reserve` stays proposed; D2 picks serials against a reservation.
7. **The extension's two grants** are one command with `authority: 'stock' | 'order'` in the input (`PermissionByInput`), since a command declares one permission; the definer accepts either grant.
8. **Availability's visibility** for a holder of only `sales.quote.create` mirrors the read policies (the lead's `crm.lead.read` scope, or a dealer's order's customer's `crm.account.read` scope); a holder of `inventory.stock.read:entity` reads any document of the company with counts. A kit line counts whole kits; a line with nothing stocked and a cancelled order answer no row; `expected_on` is null until U2.
9. **No quantity in `SalesOrderDto`**: the order page's reserved, backordered and dispatched quantities come with the screens, from a query gated on `inventory.stock.read`.
10. **Cascading foreign keys** from needs and reservations to the order and its lines, since the suites delete orders (no request role can).
11. **An opening-stock rollback** over a bin that holds reserved stock is refused (`stock_reserved_insufficient`) until the holds are released or moved.

**Unfinished, for the next lane:** the workers (the `inventory.stock.moved` subscription and the freed-stock events to `inventory.reservation.fill`; the daily scan's schedule; the notification of `inventory.reservation.expiring` to the order's owner and the Inventory Manager); a cancelled order's freed stock to the fill (the cancel emits no reservation event yet); the hub form's PIN codes and `inventory.hub.create`/`.update` taking them; the screens (availability on the quote builder and the order page, the order page's reservations with Extend, Release and Move, backorders on the stock card); journeys; EXPLAIN; phase3.md's Built record.

### 27-11-2026, cloud (the lead's VM, worktree `h2-reservations`, port 54332): done
The early check was accepted with decisions 1 to 11 (the lead, 16:30 UTC). `main` taken in at `59736c7` (documents only). **X4 has not merged** (`main`'s last migration is still 0239), so the one `app.stock_move()` rule stays on H1's 0231 body: compared with 0231, the redefinition in `0241_h2_reservations_rls` changes only the `v_reserved` declaration, the balance read taking `qty_reserved` too, and the `stock_reserved_insufficient` check after `stock_insufficient`. When X4 merges, that check goes into X4's body at the same place (pass 2, the bin a line leaves), and the reason grants and serial rows X4 moved into tables stay untouched.

**Built since the early check:**
- **The cancellation's freed stock:** `app.release_order_reservations()` now answers each released reservation with its item, and `sales.order.cancel` emits `inventory.reservation.released` for each (added to the event's `emittedBy`).
- **The fill worker** (`apps/web/src/workers/reservations/fill-event.ts`): `inventory.stock.moved` (the items moved into a bin) and `inventory.reservation.released`, `.moved` and `.lapsed` run `inventory.reservation.fill` as `system:workers` of the event's company, in its own transaction. The five types are now `subscribed: true`.
- **The reminder notice:** `reservation_expiring` (`NOTICE_TYPES`, migration `0242_h2_reservation_notice` widening both type checks `NOT VALID`); `inventory.reservation.expiring` goes to the notify route. `app.notice_reservation_people()` tells the order's owner and every active Inventory Manager of the company while the order is open. The link opens the order.
- **The daily scan** (`/workers/reservations/scan`, schedule `reservation-scan` at 18:50 UTC, `ReservationScanWorkerBody` and `...Response`, `apps/web/src/workers/reservation-scan.ts`):
  - per company, `inventory.reservation.scan` batch by batch;
  - then a catch-up `inventory.reservation.fill` over `app.backordered_items()`, so a fill an event missed (more than 200 movements in a batch, a delivery lost for good) happens the same day.
- **The hub's PIN codes:** `pinCodes` on `inventory.hub.create` (default none) and `.update` (left out, kept), checked as six-digit codes, each once, at most 2,000; on `HubDto`; audited (`hubPinCodes`); the hub form's "PIN codes this hub serves first" field (not for the transit hub).
- **Availability:** `app.free_availability()` is the one implementation behind `app.line_availability()` and `app.preview_availability()`, the quote builder's lines before save (at most 200). `app.line_availability()` also answers the dispatched quantity of a confirmed order's lines (0 until D2). The queries are `readLineAvailability` and `previewLineAvailability`. Each answers in two shapes; the shape for a holder of only `sales.quote.create` is selected without the count columns.
- **Lists:** `listReservations` (an order's or an item's active holds) and `listItemBackorders` (an item's backorders in queue order). Both need `inventory.stock.read` for the company and read through row security; the order's number and line show only when the reader may read the order.
- **Screens:**
  - A Stock column on the quote builder's worked-out lines, the quote page and the order page (`QuoteLinesTable` takes an optional `availability`). It shows "In stock", "Partly in stock" or "Out of stock" ("On order" with the expected date once purchase orders exist). A reader of stock also sees free stock, or held, waiting and dispatched quantities.
  - The order page's "Stock held for orders", loaded after the page, and the same panel on the item's stock card, with Extend (the Inventory Manager's or the General Manager's grant), Move and Release for `inventory.stock.adjust`.
  - The stock card's "Orders waiting for this item".
  - The order page reads again after a confirmation or a cancellation, so its stock shows at once.
  - The copy is in a namespace of its own (`holds`), sent with `/orders`, `/quotes`, `/converting` and `/inventory`.
- **Server actions** in `apps/web/src/actions/reservations.ts`.
- **Journeys** in `apps/web/e2e/reservations.spec.ts`, seeded by `e2e/setup/reservations.ts`, all with axe checks:
  - the General Manager confirms an order, its stock is held and each line shows what it holds;
  - the Inventory Manager finds a hold on the item's stock card and extends it once;
  - a Lead Converter reads an order's lines (a status, no count) and finds `/inventory/stock` closed.
  - Three element snapshots: `reservations-order-holds`, `reservations-extend-dialog` and `reservations-converter-lines`.
- **Docs:**
  - phase3.md §7.1's Built (H2) record;
  - DATABASE §4.1 and §6.5 (the new definers, `pin_codes`, `release_order_reservations()`'s answer);
  - SECURITY §3.3 (the scan's definers and the reminder);
  - API §3.6 (the scan route), ARCHITECTURE §6 (the schedule);
  - `db:docs` and `machines:docs` regenerated.

**Tests added since the early check:**
- **Domain:**
  - `reservations.test.ts`, now 21 cases: the two list queries (a Lead Converter and another company refused), the builder's preview (a status for the Lead Converter, the free stock for the Inventory Manager, a Field Engineer refused), the reminder notice (the owner and the company's Inventory Manager once, not another company's, a person refused), the cancellation's freed holds sent to the fill, and the hub's PIN codes (kept, left alone, cleared, refused).
  - `reader-parity.test.ts`, which covers `listReservations` and `listItemBackorders`.
- **Web:**
  - `src/workers/reservations/fill-event.test.ts` (3: the items of each event);
  - `tests/reservation-scan.test.ts` (6: the route's refusals, a signed run done, a run out of time);
  - `check-ins.test.ts` and `qstash-schedules.test.ts` with the new schedule, `qstash.test.ts` with the new notifying event.
- **Database:** `grants.test.ts` (`app.preview_availability()` among the reader's definers); the data docs test now names `surplus_pool` and `dispatch_lines` as the planned tables, since `reservations` is built.

**Checks run (through `heavy.sh`, this worktree's Postgres on 54332):**
- `pnpm --filter @shakti/contracts --filter @shakti/db --filter @shakti/domain --filter web typecheck`: exit 0.
- `pnpm lint` (the whole repository, the final check): exit 0.
- Unit tests:
  - contracts 340, db 162 and domain 2872, all passed;
  - web 1245 with 1 skipped, the rest passed after the namespace, unused-key and schedule-count fixes.
- `pnpm copy-lint`: exit 0. New button keys registered: `extend`, `extendSubmit`, `releaseSubmit`.
- `pnpm --filter web build`: exit 0. `pnpm --filter web js-budget`: every page within its budget (65 pages), once the order page's hold panel loads after the page.
- `pnpm test:security`, in one go: db 63 files, 1807 passed and 1 failed; turbo then stopped. I ran the domain and web suites after it:
  - domain: 113 files, 1545 passed;
  - web: 40 files, 465 passed and 2 failed.

  None of the three failures comes from H2:
  - `alert-counts.test.ts`: its fixed `agent_configs` row for the Co-pilot in company 3 met the one the journeys' seed wrote at 17:04 on this database.
  - `demo-data.test.ts`: the retail list now holds more than the 200 prices the test reads, after the journeys' and suites' items. It also fails alone.
  - `outbox-route.test.ts` (the current key): another file's publisher took its row. It passes alone (12 tests).

  On a fresh database, as CI runs it, none of the three meets another suite's or the journeys' rows. I could not recreate the database here (no `fresh-db.sh` in a builder lane).
- Journeys (`pnpm --filter web e2e:seed`, then `playwright test reservations.spec.ts inventory.spec.ts orders.spec.ts quotes.spec.ts --ignore-snapshots`, the app on 3032): **77 passed, 1 failed**. All nine reservation runs passed (three tests on desktop light, desktop dark and phone). The orders and quotes journeys passed with the new column.
  - The failure is H1's Executive stock journey on the phone: it timed out on `/inventory/hubs`, which on this used database lists hundreds of hubs the security suites made. The two desktop runs passed.
  - Screenshots were ignored; the Linux baselines for the three new snapshots (and the order and quote screens, which now carry the Stock column) are the lead's at integration.
- EXPLAIN (ANALYZE, BUFFERS), from `pnpm --filter @shakti/domain exec tsx tests/spike/reservations-explain.ts`. It writes 2,000 items, 50 bins, 10,000 confirmed orders, 20,000 needs and 20,000 reservations in company 1, in 4.0 s, then removes them.

  | Read | Index used | Time |
  |---|---|---|
  | The stock card's holds of an item, under row security as an Inventory Manager | `reservations_item_idx` | 2.8 ms |
  | The order page's holds | `reservations_order_idx` | 1.3 ms |
  | The stock card's backorders | `reservation_needs_item_idx` | 1.1 ms |
  | The fill's queue (inside `app.fill_backorders()`) | `reservation_needs_item_idx`, then the orders by key | 0.33 ms |
  | The lapse (inside `app.lapse_reservations()`) | `reservations_expiry_idx` | 0.04 ms |
  | The reminder (inside `app.reservation_reminders()`) | `reservations_expiry_idx` | 0.03 ms |
  | The daily items waited for (inside `app.backordered_items()`) | a hash join over the company's needs, once a night | 11.1 ms |
  | `app.line_availability()` of a confirmed order | | 5.5 ms |

**For the lead and the owner:**
- Migrations `0240_h2_reservations`, `0241_h2_reservations_rls` and `0242_h2_reservation_notice` follow 0239. Renumber them after X4 and the other wave-2 slices, and re-apply the `app.stock_move()` rule onto X4's body (above).
- The hosted environments need the QStash schedule `reservation-scan-<environment>` ([DEPLOY §1](../../runbooks/deploy.md) step 6) once this is on them. The five newly subscribed event types (`inventory.stock.moved` and `inventory.reservation.released`, `.moved`, `.lapsed`, `.expiring`) need their URL groups `evt-<type>` as every subscribed type does; `inventory.reservation.expiring` goes to the notify route.
- A customised Lead Converter role keeps `inventory.stock.read` until an Executive takes it off in Admin › Roles (SECURITY §4).

**Decisions taken since the early check, which the brief did not settle:**
1. **The reminder** goes to the company's people whose role is the Inventory Manager's (by role key, so the Executive, who holds every grant, is not told of every hold), and to the order's owner: the lead's owner, or the maker of an order without a lead.
2. **The cancellation emits `inventory.reservation.released`**, one per freed hold, rather than a new event type.
3. **The daily scan also fills** every item open orders wait for, so the fill never depends on one event's delivery.
4. **The availability column** shows "Out of stock" for a short line until purchase orders give it a date; then it shows "On order" with the date.
5. **The builder's preview** is a definer of its own (`app.preview_availability()`) on the lines as typed, since the quote has no id yet.
6. **A held line's quantities** come from `app.line_availability()`; the dispatched quantity is 0 until D2 changes that definer.

### 27-11-2026, cloud (seat worktree `h2-reservations`, Postgres on 54335): fixes
All nine findings, as the lead's triage says. Finding 1 first. Skills loaded: none new (the round adds no table and no command).

**Finding 1 (high): one item a fill.**
- `FillBackordersInput` now takes one `itemId`.
- `inventory.reservation.fill` runs one `app.fill_backorders()` call. `handleFillEvent()` and the daily scan's catch-up call the command once per item, each in its own transaction.
- `app.fill_backorders()` locks in the one order: the waiting orders (`for share`, by id), then H1's hubs, bins and balances of the item, then the item's needs of those orders (by id), then their lines (by id). Two fills of items that share a kit line therefore meet the lines in one order.
- The 0241 header and phase3.md's Built record now say this.
- Tests in `reservations-concurrency.test.ts`:
  - two fills of items sharing orders and kit lines, each item's queue in the opposite order, run side by side; the second waits on the first and both reserve;
  - the review's scenario: a fill of x is held while a cancellation of an order holding x and waiting for y waits on it, and a fill of y queues behind the cancellation; all three commit, with no 40P01.
- `fill-event.test.ts`: the worker calls the command once per item.

**Finding 2: a need put back on order takes only stock that arrives after it.**
- New column `reservation_needs.requeued_at`: null for a need queued at confirmation; set by `app.stock_unreserve()` for a lapse or a release by hand; kept for a move.
- For such a need, `app.fill_backorders()` caps the take at the stock that entered a storage bin after `requeued_at`, less what the need took since. That stock is a movement into a storage bin from no bin or from a bin that is not a storage bin: a receipt put away, a gain, a transfer in through transit. The fill then goes on to the next need rather than stopping.
- The column is folded into `0240_h2_reservations.sql` and its three snapshots (`db:generate` reports no change). `db:docs` is regenerated.
- Copy:
  - the release dialog: "…free for other orders, or to write off. This order then waits … for stock that arrives after now";
  - the order's hold panel intro;
  - the reminder push text: "The order would then wait for new stock".
- Tests (`reservations.test.ts`):
  - the fill test now shows the lapsed order waiting while the stock its lapse freed stays free, then taking exactly the one unit of a later receipt;
  - new: a lone order's lapsed hold stays free and the next receipt fills it again; a hold released by hand is written off as damage after the fill ran.
- The property test's rule is now "no backorder queued at confirmation waits beside free stock". A new rule: a requeued need holds no more than what arrived after it.

**Finding 3: the SQL agrees with atp.ts, which stays the specification.**
- `atp.ts`:
  - `BalanceFacts` gains `hubKind` and `inUse`. `itemAvailability()` counts only storage bins in use of godowns and factories in use. That was the SQL's rule; the old spec counted every storage bin.
  - New `documentAvailability()`. A line with nothing kept in stock answers null, where the old spec answered `Infinity` kits. Demand is summed exactly, in millionths.
- `app.line_availability()` for a confirmed order now takes a line's status from the line itself: `qty_backordered` 0 is covered, `qty_backordered` ≥ `qty` is short, anything else partly. That is `lineAvailability(qty, qty − backordered)` over whole kits. Before, a kit line holding some components but no whole kit answered "partly covered"; it now answers "short".
- New `packages/domain/tests/stock/atp-parity.test.ts` (2 tests) uses real bins of every kind, an archived bin, an archived hub and a transit hub:
  - 60 generated documents (balances, kits with stocked and unstocked parts, item and kit lines with repeats) through `app.free_availability()` (as the table owner, with and without counts) and through `documentAvailability()`: the same rows, statuses and free quantities;
  - 8 generated confirmed orders: each line's status equals `lineAvailability()` of what it holds.
- The property test computes a kit line's backorder with `kitAvailability()`.

**Finding 4: the document is measured as a whole.**
- `app.free_availability()` sums each item's demand over every line that takes it, a kit's components included.
  - A line is covered when the free stock meets every item it takes.
  - Otherwise it is partly covered when some of its item is free (for a kit, one whole kit), else short.
  - Every line of an item answers alike, so the order of lines and repeated items tell nothing.
- Lines are keyed by their place in the input, so two preview lines with one position no longer merge.
- This applies to the builder's preview and to a saved quote or draft order alike: one implementation.
- Tests: `atp.test.ts` (alike whatever the order and repeats, on 1,000 generated documents) and `reservations.test.ts` (a Lead Converter's preview of 5 against 6 free, of 5 + 5, and of a 1-to-10 ladder in both orders).
- SECURITY §4 says what remains: a status still answers one question a call.

**Finding 5: missing balance rows are inserted before the locks.**
- New `app.stock_free_rows(entity, items, hubs)` inserts the empty balance row of each item in each storage bin in use of the hubs, in (company, hub, bin, item) order, as H1's definer does. It runs after the hubs and bins are locked and before the balances are, from `app.stock_lock_free()` and from `app.reservation_move()` (the new hub).
- `stockRefusal()` maps `stock_balances_reserved_on_hand_check` to `reservation_stock_short` (a conflict).
- Test: `src/stock/move.test.ts` (3).
- The cost: a balance row per storage bin per item ever reserved. The stock screens already leave out rows with nothing on hand or held.

**Finding 6:** the concurrency tests hold the first transaction open, its locks taken, until `pg_stat_activity` shows the second waiting on it (`holding()` and `waitUntilBlockedBy()`: 50 ms polls, 10 s at most). No fixed pause is left.

**Finding 7:** `inventory.reservation.fill` (`{ entityId, itemId }`) and `.scan` are in the agent sweep's platform jobs.

**Finding 8:** SECURITY §4 names the Lead Converter and the Sales Team Lead, and adds how a document is measured.

**Finding 9: orders confirmed before the migration get their needs.**
- New `app.backfill_order_needs(orders)`, callable by no request role. 0241 runs it once with null, meaning every confirmed order with no needs.
- It writes each order's needs as `app.reserve_order()` would, all backordered and queued at the order's confirmation, and syncs the lines' backorders. It reserves nothing: the first fill does that (the next stock event, or that night's catch-up through `app.backordered_items()`).
- Test: an order marked confirmed three days ago gets three needs queued at its confirmation, no reservation and backorders 2, 1 and 0. A second run changes nothing. The fill then reserves the free unit.

**Tests added or changed this round:**
- Domain unit tests: `atp.test.ts` 12 (+4), `move.test.ts` 3 (new); `@shakti/domain` src now 113 files, 2879 passed.
- Web unit: `fill-event.test.ts` 5 (+2).
- Domain suites:
  - `reservations.test.ts` 24 (+3);
  - `reservations-concurrency.test.ts` 6 (+2, the four races rewritten);
  - `reservations-property.test.ts` 1, with two rules changed and one added;
  - `atp-parity.test.ts` 2 (new);
  - `agent-refusals.test.ts`: two platform jobs more.
- Database suite: `reservations.test.ts` 18 (+3: `app.stock_free_rows`, `app.backfill_order_needs` and `app.free_availability` not callable).

**Checks run** (through `heavy.sh`, this worktree's Postgres on 54335, migrated and seeded fresh at the start):
- `pnpm typecheck` (whole repository): 10 tasks successful.
- `pnpm lint` (whole repository, the final check): exit 0.
- Folder lints: `packages/contracts/src`, `packages/db/src`, `packages/db/tests`, `packages/domain/src`, `packages/domain/tests` and `apps/web/src/workers`, exit 0.
- Unit tests: domain 2879 passed; web `src/workers/reservations` 5 passed.
- `pnpm copy-lint`: clean.
- `pnpm db:generate`: no schema changes. `pnpm db:docs`: regenerated and committed.
- `pnpm test:security`:
  - db: 63 files, 1811 passed;
  - domain: 114 files, 1552 passed;
  - web: 40 files, 466 passed and 1 failed.

  The failure is `demo-data.test.ts`, which reads the first 200 active items by name. This database holds 225 items that sort before the demo pump. None came from the seed. One full suite run made 143 of them; the other 82 came from my earlier runs of single files, this round's own repeats. On a fresh database, as CI runs it, one run leaves about 143 plus the demo's 9, under 200. The new parity file archives its 5 items when it ends.
- `pnpm --filter web build`: exit 0. `pnpm --filter web js-budget`: every page within its budget (65 pages).
- Journeys: not run (no sign-in on a seat). The copy change touches `reservations-order-holds`'s text, and the release dialog has no snapshot.

**The local database and the edited migration.** 0240 to 0242 are not on `main`, so the round edits them in place.
- My slot's database applied 0241 at `7c2c7dfa`. The later edit (the backfill as a function) was applied with a script that re-runs 0241's `create or replace function`, `revoke` and `grant` statements.
- I then set `drizzle.__drizzle_migrations`' hash of 0241 to the file's new SHA-256, so `assertAllApplied()` accepts it.
- The only difference left between this database and a fresh one is the backfill's `select`, a no-op on a database with no confirmed orders.
- A fresh database at integration runs it all from the files.

**EXPLAIN (ANALYZE, BUFFERS)** (`tests/spike/reservations-explain.ts`, extended: 2,000 items, 50 bins, 10,000 orders, 20,000 needs and 20,000 holds in 3.7 s, all removed after):

| Read | Index used | Time |
|---|---|---|
| The stock card's holds of an item, as an Inventory Manager | `reservations_item_idx` | 2.6 ms |
| The order page's holds | `reservations_order_idx` | 1.2 ms |
| The stock card's backorders | `reservation_needs_item_idx` | 0.75 ms |
| The fill's queue | as before | 0.25 ms |
| The fill's count of stock that arrived after a requeue, over 200,000 movements written and rolled back | `stock_movements_card_idx` (company, item, moved since) | 0.10 ms |
| The lapse / the reminder | `reservations_expiry_idx` | 0.05 / 0.03 ms |
| `app.backordered_items()` | a hash join, once a night | 10.2 ms |
| `app.line_availability()` of a confirmed order | | 6.7 ms |
| `app.preview_availability()` of 200 lines, the document as a whole | | 13.1 ms |

**Decisions this round took that the triage did not settle:**
1. **Arrival** is a movement into a storage bin from no bin or from a non-storage bin. A shuffle between storage bins never lets a requeued need take its own freed stock.
2. **A requeued need's cap** is what arrived since `requeued_at` less what its line took since. The take is counted as active or picked holds made after `requeued_at`, so a move does not count against it.
3. **The fill locks the needs and lines up front** (by id) after the balances, so two fills never meet two lines in opposite orders.
4. **`documentAvailability()`'s "partly" for a kit line** means the free stock makes one whole kit. For an item line it means some is free, as before.
5. **The backfill is a definer** (`app.backfill_order_needs()`), so the suite can test it on one order. The migration runs it for all.
6. **The release by hand** follows the same rule as a lapse (the triage names both).

**Open, for the lead:**
- Only the backfill's migration-time run is untested: the test calls the function, not the migration. On hosted data it runs inside the migration's transaction, with confirmed orders locked `for update`.
- Journeys and the Linux baselines are as before: for the lead at integration.

## Review

### 27-11-2026, cloud (worktree `h2-reservations`, Postgres on 54331): slice-reviewer, Tier A
Reviewed `git diff origin/main...feat/h2-reservations` at `f2557d8` (`main` at `59736c7`; X4 not merged, `main`'s last migration 0239). **Verdict: one high finding blocks the merge; the rest are follow-ups.**

| # | Severity | Where | What is wrong, and how it fails | Fix | Status |
|---|---|---|---|---|---|
| 1 | high | `packages/domain/src/commands/inventory/reservations-jobs.ts:51` (the item loop), `apps/web/src/workers/reservations/fill-event.ts:56`, `apps/web/src/workers/reservation-scan.ts:78`; `0241_h2_reservations_rls.sql:903-919` | **The fill breaks the lock order across items.** `inventory.reservation.fill` takes up to 200 items in one transaction and calls `app.fill_backorders()` once per item, so the second item's orders are locked `for share` while the first item's balances are already held `for update`: balances before orders. Scenario: the fill runs items X then Y and holds X's balances; a General Manager cancels order B (which waits for Y and holds X), so `sales.order.cancel` holds B `for update` and waits for X's balances in `app.stock_unreserve()`; the fill then waits for B. Postgres ends one of them (40P01): the cancellation fails as a conflict, or the fill is retried. The same cycle comes from a release or move of B's hold of X, and between two fills through a kit line's `sync_line_backorders()` update. The scan's catch-up fill (200 items a transaction, every night) widens the window, and holds 200 items' balances for the whole transaction, blocking stock movements of them. The Built record (`phase3.md` line 187) and the 0241 header say every path takes its orders first, which is not so here. | Run one item per transaction (the event worker and the scan call the command per item), or give `app.fill_backorders()` the item array and lock every item's orders first, then `app.stock_lock_free()` over all the items, then fill. Add a concurrency test: a two-item fill beside a cancellation of an order holding the first item and waiting for the second. | confirmed (code path read end to end) |
| 2 | medium | `0241_h2_reservations_rls.sql:736-741` (`stock_unreserve()` puts a lapsed or released hold back on order), `apps/web/src/workers/events/registry.ts` (`.released` and `.lapsed` run the fill), `reservation-scan.ts` (the catch-up fill after the lapse) | **A hold never really ends when no other order waits.** A lapse or a release by hand puts the quantity back on order at the back of the queue, and the fill that follows (the event, or the same night's catch-up) gives the stock straight back to the same order when nothing else waits: a new reservation with a fresh 15-day hold, no extension recorded and a new reminder due. So the 15-day hold, the "extend once" rule and the reminder ("released soon unless someone extends the hold") mean nothing for an uncontested item, and Release frees stock only for another order: an Inventory Manager who releases a hold to write off damaged stock races the fill and loses within seconds (`stock_reserved_insufficient`). The design's "the backorder returns" and decision 4 allow this reading; its effect was not stated. | A decision for the lead and the owner: e.g. a need whose hold lapsed or was released by hand is not filled again until a person asks, or a lapse ends the need. At least make the reminder and the release dialog say what happens. | confirmed (code path; `reservations.test.ts:578` shows the lapsed order taking the stock left) |
| 3 | medium | `packages/domain/src/stock/atp.ts` (no caller outside its test); `0241_h2_reservations_rls.sql:1198-1242` (`app.free_availability()`) | **The tested ATP is not the one in use.** `itemAvailability`, `kitAvailability` and `lineAvailability` are imported by nothing but `atp.test.ts`; every status users see comes from `app.free_availability()`, a separate SQL copy with no generated-case test. The two already differ: the SQL leaves out archived and transit hubs and archived bins, `atp.ts` counts every storage bin; a kit with no stocked component is no row in SQL and `Infinity` kits in `atp.ts`. The brief's property tests on generated kits and lines, and the deterministic-core rule (CLAUDE.md), hold only for the unused copy. | A parity test: generated balances, kits and lines through both `atp.ts` and `app.free_availability()` (as the table owner), statuses equal; or compute the status from `atp.ts`. | confirmed |
| 4 | low | `0241_h2_reservations_rls.sql:1349-1370` (`app.preview_availability()`), `quote-builder.tsx` | **A status per line is a count for a curious Lead Converter.** The preview answers up to 200 lines, each against the whole free stock, so one call with the same item at quantities 1 to 200 (or the builder with the same item on several lines) shows "In stock" up to the free count and "Partly in stock" after it. The same per-line measure shows two lines of 5 with 6 free both "In stock". It is inherent in question 4 (a): a few previews by hand find the count anyway. | For the owner to know. Measuring an item's lines together and refusing a repeated item in the preview narrows it; nothing closes it while a status answers a quantity. | confirmed |
| 5 | low | `0241_h2_reservations_rls.sql:553-567, 643-662`; `packages/domain/src/stock/move.ts` (`REFUSALS`) | `app.stock_lock_free()` locks only the balance rows that exist. A balance row that a concurrent first gain creates after that step is read by `stock_reserve()`'s loop without its lock; a second reserver, or a loss, on it makes the `qty_reserved` update fail `stock_balances_reserved_on_hand_check`, which `stockRefusal()` does not map, so the confirmation fails as an internal error. No oversell (the check holds). | Map `stock_balances_reserved_on_hand_check` to a conflict reason (e.g. `reservation_stock_short`). | plausible |
| 6 | low | `packages/domain/tests/stock/reservations-concurrency.test.ts:39, 101, 131, 154` | The races rest on `pause(100)` for the first transaction to hold its locks. On a slow runner the second goes first and the test fails (it cannot pass wrongly). | Wait until `pg_stat_activity` shows the first session in `pg_sleep` (or the second waiting on a lock) instead of a fixed pause. | confirmed |
| 7 | low | `packages/domain/tests/security/agent-refusals.test.ts:927` (`CHECKS`) | The platform's `inventory.reservation.fill` and `.scan` are not in the agent sweep of platform jobs, where every other platform job is. Agents hold no platform-only key (asserted at line 1087), so nothing leaks today. | Add `'inventory.reservation.fill': { entityId: 1, itemIds: [newId()] }` and `'inventory.reservation.scan': { entityId: 1 }`. | confirmed |
| 8 | low | `docs/07-security.md:391` | "with only `sales.quote.create` (the Lead Converter, the Store Manager's own scope)": the Store Manager holds `inventory.stock.read:entity` and sees the counts; the status-only holders are the Lead Converter and the Sales Team Lead. | Name the Lead Converter and the Sales Team Lead. | confirmed |
| 9 | low | `app.line_availability()` (`0241:1303-1319`) | An order confirmed before this slice reaches a database has no needs: its lines answer no row ("Not kept in stock"), and it is never reserved or filled. | If staging or production hold open confirmed orders, backfill their needs once at migration, or answer the free stock for an order with no needs. | plausible (depends on hosted data) |

**Checked and sound:**
- **`app.stock_move()` against `main`'s latest (0231):** diffed function to function; the only changes are `v_reserved`, the balance read taking `qty_reserved`, and the `stock_reserved_insufficient` check after `stock_insufficient` in pass 2, under the balance lock; grants as 0231. `app.platform_only_permissions()` carries every key of 0222 plus `inventory.reservations.process`. The `sales_order_lines_insert` policy is 0117's plus `qty_backordered = 0`; the new append-only trigger function refuses every change but `qty_backordered`, and every delete, as `app.raise_append_only()` did, and no request role has an update grant on the lines.
- **Oversell:** every reserver takes the balances `for update` in (company, hub, bin, item) order before reading free stock, each statement reads afresh after the wait, `stock_move()` checks the reserved quantity under the same lock, and `stock_balances_reserved_on_hand_check` backs both. The lock order holds on confirmation (one sorted call over all the order's items), cancellation, lapse, release, extend, move (both hubs at once) and the reminder (`skip locked`), and against `stock_move()`; only the multi-item fill breaks it (finding 1).
- **No count for a holder of only `sales.quote.create`:** the definer nulls every quantity without `inventory.stock.read:entity`; the query's status shape never selects a count column and `LineStatusDto` is strict; the order and quote pages pass only that DTO to the browser; `SalesOrderDto` and the line DTO map columns by name (no `qty_backordered`); `sales.order.confirm`'s answer and audit row carry no quantity; the reservation events carry ids and dates (`.filled` a count of orders); the reminder notice carries the order and account ids only; `listReservations`, `listItemBackorders` and the stock card need `inventory.stock.read:entity`; the Lead Converter's grant is off in the seed, the oracle and SECURITY §3.2 (the vendor screens close with it, as SECURITY says).
- Row security on `reservations` and `reservation_needs` (forced, by company and grant, `app_reader` included, no write grant), the testing lists, the fixture rows and matrix rules; every definer checks its grant in its body, sets `search_path = ''` and has its revokes; `inventory.reservations.process` in the catalogue, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, the seed and SECURITY; the people-only commands in the agent sweep; audit labels, idempotency keys, `executeCommand()` and named `executeQuery()` calls; the cost permissions untouched.
- **`pnpm test:security`** (through `heavy.sh`, this worktree's Postgres on 54331): db 63 files, 1808 passed; domain 113 files, 1545 passed; web 40 files, 467 passed; exit 0.

**Not checked:**
- The journeys in `apps/web/e2e/reservations.spec.ts` (the General Manager's confirmation, the Inventory Manager's extension, the Lead Converter's status), and the orders and quotes journeys with the new column: not run (no sign-in in this session). Their specs were read: axe on each, three element snapshots, the Lead Converter's row checked for no count and `/inventory/stock` closed.
- Layout: no screenshot is committed (the builder ran with `--ignore-snapshots`), so the three new snapshots and the changed order and quote baselines are for the lead to look at when the Linux baselines are made.
- `pnpm build`, `js-budget`, typecheck and lint were not run again (the builder's report has them green).

**For integration:** U2's `0241_u2_purchase_orders_rls.sql` also redefines `app.platform_only_permissions()`, and its `0242_u2_reorder_notice.sql` both notice type checks; whichever merges second carries the other's keys and types. The `stock_reserved_insufficient` rule goes into X4's `app.stock_move()` (`0240_x4_stock_reasons.sql`, after its `v_have < v_line.qty` check).

**The lead's triage (27-11-2026): fix all nine in the one fix round.**
- **1:** one transaction per item for the fill, from the job and the event alike, so every transaction locks in the one order. A test runs two fills on overlapping items concurrently.
- **2:** a need put back on order by a lapse or a release by hand is filled only by stock that enters a storage bin after it was re-queued (a receipt, a gain, a transfer in), never by the stock its own lapse or release freed. Keep a `requeued_at` and compare it with the movement that brought the stock. A test: a lone order's hold lapses and its stock stays free; the next receipt fills it.
- **3:** the SQL availability (`app.free_availability()` and the line statuses) must agree with `atp.ts`. Add a parity test on generated cases: the same balances, kits and lines through both, the same statuses and quantities. Fix every difference it finds. The pure functions stay the specification.
- **4:** the preview adds up the same item across its lines before it answers a status, so the line order and repeats cannot be used to probe a count.
- **5:** insert the missing balance rows before taking the locks, as H1's definer does, and map `stock_balances_reserved_on_hand_check` to a refusal.
- **6:** the concurrency tests wait on `pg_stat_activity` instead of a fixed pause.
- **7:** add the two platform jobs to the agent sweep.
- **8:** correct SECURITY's wording.
- **9:** the migration backfills needs, queued in order of confirmation, for orders already confirmed, and the first fill reserves them.

**Finding 1 is high, so the reviewer re-checks the fix diff.**

## Integration
