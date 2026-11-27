# U1 Vendors and supplier quotes (wave 1)

| | |
|---|---|
| Branch | `feat/u1-vendors` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 23-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): supplier rates behind `procurement.rate.read`, row security |
| Usage | 5-hour window 4 % at 18:00 UTC when briefed; builder on Opus 5.5 at high effort from start to done (the builder's session reports `claude-opus-5-5`, high effort, at the start, at done and at the fixes, 23-11-2026 and 24-11-2026 IST) |
| State | merged (#288) |
| Next step | none |

## Brief
Build [phase3 §6.3](../../03-roadmap-appendix/phase3.md#63-u1-vendors-and-supplier-quotes) as written, with question 6 (a): one vendor master for the group. The exit gate's second item is supplier-rate isolation, so the rate rules are the heart of this slice. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) for each table and [AGENTS §5](../../../AGENTS.md#5-domain-commands) for each command. Points the design leaves to you, settled here:

1. **Tables:** `vendors`, `vendor_contacts`, `item_vendors`, `vendor_quotes` with the columns of §6.3; GSTIN checked with the helper the entities already use (its format and that its first two digits are a state code; reuse, do not copy); `vendor_quotes.rate` `numeric(14,4)` per purchase unit excluding GST, `moq` and `lead_time_days` optional, `valid_until` on or after `valid_from`. `vendors`, `vendor_contacts` and `item_vendors` carry no company; `vendor_quotes.entity_id` is null for a quote given to the group or a company's id.
2. **Row security and grants:** vendors, contacts and item links are read by any principal holding `inventory.stock.read` or `procurement.po.write` in some company, and written only by holders of `procurement.po.write` in some company (an Executive or Inventory Manager), through the commands. `vendor_quotes` is read only with `procurement.rate.read`: a group quote by a holder in any company, a company's quote only by a holder in that company; written only through the commands by a holder of both `procurement.rate.read` and `procurement.po.write` in the quote's company (or every company for a group quote). No rate column on any other table. Every table in the testing lists, the role × company fixture and `app_reader`'s grants.
3. **Commands** (`packages/domain/src/commands/procurement/`): `procurement.vendor.create`, `.update`, `.archive` (a vendor named by an open quote stays readable; archiving withdraws nothing), `procurement.vendor.contact.set` (the contacts as a set), `procurement.item_vendor.set` (the vendor's item code and the preferred mark, one preferred vendor per item), `procurement.quote.record`, `procurement.quote.withdraw`. Audit fields never include `rate` (ids, the vendor, the item, the company and the validity only); events carry ids only; agents are refused by the grants and the agent refusal sweep covers each command.
4. **Queries:** `listVendors`, `getVendor` (its contacts, items and, with `procurement.rate.read`, its quotes), `compareQuotes` (items × vendors for a category and company: the valid rate, the minimum order, the lead time, the lowest valid rate marked; expired quotes shown as expired and never marked lowest; the item's purchase unit when C5's columns exist, else the stock unit, said in the report). Two DTOs per shape where the rate can appear, the one without rates built without reading them, so a rate never reaches a DTO for a person without the grant even by mistake.
5. **Screens:** `/procurement/vendors` (list, the vendor sheet with contacts, items supplied and quotes), `/procurement/compare` (only with `procurement.rate.read`), Record a quote with its document uploaded through the files path (P2) as a file purpose of its own; the menu Procurement in `nav.ts`. Journeys for the Inventory Manager (add a vendor, record a quote, compare) and a General Manager (sees vendors, no rate anywhere), with axe and snapshots.
6. **Import:** a `vendors` import kind (name, GSTIN, PAN, address, payment terms, lead time, contacts), a repeated GSTIN updating the vendor.

**Early check (Tier A):** once the tables, row security, grants and the security suite's rate cases are committed (every role and agent principal reading `vendor_quotes`, a company's quote invisible to another company's holder, no write by a person without both grants, the reader pool alike), write a short report here with the policies' text, push `report: u1-vendors early check` and stop. The lead reads the diff and sends "continue" to this session.

Files owned: `packages/db/src/schema/` new files for the four tables and their migrations; `packages/contracts/src/procurement/`; `packages/domain/src/commands/procurement/`, `packages/domain/src/queries/procurement/`; `apps/web/src/app/(bos)/procurement/`; the `vendors` import kind and the quote document's file purpose.

Do not touch: `items` and the item form (C5); anything under `inventory` or the ledger (H1); purchase orders and receipts (U2 later).

Review checklist (check before your report): no rate in any DTO, export, event, audit value, notification, log line or error message for a person without `procurement.rate.read`; the General Manager and the Store Manager see vendors and no rate on every screen and route; a company's quote is invisible to another company's holder; the comparison never marks an expired quote lowest.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5 and your slice's section) as its source. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/u1-vendors` is on GitHub with this file. Start with `git fetch origin && git switch feat/u1-vendors` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: u1-vendors <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: u1-vendors done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: u1-vendors fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: u1-vendors blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0228); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session:** `web-push-4` (the `web-push` 4.0.0 bump, `apps/web/src/notifications/push.ts` only), `c5-catalogue-stock` (C5: the `items` columns, the item form and import), `h1-stock-ledger` (H1: hubs, bins, the ledger, balances, costs, serials, `/inventory`) and `u1-vendors` (U1: vendors, supplier quotes, `/procurement`). Shared registration points (`en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the testing lists, `nav.ts`, `turbo.json`, `.env.example`) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

### 23-11-2026, cloud session: early check
Model and effort: Opus 5.5 (`claude-opus-5-5`) at high effort. Skill loaded: `add-table`.

**Built** (commits `c1d35915`, `6c5017dc`):
- `packages/db/src/schema/vendors.ts` (exported from `schema/index.ts` under a U1 comment): `vendors`, `vendor_contacts`, `item_vendors`, `vendor_quotes` with the columns of §6.3 and brief point 1.
  - `vendors`: `gstin` is optional (a supplier without GST registration), unique where set (the import's key). Its check is the entities' `entities_gstin_check` format, plus `state_code = left(gstin, 2)`. `pan` must be the GSTIN's characters 3 to 12 when both are set. `address_json` is always an object. Payment terms and lead time are each 0 to 365 days. `notes` is at most 2,000 characters.
  - `vendor_contacts`: `position` runs 1 to 20 and is unique per vendor. `phone_e164` takes the `contact_phones` format.
  - `item_vendors`: `(item_id, vendor_id)` is unique, and the partial unique index `item_vendors_one_preferred` allows one preferred vendor per item.
  - `vendor_quotes`: `rate numeric(14,4) > 0`, `moq numeric(12,3) > 0` (optional), `lead_time_days` (optional), `valid_until >= valid_from`, `file_id`, `recorded_by`, `withdrawn_at` and `withdrawn_by` (set together).
- Migrations: `0229_u1_vendors.sql` (generated) and `0230_u1_vendors_rls.sql` (custom). Both are numbered after `main`'s 0228 and the lead renumbers them at the merge.
- Testing lists: the four tables are in `ENTITY_TABLES`, so a request with no company reads none of them. `entity-matrix-fixture.ts` adds one group vendor with a contact and an item link, a group quote, and one quote per company. `role-entity-matrix.test.ts` gets the rules `VENDOR_READ` and `RATE_READ`. A vendor row is marked as belonging to every company, and its leak test is `false`, since it has no company. `NARROWER` in `grants.test.ts` gets the four entries. No list-valued check is added, so `enum-sync` is unchanged.
- `packages/db/tests/security/vendors.test.ts` (new, 135 tests):
  - Who may read rates: only the Executive, the Inventory Manager and Accounts hold `procurement.rate.read`, and no agent does.
  - Every role and agent principal acting in company 1 reads `vendor_quotes` (the group quote and company 1's quotes for a holder, nothing for anyone else) on both the `app_user` and `app_reader` pools.
  - A holder acting in company N never reads another company's quote. Acting in every company, a holder reads all quotes. With no company in the request, even the Executive reads none, the group quote included. Nothing is read without a context. `readonly_reporter` holds no privilege on `vendor_quotes`.
  - Every role without both `procurement.rate.read` and `procurement.po.write` records no quote. Accounts, who reads rates, withdraws none.
  - The Inventory Manager records a quote for their own company and none for another. A quote is signed by the person recording it. A group quote needs a request covering every company. No quote is recorded already withdrawn.
  - A quote's rate, company, validity and vendor never change once it is recorded (privilege refusal), and no quote is deleted.
  - The Inventory Manager withdraws a live quote of their own company once, never another company's, and a withdrawn quote is never brought back or withdrawn again. The withdrawal is signed by the person withdrawing. The reader pool writes nothing, even for the Executive.
  - Vendor master reads: every role reads all three master tables in every company if it holds `inventory.stock.read` or `procurement.po.write`, otherwise nothing. Nothing is read with no company in the request, on either pool. The General Manager and the Store Manager read vendors and no rate.
  - Vendor master writes: every role without `procurement.po.write` adds, changes and removes nothing. The Inventory Manager adds and edits a vendor signed by themselves, cannot change `created_by`, and cannot delete a vendor.
  - Data checks: a second preferred vendor for the same item is refused. A GSTIN with the wrong state code or a PAN that does not match is refused, and so is a malformed GSTIN.
- Documents: the DATABASE §6.5 catalogue rows for the four tables, and `pnpm db:docs` regenerated (`docs/data/`).

**The policies** (`0230_u1_vendors_rls.sql`; each permission test and the company test is an initplan):
```sql
-- vendors, vendor_contacts, item_vendors: read (to app_user, app_reader)
using (cardinality((select app.entity_ids())) > 0
       and ((select app.has_perm('inventory.stock.read:own'))
            or (select app.has_perm('procurement.po.write:entity'))))
-- their insert (to app_user)
with check (cardinality((select app.entity_ids())) > 0
            and (select app.has_perm('procurement.po.write:entity'))
            and created_by = (select app.user_id()))
-- vendors and item_vendors update: the same with updated_by = (select app.user_id()) in the check;
-- vendor_contacts and item_vendors delete: cardinality(...) > 0 and procurement.po.write:entity

-- vendor_quotes_read (to app_user, app_reader)
using ((select app.has_perm('procurement.rate.read:entity'))
       and ((entity_id is null and cardinality((select app.entity_ids())) > 0)
            or entity_id = any ((select app.entity_ids())::int[])))
-- vendor_quotes_insert (to app_user)
with check ((select app.has_perm('procurement.rate.read:entity'))
            and (select app.has_perm('procurement.po.write:entity'))
            and recorded_by = (select app.user_id())
            and withdrawn_at is null
            and ((entity_id is null and (select app.request_covers_group()))
                 or entity_id = any ((select app.entity_ids())::int[])))
-- vendor_quotes_withdraw (update, to app_user)
using (<both grants> and withdrawn_at is null and <the insert's company test>)
with check (<both grants> and withdrawn_at is not null
            and withdrawn_by = (select app.user_id()) and <the insert's company test>)
```
**Grants:**
- `vendors`: `select, insert`, plus `update` on its own columns only (never `created_by`).
- `vendor_contacts`: `select, insert, delete` (replaced as a set).
- `item_vendors`: `select, insert, delete`, plus `update (vendor_item_code, is_preferred, updated_at, updated_by)`.
- `vendor_quotes`: `select, insert`, plus `update (withdrawn_at, withdrawn_by, updated_at)`.
- `app_reader` selects all four tables. `readonly_reporter` selects the three master tables and has no privilege on `vendor_quotes`.

**Checks run in the VM:**
- `pnpm test:security`: db 1,680 passed (61 files), domain 1,415 passed (100 files), web 460 passed (39 files); 4 of 4 tasks successful.
- `pnpm typecheck`: 10 of 10 successful.
- `pnpm exec eslint --max-warnings 0 packages/db`: clean.
- `pnpm db:docs`: regenerated.

**Assumptions** (minor gaps, my call):
- **Optional GSTIN.** `vendors.gstin` is optional, for a supplier without GST registration. An import row without a GSTIN therefore always creates a vendor, since a repeated GSTIN is the only key.
- **Active flag.** A vendor is archived by `is_active = false` (the design's column). There is no `archived_at`.
- **Quote validity.** `valid_until` is required, so every quote can expire and the comparison can mark it expired.
- **Contacts as a set.** `vendor_contacts` are replaced as a set by delete and insert, not updated.
- **Item links.** An `item_vendors` row is deleted when the vendor stops supplying the item; `procurement.item_vendor.set` will take a flag for it.
- **Agents read vendors.** `agent:sizing` and `agent:chief` hold `inventory.stock.read:entity`, so they read the vendor master, which holds no rate, as brief point 2 says. They read no quote, since no agent holds `procurement.rate.read`, and they write nothing.
- **Quote document.** `vendor_quotes.file_id` references `files`. The quote document's file purpose and its read rule come with the commands and screens after "continue".

**Next, after "continue":** the contracts, the seven commands with their tests and the agent refusal sweep's inputs, the queries and DTOs, the screens, the import kind and the quote document's file purpose.

### 23-11-2026, cloud session: done
Model and effort: Opus 5.5 (`claude-opus-5-5`) at high effort, start to done. Skills loaded: `add-table` (before the early check) and `add-command`.

**Built after "continue"** (commits `03bc8d64` to `c3d69594` on `feat/u1-vendors`):
- **Contracts** (`packages/contracts/src/procurement/`):
  - The inputs of the seven commands. A vendor's GSTIN is checked with the entities' own `EntityGstinSchema`, now exported from `commands/org/update-entity.ts`; that is a one-word change to an org file.
  - DTOs: `VendorDto`, `VendorContactDto`, `ItemVendorDto`, `VendorListRowDto`, `VendorSheetDto` (no quotes), `VendorSheetWithQuotesDto`, `VendorQuoteDto` and `CompareQuotesDto`, plus the vendors import's row input.
  - Events: `procurement.vendor.created`, `.updated`, `.archived`, `procurement.quote.recorded` and `.withdrawn`. They carry ids and codes only, and none is subscribed.
- **Commands** (`packages/domain/src/commands/procurement/`):
  - `procurement.vendor.create`, `.update`, `.archive`, `.contact.set`, `procurement.item_vendor.set`, `procurement.quote.record` and `.withdraw`. All are people only.
  - The quote commands need `procurement.rate.read` and, through `alsoRequires`, `procurement.po.write`. A group quote needs a request covering every company (`vendor_quote_needs_all_companies`).
  - The record command's `auditInput` leaves the rate out, so neither a successful, refused nor failed call puts the rate in an audit row.
  - Audit values are names, codes, the validity, `withdrawnAt` and ids; never a rate. A person's phone or email is never audited: the people change records names and roles only.
  - Registered in the registry and exported from the domain index.
- **Queries** (`packages/domain/src/queries/procurement/`):
  - `listVendors` (keyset by name).
  - `getVendor`: the sheet without quotes is built by `readVendorSheet()` and never reads `vendor_quotes`; quotes are read only after `assertRateReader()`.
  - `compareQuotes`: for one company, with an optional category. Each cell is the vendor's lowest live quote, else the one that ended last, shown expired. The lowest live rate per item is marked by comparing whole ten-thousandths, with no floats. An expired quote is never marked lowest, and withdrawn or not-yet-started quotes are left out.
- **File purpose `vendor_quote`:**
  - Upload and read need `procurement.rate.read`.
  - Migrations `0231_u1_vendor_quote_files.sql` (the purpose check widened `NOT VALID`) and `0232_u1_vendor_quote_files_grant.sql` (`app.file_purpose_grant()` as in 0123, plus the purpose).
  - Also in `files/purposes.ts`, `files/limits.ts` (PDF or photo, the usual size limit), `contract-values.ts` and the suites' purpose lists.
- **The `vendors` import kind:**
  - Fields: vendor name, GSTIN, PAN, address, town, PIN, payment terms, delivery time, and one person per row (name, role, mobile, email).
  - A GSTIN already in the master updates that vendor with what the row gives (`vendor_update`), and adds the row's person unless one of that name is there. A GSTIN listed twice in a file is skipped. An archived vendor's GSTIN is refused (`vendor_archived`).
  - Rows run through the vendor commands. A rollback archives only the vendors the job added.
  - Migration `0233_u1_vendors_import.sql` widens the kind and created-type checks `NOT VALID`.
  - Edited in the import framework's shared registration points: `imports/enums.ts`, `commands/imports/jobs.ts`, `shared.ts`, `create-job`, `map-job`, `preview-job`, `commit-job`, `rollback-job`, `import-wizard.ts`, `rows-grid.tsx` and the new-import page. Each change is one block marked U1. C5's items kind edits the same places, so the lead merges them.
- **Web:**
  - Server actions in `apps/web/src/actions/procurement.ts`.
  - The menu item Procurement (`nav.ts`), which needs `inventory.stock.read:own`; every holder of `procurement.po.write` holds it.
  - `/procurement` redirects to `/procurement/vendors`.
  - `/procurement/vendors`: the list with search and archived vendors, and the vendor sheet. The sheet has details, people, items supplied with their preferred mark and the vendor's code, and quotes only for a holder of `procurement.rate.read`, with Record quote (document uploaded through `sendFile` as `vendor_quote`), Withdraw, Open quote, Edit, Edit people, Add item, Remove and Archive.
  - `/procurement/compare` (`procurement.rate.read`; anyone else gets the not-found screen): a table on wider screens and cards on a phone.
  - Also: the `/procurement` client scope, `BOS_PREFIXES`, `en.json` (`procurement.*`, `nav.procurement`, `home.hint.procurement`, the import words, the Activity log names, nine `errors.*` sentences), the copy-lint button keys, and `js-budget.json` for the three pages.
- **Journeys** (`apps/web/e2e/procurement.spec.ts`):
  - The Inventory Manager: the vendor list, adding a vendor, its people, an item, recording a quote, and comparing.
  - The General Manager and the Store Manager: the vendors with no Quotes section, no "₹" on the page and no comparison.
  - The Executive: the snapshot company's comparison.
  - axe on every screen and dialog, and three screenshots.
  - The seed `apps/web/e2e/setup/procurement.ts` writes two vendors with fixed ids and the snapshot company's quotes.
  - A new signed-in person, `inventoryManager` (Inventory Manager of company 1), is added to `SIGNED_IN_ROLES`.
- **Documents:**
  - DATABASE: the §6.5 rows `Built (0229)`, the `files` purpose and the import kind and created types.
  - SECURITY §4: supplier rates.
  - The design's **Built (U1)** record.
  - `pnpm db:docs`.

**Tests added:**
- `packages/db/tests/security/vendors.test.ts`: 135 tests, from the early check.
- `packages/domain/tests/commands/procurement.test.ts`: 23 tests.
  - Every command is denied to roles without its grants and to agents. Wrong company: a quote for another company, and a group quote from a one-company request.
  - Happy paths, and audit and event shapes with no rate in either, including a refused and a failed call through `executeCommand`.
  - GSTIN, PAN and state checks, archiving withdrawing no quote, contacts as a set, the preferred vendor moving, and the document's purpose and company.
  - The sheet without quotes for the General Manager and the Store Manager. Quotes for the group and the caller's company only.
  - The comparison's lowest live rate marked and the cheaper expired quote not marked, another company's quote absent, the comparison refused to the General Manager and for a company outside the request, and keyset paging.
- `packages/domain/tests/commands/import-vendors.test.ts`: 2 tests. The General Manager (imports but writes no purchase order) is refused. Preview findings, commit with a GSTIN update and a person added, and rollback.
- Additions to shared tests:
  - The agent refusal sweep: `U1_QUOTE_INPUTS` and the five vendor commands.
  - `refusal-coverage.test.ts`: four reviewed entries, because the vendor master has no company.
  - `reader-parity.test.ts`: `listVendors` and `getVendor`.
  - `files.test.ts` and the role × company matrix: `vendor_quote`.
  - `purposes.test.ts`.
  - `apps/web/src/screens/procurement.test.ts`: 3 tests for the rate and quantity formats.

**Checks run in the VM (24-11-2026 IST):**
- `pnpm typecheck`: 10 of 10 tasks pass.
- `pnpm lint` (whole repository, final): passes, exit 0.
- `pnpm test` (unit): 10 of 10 tasks pass:
  - contracts 322
  - db 161
  - domain 2,595
  - web 1,210 (1 skipped)
  - ui 107
  - tokens 146
  - voice 49
  - voice-agent 23
  - copy-lint 17
- `pnpm test:security`:
  - **db:** 1,679 of 1,680 passed on the last run. The one failure is `alert-counts.test.ts` "counts failed and waiting rows…", which inserts a voice session started 40 minutes ago and expects it in the India day. The run was at 00:32 IST, so the session fell on the previous day. It is a time-of-day flake, and it passed (1,680 of 1,680) on the early-check run at 18:05 UTC.
  - **domain:** 1,441 of 1,441 (102 files), after adding the two vendor queries to `reader-parity.test.ts`, which the run before had caught
  - **web:** 460 of 460, run on its own. Run beside the domain suite with `turbo --only`, five event-delivery cases failed because both suites shared the outbox; the full run orders the suites.
- `pnpm copy-lint`: clean.
- `pnpm db:docs` and `machines:docs`: regenerated.
- `pnpm build`: passes, with `/procurement`, `/procurement/compare` and `/procurement/vendors` built.
- `pnpm --filter web js-budget`:
  - The three new pages are inside their new budgets: vendors 227.5 of 239 kB, compare 198.1 of 208, `/procurement` 190.2 of 200.
  - **Two existing pages are now just over:** `/admin/integrations` 240.1 kB against 240, and `/calling` 206.6 kB against 206. They have drifted up over several slices (`/calling` measured 196.6 kB on 05-10-2026). This slice adds a menu item, an icon and a few shared values to every page's shell.
  - I did not raise another page's budget. That is the lead's or owner's call.
- `python3 tools/integration/check-doc-links.py`: one finding, `ORPHAN docs/runs/phase3/u1-vendors.md`. The run file is not linked from `docs/runs/phase3/readme.md`, which is the lead's file, so I left it.

**`EXPLAIN (ANALYZE)` as `app_user` under the policies**, on synthetic rows that were removed afterwards (2,083 items, 650 vendors, 6,000 item links, 30,000 quotes over four companies and the group, a fifth of them expired):
- `listVendors`, first page: `Index Scan using vendors_active_name_idx` with `Index Cond: (is_active = true)`, the item count by `item_vendors_vendor_idx` per row. 0.95 ms.
- `compareQuotes`, company 1, cable: `BitmapOr` on `vendor_quotes_entity_idx` (group and company 1, about 12,000 rows each) hash-joined to the category's items (`items_category_idx`). 1,193 cells in 8.2 ms.
- A vendor's quotes (`getVendor`, 50 quotes): `Bitmap Index Scan on vendor_quotes_vendor_idx`. 1.2 ms.

**Not run here, for the lead on the PC:**
- The journeys and their Linux baselines (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test procurement.spec.ts`, then `e2e:snap -- procurement.spec.ts`). They cannot sign in here, because this environment's network refuses `challenges.cloudflare.com`. The spec, its seed and `users.ts` typecheck and lint clean, but they have never run.
- Expected screenshots: `procurement-vendors`, `procurement-vendor-sheet-no-rates` and `procurement-compare`. The rows pictured are seeded only, and the dates are in masked `time` elements.

**For the lead at integration:**
- **Migrations to renumber:** 0229 to 0233. The DATABASE rows name 0229, which `docs/data` checks.
- **The owner's `checks-ok` label is needed:** this pull request changes `js-budget.json`.
- **Shared points touched, one block each, marked U1:**
  - `packages/db/src/testing/index.ts` and the matrix fixture
  - `grants.test.ts`, `role-entity-matrix.test.ts`, `files.test.ts`, `agent-refusals.test.ts`, `refusal-coverage.test.ts`, `reader-parity.test.ts`
  - the event catalogue, the registry, the domain index
  - `en.json`, `nav.ts`, `session-gate.ts`, `client-namespaces.ts`
  - `copy-lint.config.json`
  - `audit.ts`, `contract-values.ts`
  - the import framework files listed above
  - `e2e/support/users.ts` and `e2e/setup/seed.ts`
- **Likely overlaps:** C5's items import, and H1's or C5's own journey people.

**Assumptions** (the brief and the early check left these open):
1. **The comparison's unit.** C5's purchase units are not on this branch, so the comparison's rates are per the item's stock unit (`items.unit`). The screen says "Rates per {unit}". Once C5 merges, the column and the words change to the purchase unit.
2. **Who imports vendors.** A vendor list is imported only by a holder of both `imports.write` and `procurement.po.write`, which today is only the Executive. The Inventory Manager holds no `imports.write`, and I did not change the permission matrix.
3. **Updating by GSTIN.** An import row with a known GSTIN updates the name and the fields the row gives; fields left blank keep what the vendor has.
4. **Where a group quote's document lives.** A group quote's document is stored in the first company the person may record quotes for, and is read with `procurement.rate.read` in that company. A holder acting only in another company sees the quote but cannot open its document.
5. **Quote dates.** A quote that has already ended is refused (`vendor_quote_ended`). One that starts later is accepted, shown as "Starts later", and left out of the comparison until it starts.
6. **Withdrawing a quote.** An Inventory Manager withdraws only their own company's quotes. A group quote is withdrawn from a request covering every company.
7. **Replayed answers.** The record and withdraw answers carry the rate and are stored as the caller's idempotency answer in `idempotency_keys`, which is scoped to the caller, a holder of the grant.
8. **The comparison is not in the reader parity list.** Its name does not match that test's query-name pattern. Its row security on the reader pool is covered by `vendors.test.ts`, which reads `vendor_quotes` on both pools.

**Review checklist, checked:**
- **No rate leaks to a person without `procurement.rate.read`:** no DTO, export (none exists), event, audit value or input, notification (none sent), log line or error message carries one.
- **The General Manager and the Store Manager:** see vendors and no rate on every screen and route. The comparison page is not found for them and its query refuses them. `vendor_quote` files are unreadable to them.
- **Company isolation:** a company's quote is invisible to another company's holder, on both pools.
- **Expired quotes:** the comparison never marks one lowest.

## Review

### 24-11-2026 IST, cloud session (seat 2), commit 8c3f9912
Adversarial review against the Brief, phase3 §6.3, AGENTS §10 and the exit gate's supplier-rate isolation. Diff: `origin/main...feat/u1-vendors`. I read the database layer, contracts, commands and queries myself. Two helper agents read the web layer, and the import, file and audit paths; I checked their main findings in the code.

**Verdict:** I found no path by which a supplier rate reaches a person without `procurement.rate.read`, and none by which a company's quote reaches a holder acting only in another company. One finding blocks the merge (H1, CI). The rest are medium and low.

| # | Severity | Where | What is wrong, and a failure scenario | Fix | Status |
|---|---|---|---|---|---|
| H1 | high (blocks CI) | `apps/web/js-budget.json`; the app shell | `pnpm --filter web js-budget` fails on this branch: `/admin/integrations` 240.1 kB against 240, and `/calling` 206.6 kB against 206. On `main` (334a6d0b plus docs, built here) they are 239.1 kB and 205.8 kB, so this slice's menu item and shell values tip them over, and CI's budget step fails the pull request. | Trim what the slice adds to the shared shell (for example, keep the Procurement icon and values out of the common chunk), or raise the two budgets with the reason. Either way it is a `checks-ok` change. | confirmed |
| M1 | medium | `apps/web/e2e/procurement.spec.ts:116-136`; `e2e/setup/procurement.ts:37,54` | The General Manager and Store Manager "no rate" journey cannot fail on a rate. Both act in company 1, and every seeded quote is company 3's (`SNAPSHOT_COMPANY`). With no group or company-1 quote on the vendor they open, a broken quote gate would still show no "₹". Only the absent Quotes heading would catch it. | Seed a group quote and a company-1 quote on that vendor, and assert the Executive or Inventory Manager sees them on the same sheet, so the "no ₹" check means something. | confirmed |
| M2 | medium | `apps/web/src/components/procurement/quote-form.tsx:84`; `vendor-read.ts:224`; `0066_files_uploads_rls.sql:41-47` | A group quote's document is stored in the first company listed. Every rate holder in any company can read the group quote, but the `files` policy shows the file only in its own company. An Accounts person of company 3, or the recorder acting in one other company, clicks Open quote and gets a failure. No leak: it is a broken button. | Either add a `files` read rule for `vendor_quote` files named by a group quote, under `procurement.rate.read`, or send `fileId` only when the file is readable in the request. | confirmed |
| M3 | medium | `apps/web/src/components/procurement/compare-screen.tsx:304-315` | No guard against a stale answer. Change the company, then the category: if the first answer lands last, the picker says company 2 while the table shows company 1's rates and Lowest marks. Both companies are the viewer's own, so this mislabels rather than leaks. | Use the `wanted` reference guard `vendors-screen.tsx:70,85` already uses. | confirmed |
| M4 | medium | `packages/domain/src/commands/imports/rollback-job.ts:115-125`; `vendors_gstin_unique` | Rolling back a vendor import archives its vendors, and nothing un-archives them. The GSTIN index covers archived rows, so a re-import is refused (`vendor_archived`), and so is adding the vendor by hand (`vendor_gstin_taken`). Scenario: an import with columns mapped wrongly, rolled back to redo the mapping, can never be imported again. | Delete the job's vendors that nothing refers to yet, or let a re-import or a restore bring back a vendor a rollback archived. | confirmed |
| M5 | medium | `packages/domain/src/imports/vendors.ts:192` and its update path | An import row with a known GSTIN overwrites the vendor's fields. The inner commands' audit rows are discarded (`auditedByCaller`), so no before and after is kept, and a rollback skips `vendor_update` rows. Also, any address cell replaces the whole stored address: a file with only a City column wipes line 1 and the PIN, against the rule "blank keeps what the vendor has". | Keep a per-vendor before and after for import updates, and merge the address line by line. | confirmed |
| M6 | medium | `packages/domain/src/queries/procurement/vendor-queries.ts:120-150` | `compareQuotes` reads every non-withdrawn quote the company and group ever had, with no lower date bound (only `valid_from <= today`), and no paging over items. Each expired quote is read only to pick the one that ended last. The work grows with years of history, and with no category it loads the whole catalogue times vendors into memory in one answer. | Choose each item-vendor cell in SQL (`distinct on (item_id, vendor_id)`, live first, then latest ended), bound expired quotes to a window, and page by item. | confirmed (code read; the builder's `EXPLAIN` used one category) |
| L1 | low | `vendor-queries.ts:compareQuotes` | Quotes of archived vendors are compared and can be marked Lowest. The design does not say; an archived supplier is probably not one to buy from. | Leave them out, or show them apart and never mark them lowest. | confirmed |
| L2 | low | `apps/web/src/components/procurement/quote-form.tsx:82-84,121,164` | Changing "Quoted to" after uploading keeps the old company's `fileId`, so the server refuses with `vendor_quote_file_missing` while the uploader still says ready. | Clear the file when the company changes. | confirmed |
| L3 | low | `vendor-sheet.tsx:333-336`; `vendors/page.tsx:45-47` | Accounts (rates but no `procurement.po.write`) sees "For one company" on every company quote: names come from `quoteCompanies`, which is empty for them. | Pass the readable companies' names separately. | confirmed |
| L4 | low | `apps/web/src/components/procurement/vendors-screen.tsx:185` | An `md:items-end` row lines up the checkbox and Add vendor with the search field's helper text, not its box (docs/08 §6). The lint rule misses it because the button is inside a conditional. | Use `items-start`, or move the page action out of the row. | plausible (no screenshot) |
| L5 | low | `vendor-sheet.tsx:348-357,579`; `quote-form.tsx:219`; `vendor-links-form.tsx:296` | Accessibility: every sheet quote has a button named only "Open quote"; the withdraw dialog has no `returnFocusTo`; two quotes of one item share one withdraw label; the item-missing messages are plain paragraphs, not tied to the field or announced. | Use `openDocumentFor`, return focus, name by vendor, item and dates, and use the field's error slot. | confirmed |
| L6 | low | `apps/web/e2e/procurement.spec.ts:140-143` and coverage | The refusal check (`toHaveCount(0)` on the heading) passes on any error page. No journey edits, archives or withdraws, uploads a document, or records a group quote, so those dialogs never get an axe check. | Assert the not-found screen's text, and add one journey through those dialogs. | confirmed |
| L7 | low | `en.json` | "All four companies" and "All companies" both name the group quote (docs/08 §11.1 rule 4). | Use one wording. | confirmed |
| L8 | low | `packages/domain/src/commands/procurement/quotes.ts:47-71` | `assertQuoteFile` accepts any ready `vendor_quote` file of the company, whoever uploaded it and even when another quote uses it, so a quote can point at another supplier's document. Every reader of that file holds `procurement.rate.read` there, so nothing leaks. | Require the caller's own upload, used by no other quote. | confirmed |
| L9 | low | the import framework (`import_rows.raw_json`, the import file) | A vendor list's unmapped columns are kept whole and readable by any `imports.write` holder in the company, including the General Manager. A supplier price list uploaded as a vendor list would show its Rate column to them. | For the vendors kind, require `procurement.po.write` to read the job, its rows and its file, or drop unmapped cells once mapped. | plausible |
| L10 | low | `packages/domain/src/command/run-command.ts:348-388` | A key replay returns the stored answer before the handler's company check. A person who recorded a company-1 quote, later lost company 1 but kept the rate grant, can replay the key within its window and see the rate they typed. | Check the stored answer's `entityId` against the request on replay. | plausible |
| L11 | low | `reader-parity.test.ts` | `compareQuotes` is not in the reader parity list (builder's assumption 8); `vendors.test.ts` reads the table on both pools, but the query itself is not run on `app_reader`. | Add it under a name the pattern takes. | confirmed |

**Checked and found sound**
- **Row security (0230):**
  - Forced on all four tables; every policy fails closed with no company in the request.
  - `vendor_quotes_read` needs `procurement.rate.read`, and admits a group quote in any company and a company's quote only in that company, on both `app_user` and `app_reader`. `readonly_reporter` holds nothing on `vendor_quotes`.
  - Inserts are signed by the caller, a group quote needs `request_covers_group()`, and only a live quote can be withdrawn; column grants keep a quote's rate, company and validity as recorded.
  - A principal has one permission set across its companies (in All-companies mode the intersection, `resolve-principal.ts`), so the company-free `has_perm` test cannot admit a company where the grant is missing.
  - Voice principals have `procurement.rate.read` removed.
- **Commands:**
  - All are people only; the quote commands need both grants.
  - The record command's `auditInput` leaves the rate out, and a refused, failed or unparsable call records the summary or nothing (`execute.ts:179-194`).
  - Events carry ids and booleans; error messages and details carry ids and reasons; there are no logger calls.
  - Idempotency answers are readable only by their owner.
  - `item_vendor.set` refuses `supplies: false` with `isPreferred: true`, and two concurrent preferred marks hit the unique index (`item_vendor_changed`).
- **Queries:** the sheet without quotes never reads `vendor_quotes`, and quotes and the comparison are read only after `assertRateReader`. The comparison refuses a company outside the request, compares rates as whole ten-thousandths, and never marks an expired quote lowest.
- **Migrations:**
  - 0232's `app.file_purpose_grant()` equals main's latest (0123) plus the two `vendor_quote` lines.
  - 0231 keeps all 18 purposes of main's latest check (0206); 0233 keeps 0101's kinds and 0105's created types, widened `NOT VALID`.
  - The General Manager cannot read a `vendor_quote` file, and company 2 cannot read company 1's.
- **Web:**
  - Pages call `screenAccess(navRequires('procurement'))`; the compare page answers not-found without the grant before any read.
  - Reads go through named `executeQuery` and writes through `executeCommand` with per-form keys.
  - Failed actions return no DTO, and no rate is put in a URL or label.
  - Browser code imports types only; copy is in `en.json`; colours are tokens.
- **Documents:** SECURITY §4's U1 paragraph and DATABASE §6.5 match the code; phase3's Built record is present.

**Run here**
- `vendors.test.ts`, `role-entity-matrix.test.ts`, `grants.test.ts` and `files.test.ts` (db): 475 passed.
- `procurement.test.ts`, `import-vendors.test.ts`, `agent-refusals.test.ts` and `reader-parity.test.ts` (domain): 93 passed.
- `pnpm build`: passes.
- `pnpm --filter web js-budget`: fails, as H1 says.

**Not run** (for the lead on the PC)
- The journeys in `apps/web/e2e/procurement.spec.ts`: 4 tests (Inventory Manager adds a vendor, records and compares; the General Manager and the Store Manager see vendors and no rate; the Executive's comparison screenshot), each in every Playwright project. They need sign-in, which this cloud session cannot reach (`challenges.cloudflare.com` is refused). Also not run: their axe checks and the Linux baselines `procurement-vendors`, `procurement-vendor-sheet-no-rates` and `procurement-compare`, so I looked at no screenshot (L4 stays plausible).
- The whole `pnpm test:security` and `pnpm lint`.

### 24-11-2026 IST, cloud session: fixes
The fix round on the Review of commit 8c3f9912 (seat 2), started from `b82b2aa2` after `git pull`. Model and effort: Opus 5.5 (`claude-opus-5-5`) at high effort. Commits `4cd2872e` to `d9db35f4`.

| # | Status | What changed |
|---|---|---|
| H1 | partly; one step needs the lead or owner | The shell is trimmed: `/calling` 205.9 kB of 206 (`main` 205.8) and `/admin/integrations` 239.4 kB of 240 (`main` 239.1). See below. |
| M1 | fixed | Seeded a group quote and a company-1 quote on the vendor the managers open; the Inventory Manager sees both there. |
| M2 | fixed | `files_vendor_quote_group_read` reads a group quote's document in any company. |
| M3 | fixed | The comparison drops an answer for an earlier choice. |
| M4 | fixed | A rollback removes the job's unreferenced vendors and archives the rest; a re-import revives one. |
| M5 | fixed | Updates keep a before and after on their rows, a rollback restores them, and addresses merge field by field. |
| M6 | fixed | Each cell is chosen in SQL, expired quotes are read from the last 365 days only, and rows page by item, 100 at a time. |
| L1 to L11 | fixed | As listed below. |

**H1 in detail:**
- **What I found:** this slice's own additions (icon, menu entry, values) cost about 140 bytes gzip. Most of the excess came from the redirect-only `/procurement` page: a route that loads the shell and nothing else made Turbopack split the shell's chunk into three for every page. I measured this against a `main` build in a temporary worktree, now removed.
- **What I changed:** `/procurement` now renders the vendor list itself (`app/(bos)/procurement/page.tsx`, guarded by `screenAccess(navRequires('procurement'))`). The menu reuses `Layers`, which the top bar's company switcher already ships, in place of `Truck`.
- **What is open:** `/procurement` now loads 226.8 kB against the 200 kB entry this slice added for a redirect, so `pnpm --filter web js-budget` fails on that entry alone. Raising it to 239 is a one-value edit. The session's permission check refused my edit to `js-budget.json`, and your brief also says not to edit that file, so it is yours or the owner's. The alternative is a redirect again, which brings back the split and puts both existing pages over budget.

**M2 in detail:**
- **A policy of its own, not a redefinition:** I added a separate permissive policy (migration 0234) rather than redefining `files_read`. It follows 0117's `files_signed_quote_read` and leaves every clause of `files_read` untouched.
- **What "live" means here:** not withdrawn. An expired group quote's document still opens in other companies, because the comparison shows expired quotes with their documents.
- **Tests:** in `vendors.test.ts`, every role acting in company 3 on both pools; a withdrawn group quote's document no longer opens elsewhere; the general rule still reads it in its own company. The role × company matrix's `files` leak rule now excludes these documents.

**M4 and M5 in detail:**
- **Migrations:** 0235 adds `import_rows.undo_json`. 0236 grants update on it and adds the definers `app.import_vendors_undo()` (removes the job's vendors that nothing refers to, with their people, and archives the rest) and `app.import_rows_keep_columns()` (L9).
- **Reviving:** a GSTIN that an earlier rollback archived is valid in the preview, and the commit brings the vendor back as one the job made.
- **Updates:** an update keeps the vendor as it was in `undo_json`, plus its people when the row added one, and the time of its change. A rollback restores that through the vendor commands unless the vendor changed since, in which case it counts as kept. The rollback's audit row adds `removed` and `restored`.
- **Addresses** merge field by field: a blank cell keeps what the vendor has.
- **Module split:** the import's helpers are split into `imports/vendor-restore.ts` and `imports/vendor-rows.ts`, so the event-emitter check attributes only what each command really runs. `procurement.vendor.updated` also lists `imports.job.rollback` as an emitter.

**M6 in detail:**
- **The query:** the comparison chooses each cell per item with `cross join lateral … distinct on (vendor_id)`: live first by lowest rate, then the one that ended last.
- **Window and paging:** expired quotes are read from the last 365 days only (`COMPARE_EXPIRED_DAYS`). Rows page by item with a keyset cursor on name and id, 100 items a page (`COMPARE_PAGE_ITEMS`), with "Load more items" on the screen.
- **`EXPLAIN (ANALYZE)`** as `app_user` under the policies on 5,000 items, 50 vendors and 3 years of quotes (300,000 rows), company 1. The synthetic rows were removed afterwards.
  - Category cable, first page: 43.6 ms. Each item's cells come from `Bitmap Index Scan on vendor_quotes_item_idx` (101 loops at 0.11 ms); choosing the page's items takes about 31 ms of it.
  - Every category, first page: about the same.
  - The version before `lateral` took 59.9 ms, because it read the company's and the group's 120,000 quotes through `vendor_quotes_entity_idx`.
  - Choosing the items faster would need an index on `items` by name, which C5 owns, so I left it.

**The lows:**
- **L1:** archived vendors' quotes are left out of the comparison.
- **L2:** changing "Quoted to" clears the uploaded document; the uploader resets by `key`.
- **L3:** the sheet names each quote's company from every company of the request (`powers.companyNames`).
- **L4:** the vendor list's search and its archived choice are stacked, and Add vendor sits apart, with no `items-end`.
- **L5:**
  - Open quote and Withdraw are named by the quote's item, dates and company.
  - The withdraw dialog returns focus to its button.
  - "Choose the item" is shown in the field's error slot. For that, `ItemPicker` gained an optional `error` prop, a one-line change to a catalogue component.
- **L6:**
  - The managers' refusal now asserts the not-found screen's heading.
  - New journeys: the Inventory Manager edits a vendor, records a quote with an uploaded document, withdraws it and archives the vendor, with axe on each dialog. The Executive records a group quote that starts later, so no comparison or screenshot shows it.
- **L7:** "All companies" is the one wording for the group.
- **L8:** a quote's document must be the caller's own upload and named by no other quote.
- **L9:** a vendor list's rows keep only their mapped cells once the person commits the job.
- **L10:** `run-command.ts` refuses a replayed answer whose `entityId` is outside the request (`forbidden`). This applies to every command.
- **L11:** the domain query is renamed `readQuoteComparison` and covered in `reader-parity.test.ts`. The web action keeps the name `compareQuotes`.

**Tests added or changed in this round:**
- `vendors.test.ts`: M2, 37 cases.
- `procurement.test.ts`: now 26. Added: archived vendor and 365-day window, paging, a document from another person or another quote, and replay outside the request.
- `import-vendors.test.ts`: now 5. Added: a rollback that removes and archives, then a revive; address merge; mapped cells only.
- `reader-parity.test.ts`: `readQuoteComparison`.
- `role-entity-matrix.test.ts`: the `files` leak rule.
- The two procurement files now archive the items they make when they end.

**Checks run in the VM (24-11-2026 IST, after the last change):**
- `pnpm typecheck`: passes. `pnpm lint` (whole repository): passes. `pnpm copy-lint`: clean. `pnpm db:docs`: regenerated.
- `pnpm test`: all packages pass:
  - contracts 322
  - db 161
  - domain 2,595
  - web 1,210 (1 skipped)
  - ui 107
  - tokens 146
  - voice 49
  - voice-agent 23
  - copy-lint 17
- `pnpm test:security`:
  - **db:** 1,717 of 1,717.
  - **domain:** 1,447 of 1,447.
  - **web:** 459 of 460. The one failure is `demo-data.test.ts` "puts the items, kits and prices…", and it is not this round's code: it fails the same with `run-command.ts` as it was at `b82b2aa2`. The test reads a price list's first 200 items by name, and this database has had about seven full runs today. 206 active items are left, nearly all from other suites (`Catalogue…` 80, `sizing` 20, `screen-lists` 20), and the demo set's 9 push its pump past 200. My two files had added 27, now archived. A fresh database, as CI uses, starts empty.
- `pnpm --filter web build`: passes.
- `pnpm --filter web js-budget`: every page within budget except `/procurement` (226.8 kB against 200), as H1 says.
- Document link check: the same one finding, `ORPHAN docs/runs/phase3/u1-vendors.md`, in the lead's run list.

**Not run here (sign-in is refused in this environment):**
- `apps/web/e2e/procurement.spec.ts`, 7 tests in each project:
  - the Inventory Manager adds, records and compares;
  - the Inventory Manager sees both seeded quotes on the managers' vendor (M1);
  - the Inventory Manager's dialogs journey (L6);
  - the Executive's group quote that starts later (L6);
  - the General Manager and the Store Manager see no rate and get the not-found screen;
  - the Executive's comparison screenshot.
- Also not run: their axe checks and the Linux baselines `procurement-vendors`, `procurement-vendor-sheet-no-rates` and `procurement-compare`. The spec and seed typecheck and lint clean.
- **Effect on the baselines:** the seeded group and company-1 quotes (M1) add the cables vendor's group cable quote (₹74.00) to the snapshot company's comparison data. That cell keeps its cheaper company-3 quote (₹72.50), so the Lowest marks there do not change.

**For the lead at integration:**
- **Migrations:** now 0229 to 0236. The new ones are 0234 (group quote documents), 0235 and 0236 (import undo).
- **Shared code touched in this round:** `run-command.ts` (L10), `catalogue/item-picker.tsx` (optional `error`), `imports/*`, `commit-job.ts`, `rollback-job.ts`, `preview-job.ts`, `audit.ts` (`restored`), `en.json`, `e2e/setup/procurement.ts`. The `files` matrix rule is in `role-entity-matrix.test.ts`.
- **Still needs the owner's `checks-ok`:** `js-budget.json`, including the `/procurement` value above.

## Lead's journey run (before integration)
Lead, 24-11-2026, on the PC, on the branch before `main` is taken in (it waits for H1, so the import kinds of C5, H1 and U1 meet in one merge). The whole journey suite ran once on a fresh database: 597 passed, 21 skipped; only `procurement.spec.ts` failed. Fixed:
- the Item and Company labels also matched longer labels (the vendor's item code, the preferred checkbox, the company switcher): now exact;
- the vendor sheet's phone and email links failed axe's contrast in dark (`text-accent`, 4.03 to 1): now `text-accent-text`, as every other link (a product fix);
- the comparison is items down, vendors across, and earlier runs' vendors quote the same rate for the same item: the rate is asserted once.
`procurement.spec.ts`: 36 of 36 in desktop-light, desktop-dark and phone. No Linux baseline made yet: they are made after the merge with `main`.

## Integration
Lead, 24-11-2026, on the PC.
- **Merge with `main`** (C5 #286 and H1 #287), commit 3e243c17. The import kinds of C5 (`items`), H1 (`opening_stock`) and U1 (`vendors`) meet in the contracts, the schema, the wizard, the rows grid, the new-import page and the preview, commit and rollback commands: each carries all three, and the rollback's branch order is vendors, items, then the rest. The `sameAsRow` finding keeps both its `items` and `vendors` branches.
- **Migrations** renumbered to 0232 to 0239. After renumbering, 0236's kind and created-type checks were edited to keep C5's `item` and H1's `opening_stock` and `stock_movement`; 0234's purpose check and 0235's `app.file_purpose_grant()` already held `main`'s latest. `pnpm db:generate` reports no changes.
- **Journeys:** H1 and U1 each added `inventoryManager`; one user is kept (H1's name), used by both `inventory.spec.ts` and `procurement.spec.ts`.
- **`integrate.sh`** on a fresh database: every step passed. Security suite db 1,785, domain 1,519, web 461; unit tests domain 2,806, web 1,239 (1 skipped), contracts 340, db 161, tokens 146, ui 107, voice 49, voice-agent 23, copy-lint 17; `procurement`, `imports` and `inventory` journeys 66 passed in the three projects; `/procurement` 227.6 kB within its 239.
- **Baselines** made one project at a time, each on a fresh database (`e2e:snap -- --project=<p> --update-snapshots=changed`): the procurement pictures (three per project) and the screens whose menu mask the Procurement item lengthens (14 per desktop project, 3 on phone). desktop-light 225 passed and 1 flaky, desktop-dark 213 and 3 flaky, phone 215 and 1 flaky. The verification run without updating is CI's on the pull request, not run locally.
- **#288's first CI run** failed twice, neither in U1's code: C5's `item-import.test.ts` read its update and create audit rows `order by created_at`, which one commit transaction writes at one time in either order (now compared as a set, and its barcodes no longer form a phone number the redactor masks); and `imports-job` in desktop-dark was taken with the "We read 3 rows" notice still fading (the journey now waits for it to close; the three projects' `imports-job` remade with `--update-snapshots=all --grep`, and phone's `imports-upload` with it, then verified without updating on fresh databases).
