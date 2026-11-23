# U1 Vendors and supplier quotes (wave 1)

| | |
|---|---|
| Branch | `feat/u1-vendors` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 23-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): supplier rates behind `procurement.rate.read`, row security |
| Usage | 5-hour window 4 % at 18:00 UTC when briefed; builder on Opus 5.5 at high effort from start to done (the builder's session reports `claude-opus-5-5`, high effort, at the start and at done, 23-11-2026 and 24-11-2026 IST) |
| State | done |
| Next step | the lead's review, the journeys and Linux baselines on the PC, then integration |

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
  - **domain:** DOMAIN_RESULT
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
