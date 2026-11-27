# H2 Reservations and availability (wave 2)

| | |
|---|---|
| Branch | `feat/h2-reservations` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): stock, the ledger's definers, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder Opus 5.5 at high: 14:20 UTC to the early check at 16:13 UTC, then from 16:30 UTC to done at 17:31 UTC |
| State | done |
| Next step | the review; at integration, X4's `app.stock_move()` once it merges (one rule to carry over) |

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

## Review

## Integration
