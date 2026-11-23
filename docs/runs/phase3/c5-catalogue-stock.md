# C5 Catalogue for stock (wave 1)

| | |
|---|---|
| Branch | `feat/c5-catalogue-stock` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 23-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): catalogue columns and an import, no money or ledger |
| Usage | 5-hour window 4 % at 18:00 UTC when briefed; builder on Opus 5.5 at high effort from start to done |
| State | briefed |
| Next step | the builder's report |

## Brief
Build [phase3 §6.1](../../03-roadmap-appendix/phase3.md#61-c5-catalogue-for-stock) as written. Points the design leaves to you, settled here:

1. **Columns on `items`:** `warranty_months` and `supplier_warranty_months` (smallint, 0 to 360, null when not set), `barcode` (text, unique where not null, 4 to 64 printable characters), `purchase_unit` (one of the existing unit values, null meaning the stock unit), `purchase_unit_factor` (`numeric(12,3)`, at least 1, required when `purchase_unit` is set and differs from `unit`), `serial_pattern` (text of at most 200 characters, only on a serial-tracked item), `is_stocked` (boolean, default true; false only for a category the specs mark as a service). Check constraints in the database for each rule, and the same rules in the contract.
2. **Serial pattern:** a JavaScript regular expression source, compiled with `new RegExp(source, 'u')` and anchored by the code (`^(?:…)$`); refused when it does not compile, when it matches the empty string, or when it is longer than 200 characters. Export `serialMatchesPattern(item, serial)` from `packages/domain/src/catalogue/` for U2 and H3 to use. No serials table exists yet (H1 adds it), so the check against existing serials is a TODO for H1's merge: write it as a function that takes the serial list and leave its caller to H1, saying so in your report.
3. **Specifications:** check `packages/contracts/src/catalogue/specs.ts` for `structure`, `cable`, `pipe`, `inverter` and `battery`; add the fields an Inventory Manager needs to tell two items apart (for example a cable's cores, size in mm² and conductor; a pipe's diameter, class and length per piece; an inverter's kVA and phase; a battery's Ah and voltage), each optional, with units in the key names as C1 did.
4. **Commands:** `catalogue.item.create` and `.update` take the new fields (All companies only, as now) and audit them; no new command.
5. **Import:** a new kind `items` in the imports framework (P2b): the columns the design lists; an unknown category, an HSN not of 4, 6 or 8 digits, a unit outside the list, a bad pattern or a duplicate barcode refuses the row with its reason in the row report; a known SKU updates the item through `catalogue.item.update`; only from All companies (`catalogue_needs_all_companies`). Measure a 5,000-row import on the local stack and record it in your report.
6. **Screens:** the item sheet's Stock and warranty section (read for every reader of the catalogue, edited with `catalogue.write` from All companies); Import items beside the items grid; plain English in `en.json`, button labels within 24 characters.

Files owned: `packages/db/src/schema/items.ts` and its migration, `packages/contracts/src/catalogue/`, `packages/domain/src/commands/catalogue/items.ts`, `packages/domain/src/catalogue/` (new helpers), `packages/domain/src/queries/catalogue/`, the items import kind, the item sheet and grid under `apps/web/src/app/(bos)/catalogue/`.

Do not touch: anything of `inventory`, `procurement`, `warehouses`, `bins`, `stock_*`, `serials` or `vendors` (H1 and U1 own them); `kits` and `pump_curves` beyond reading.

Review checklist (check before your report): every new rule holds in the database as well as the contract; an Inventory Manager in one company cannot change an item; the import refuses each bad row with its reason and never half-writes an item; `docs/data` regenerated; the item sheet's snapshots in light, dark and 400 px.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5 and your slice's section) as its source. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/c5-catalogue-stock` is on GitHub with this file. Start with `git fetch origin && git switch feat/c5-catalogue-stock` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: c5-catalogue-stock <stage>` and push. The stages are `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: c5-catalogue-stock done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: c5-catalogue-stock fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: c5-catalogue-stock blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0228); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session:** `web-push-4` (the `web-push` 4.0.0 bump, `apps/web/src/notifications/push.ts` only), `c5-catalogue-stock` (C5: the `items` columns, the item form and import), `h1-stock-ledger` (H1: hubs, bins, the ledger, balances, costs, serials, `/inventory`) and `u1-vendors` (U1: vendors, supplier quotes, `/procurement`). Shared registration points (`en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the testing lists, `nav.ts`, `turbo.json`, `.env.example`) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report
