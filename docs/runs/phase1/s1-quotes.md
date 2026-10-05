# S1 Quotes (wave 3)

| | |
|---|---|
| Branch | `feat/s1-quotes` on GitHub, from `main` at #103 |
| PC worktree | `s1-quotes`, slot 13: Postgres 54343, app 3043 (`bash tools/integration/setup-worktree.sh s1-quotes feat/s1-quotes 54343 3043`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026) |
| State | built |
| Next step | review |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.3](../../design/phase1.md#73-s1-quotes), §11 (workshop defaults) and §12
- BLUEPRINT §8.3 (quote validations and validity), §3 (prices only from Price Master tiers, no discounts; tax only from the engine; LLMs never do this math)
- PRD SAL-03, SAL-04, RPT-03 (quote numbers in ⌘K)
- ADR 0007 (the tax engine), ADR 0009 (print), ADR 0021 (people record the sizing a quote relies on)
- The quote state machine `packages/domain/src/state-machines/machines/quote.ts` (guards `sizingComplete`, `pumpCurveInBounds`, `dcrRuleMet`)
- C1's catalogue, price lists and tax (`packages/domain/src/tax`, the price list commands and reads)
- C4's `quoteSizingFacts()` and `latestSizing()`
- P4's print module: the quote template and loader data, the document-type registry in `apps/web/src/print/documents.ts`, `files.document.record`, the purpose `quote_pdf`
- The workshop pack (SALE-1, PRICE-1, PRICE-3)
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Workshop defaults**, added to `packages/domain/src/workshop-defaults.ts`, each named under its question, flagged in `docs/phase0/exit-gate-actions.md` and design §11, and never presented as a client fact:
   - the document number format (SALE-1);
   - the customer type to price tier map (PRICE-1);
   - kits priced as a fixed kit price (PRICE-3).
   Where the workshop pack proposes a default, use it; where it does not, stop and report rather than invent one.
2. **Tables**, each with RLS (a child of the lead and the company), fixture rows, matrix rules, `app_reader` and the testing lists (AGENTS §6):
   - `quotes`: `entity_id`, `quote_no` (unique per company), `opportunity_id`, `account_id`, `site_id`, `sizing_id`, `tier_id`, `price_list_id`, `valid_until`, `state`, `round_off`, totals, `pdf_file_id`, `supersedes_id`;
   - `quote_lines`: item or kit, `qty`, `unit_price`, `hsn`, `tax_rate_id`, `composite_rule_id`, taxable, goods and services parts, CGST, SGST, IGST, line total;
   - `quote_versions` (`snapshot_json`);
   - a per-company, per-financial-year number series that takes no gap under concurrency.
   Money is `numeric(14,2)` and integer paise inside the domain.
3. **Commands**, each with denied, wrong-company and happy-path tests and the agent refusal sweep:
   - `sales.quote.create`:
     - the tier comes from the customer type through the default map;
     - prices come only from the live price list for that tier and company, and a price in the input is refused (SAL-03);
     - tax comes from the engine, with each line's rate version and the solar 70:30 composite supply where it applies, and place of supply from the site;
     - validity is the default 15 days;
     - the number comes from the series;
     - it is refused when the sizing is missing or out of bounds, or the pump curve or DCR rule fails (SAL-04, through the machine's guards and C4's facts).
   - `sales.quote.send`: needs the PDF. Rendering goes through P4's worker, with the quote registered as a document type (loader, template, attach command `quotes.pdf_file_id`).
   - `sales.quote.expire`: run by a daily QStash job as `system:workers`, with only the grant it needs (a platform-only permission like `crm.score.refresh`, never a person's `sales.*`). A read shows a lapsed quote as expired.
   - `sales.quote.requote`: supersedes the quote at current prices.
   - `sales.quote.withdraw`.
4. **Screens:**
   - the quote builder from a lead, and `/quotes` (list, keyset, `EXPLAIN` under RLS);
   - the quote page (its PDF, send, re-quote, withdraw);
   - quotes on Account 360;
   - ⌘K finds quote numbers (RPT-03);
   - board cards show kW or HP and time in stage (STATUS follow-up).
   Each with journeys and axe, copy in `en.json`, and the JavaScript budget.
5. **Tests:**
   - property tests on the totals: sum of lines, rupee rounding, intra-state CGST and SGST against inter-state IGST, and composite supply;
   - fixtures for the guards;
   - the print snapshot of a real quote (P4's `print-quote` template with real loader data).
6. **Documents:** DATABASE, SECURITY (the new permissions and the worker's grant), API (the expire job), DEPLOY (its schedule), design §7.3 "Built (S1)", `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a journey takes a sized lead to a sent quote with its PDF locally (the in-process render).

Not in S1: orders, acceptance and credit (S2); stock availability (Phase 3); any tax rate value, price or number the client must give. The tax rates and price lists stay empty until the client gives them; tests and journeys use clearly synthetic fixtures.

## Report
### 05-10-2026, builder on the PC
- Brief items 1 to 6 are built from 795154e. Before building, the builder stopped: the workshop pack proposed no default for SALE-1 or PRICE-1. The owner then decided on 05-10-2026, and the decisions are recorded in DECISIONS, design §7.3 "Built (S1)", design §11, exit-gate action 16, and the "Today" lines of the workshop pack for SALE-1 and PRICE-1:
  - SALE-1 is the pack's first example, `<company code>/Q/<year>/0001`. It lives in `WORKSHOP_DEFAULTS.numbering`, which `documentPrefix()` and `formatDocumentNo()` read. The series is Phase 0's `document_sequences`, so no new series table was added.
  - PRICE-1 has no map (`tierByAccountType: {}`). A quote takes the customer's own `accounts.tier_id`, which an Executive sets with the new `crm.account.tier.set`.
  - PRICE-3 is fixed kit prices (`kitPricing: 'fixed'`).
  - The schedule id is `quote-expire-${BOS_ENVIRONMENT}`.
- Migrations:
  - 0101, generated: `quotes`, `quote_lines` and `quote_versions`.
  - 0102, custom: RLS, column grants, the append-only triggers, `app.platform_only_permissions()` with every existing key plus `sales.quote.expire`, the definers and the trigger `accounts_tier_guard`.
  - The definers are `app.lapsed_quotes()`, `app.expire_quotes()`, `app.quote_for_print()`, `app.attach_quote_pdf()` and `app.quote_search_ids()`.
  - The lead renumbers both at the merge.
- Domain:
  - Seven commands: `sales.quote.create`, `.send`, `.requote`, `.withdraw`, `.expire`, `.pdf.attach` and `crm.account.tier.set`.
  - The pure `priceQuote()` (`packages/domain/src/sales/quote-pricing.ts`) and `saveQuote()`.
  - The reads `buildQuote()` (shared by create, re-quote and preview), `readQuote()`, `listQuotes()`, `accountQuotes()`, `getQuote()`, `searchQuotes()`, `loadQuoteBuilder()`, `previewQuote()`, `loadQuoteForPrint()` and `listPriceTierOptions()`.
  - The quote machine is now stored (`stored`, each move's event). `send` needs a validity that has not passed, and `expire` and `requote` also start from a draft.
  - Board cards carry `stageSince` and `size`. Account 360 carries the tier, `canSetTier`, `canQuote` and the customer's quotes.
  - The seeded random generator moved to `src/seeded-generator.ts`, and the sizing property tests use it.
- Contracts:
  - `commands/sales/quotes.ts` and `dto/quote.ts`.
  - The permission `sales.quote.expire`: platform-only, in `SYSTEM_MATRIX` and in the seed.
  - Five events, `sales.quote.created`, `.sent`, `.superseded`, `.withdrawn` and `.expired`; `print.document.requested` now also comes from create and re-quote.
  - `QuoteExpireWorkerBody` and `QuoteExpireWorkerResponse`. The palette search now answers quotes.
- Web:
  - Pages: `/quotes`, `/quotes/new?company=&lead=` (the builder, from Make a quote on a lead) and `/quotes/<company>/<quote>` (lines, totals, the document polled for until printed, Mark as sent, Re-quote, Withdraw).
  - Account 360 gains the price tier with its dialog, Make a quote, and a Quotes section. ⌘K finds quotes by number. Board cards show HP or kWp and the time in the stage. The menu gains a Quotes item.
  - Printing: the registered document type `quote` (loader, template, attach). `print/words.ts` writes amounts in words, and the template prints without a QR code or a per-rate tax line when given none.
  - The worker `/api/v1/workers/quotes/expire` and its schedule in `qstash-schedule.ts`. Named JavaScript budgets for the three quote pages. All copy is in `en.json`, and `copy-lint.config.json` lists the new button keys.
- Documents: DATABASE (definers, append-only list, §6.4, `accounts`), SECURITY (§3.1, §3.2, §3.3 and the quotes paragraph), API §3.6, DEPLOY §2 step 6, design §7.3 and §11, DECISIONS, the exit-gate actions, the workshop pack, README and TESTING (the spike command). `pnpm db:docs` and `machines:docs` were regenerated and leave no change.
- Tests added:
  - Domain unit: `quote-pricing.test.ts` with 11 tests, 4 of them property tests on the totals (sum of lines, rupee rounding, CGST and SGST against IGST, the composite split); quote machine fixtures for the tier, list and lapsed-send guards; 1 board unit test in web; `print/words.test.ts` with 14 cases (amounts in words, Indian style).
  - Real Postgres:
    - `packages/domain/tests/commands/quotes.test.ts`: 18 tests (denied, wrong-company and happy paths for each command, SAL-03, SAL-04, expiry as `system:workers`, the tier, the reads).
    - `packages/db/tests/security/quotes.test.ts`: 14 tests (policies, append-only, definers, the tier trigger).
    - In existing tests: the quote tables in the role × company matrix, NARROWER, enum-sync and the reader-definer list; the agent sweep (`crm.account.tier.set` as restricted, customer-write and people-only; `sales.quote.expire` and `.pdf.attach` as platform-only); reader parity; 1 board query test.
    - Web: 2 quote tests in `pdf-render.test.ts` and 8 in `quote-expiry.test.ts`.
  - Journeys:
    - `e2e/quotes.spec.ts`: a sized lead to a sent quote per project (the tier set, the builder, the preview, the quote made, the PDF printed in process and fetched, sent, found in ⌘K, re-quoted, withdrawn); the snapshot company's list, quote page and builder screenshots; Account 360's quotes; the board's kWp; a tele-caller without the screen.
    - `print.spec.ts`: `print-quote-real`, the quotation printed by the seed from its real quote with the real loader.
  - Seed: `e2e/setup/quotes.ts` adds a tier of its own ("Journey prices"), two items with item rates and two lists, with test values only.
- Checks, one at a time against Postgres on 54343 (the PC ran at 100 % CPU and about 400 MB free for long stretches, under other agents):
  - `pnpm typecheck`: 8 successful, 8 total.
  - `pnpm lint`: no warnings or errors (the full run at the end).
  - `pnpm copy-lint`: catalogues and templates are clean.
  - Unit tests: 2,771 passed (tokens 134, contracts 177, ui 105, copy-lint 17, db 121, domain 1,573, web 644).
  - `pnpm test:security`:
    - db: 966 passed in 31 files, in the first full run and again in the last.
    - domain: 626 of 627 in the last full run. The one failure, `screen-lists.test.ts` > `listPrices` paging, was a 20 s timeout under load; the file passes alone (8 of 8).
    - web: 239 of 239 when run on its own after the domain run.
    - Earlier full runs under load had 20 s timeouts in unrelated files, each of which passed when run again. The only real failures were in tests this slice had changed the shape for (the board card's keys, reader parity, the palette's answer), and they are fixed.
  - `pnpm build`, then `pnpm --filter web js-budget`: every page is within its budget (32 pages: `/quotes` 225.5 kB, the quote page 208.9 kB, the builder 194.6 kB, Account 360 195.7 kB).
  - Journeys, on Windows (not Linux baselines), `e2e/quotes.spec.ts` and `e2e/print.spec.ts`: 29 passed and 2 flaky, exit 0. Both flaky tests were on desktop-dark and passed on retry: a page load past 30 s, after which those waits were raised. 10 were skipped (the print templates run on desktop-light only).
- `EXPLAIN (ANALYZE, BUFFERS)` under RLS (`pnpm --filter @shakti/domain spike:quotes`: 20,000 quotes on 2,000 leads in company 2, 200 of them the Lead Converter's):

  | Query | Plan | Time |
  |---|---|---|
  | `/quotes`, Executive, company 2 | Index Scan Backward on `quotes_entity_created_idx` | 2.9 ms |
  | `/quotes`, Executive, every company | Index Scan Backward on `quotes_created_idx` | 2.1 ms |
  | `/quotes`, GM, sent | Index Scan Backward on `quotes_entity_created_idx` | 6.7 ms |
  | `/quotes`, Lead Converter (own) | Index Scan Backward on `quotes_entity_created_idx` | 9.5 ms |
  | ⌘K, a full number | `quotes_pkey` over `app.quote_search_ids()` candidates | 18.0 ms |
  | ⌘K, a serial, Lead Converter | `quotes_pkey` over `app.quote_search_ids()` candidates | 3.5 ms |
  | Account 360's quotes | Bitmap Index Scan on `quotes_account_idx` | 0.8 ms |
  | Board: time in stage, 50 cards | the activities partitions' `(opportunity_id, created_at, id)` indexes | 0.5 ms |
  | Board: size, 50 cards | Bitmap Index Scan on `sizings_opportunity_kind_latest_idx` | 0.2 ms |

  Before the search definer, ⌘K was a sequential scan of every quote under the policies (225 ms at 20,000 quotes), because `ilike` is not leakproof. That is why `app.quote_search_ids()` was added, following the lead search's pattern.
- Decisions the brief did not settle:
  1. `crm.account.tier.set` takes `pricing.write:all` plus `crm.account.write:own`, and is people-only. `pricing.write` is Executive-only. `crm.account.write` alone would let callers move their own customer to a cheaper tier. A database trigger enforces the same rule.
  2. A kit has no HSN, so a kit line is taxed only as a works contract by the composite rule (rooftop and EPC). Any other kit line is refused with `quote_kit_tax_missing` rather than taxed at a guessed rate. Pump sets sold as kits under `farmer_pumps` therefore cannot be quoted as kits until the CA says how they are taxed (PRICE-4); their items can be quoted one by one. The owner decided this on 05-10-2026 (DECISIONS): a kit is quoted only as a works contract in the composite segments, and any other kit, farmer pump sets included, is quoted item by item until the CA gives the kit's tax rule (PRICE-4).
  3. A works contract is a per-line choice in the builder, offered only in the composite segments.
  4. The live list is the company's own approved list of the tier in force today, else the group's. A quote is priced from one list only, and an item missing from it is refused.
  5. Quote creation is not people-only, because the sizing agent holds `sales.quote.create` (SECURITY §3.3). It reads no lead, so it cannot make one today.
  6. Display state: a draft or sent quote past its validity reads as expired.
     - The machine's `send` now refuses a lapsed quote; `expire` and `requote` also start from a draft.
     - The daily job runs at 00:05 IST in batches of 500 and stops after 40 s (the rest goes the next day), with no hand-over.
  7. Versions: version 1 is written when a quote is made, and version n+1 of the old quote when a re-quote replaces it. Withdrawal takes a free-text reason of up to 300 characters, kept on the quote.
  8. The PDF's file id is the event id of the print request, so a repeated delivery attaches nothing new. A quote is printed once, after it is made, and there is no "print again" command. If printing fails for good, the quote page says the document is late; the event's dead letter can be sent again from Integration health.
  9. The quotation prints the site's address and the customer's GSTIN, but no phone number and no QR code; the QR returns when customers have a quote page (Phase 2).
     - The state of supply is printed in words from a new `print.states` list of the statutory GST state codes.
     - The only term is the validity date, because the client's payment and delivery terms are not given.
  10. `/quotes` and the quote page open with `crm.lead.read` at own scope, as quotes are read with their leads (review M2); the builder needs `sales.quote.create` as well.
  11. Board cards: the time in the stage comes from the lead's last `stage_moved` timeline row (no new column). Design §3 gives D1 the board in wave 3, so the change is kept to the board's read and the card's one line.
  12. Account 360: a person with no `pricing.read` sees no tier name.
  13. Test data: quote tests run in company 2, because the catalogue fixture resets company 1's quote series. The journeys use company 2 and the snapshot company, with the seed's own tier and lists.
  14. The P4 template's `link` and a tax line's `rate` are now optional.
- Not done or uncertain:
  - The Linux baselines and the integration run, which are the lead's. These baselines change: `catalogue-items` and `tax-rates` (the two journey items and their rates), `price-master-executive` (the journey tier's lists), `leads-board` (the card's new line), and possibly `customer-account` and `customer-sizing` (the tier row, Make a quote, the Quotes section). New baselines: `quotes-list`, `quote-page`, `quote-builder` and `print-quote-real`.
  - Hosted PDFs wait on the owner's AWS files stack (integration note 1).
  - The QStash schedule must be run on each hosted environment with `BOS_ENVIRONMENT` set.
  - D1 changes the same schedule script, so the merge of `apps/web/scripts/qstash-schedule.ts` needs care: the environment check and the import list.
  - A `turbo` run during this build wrote its managed "agent rules" block into `AGENTS.md`, and a work-in-progress commit picked it up. The last commit restores `AGENTS.md` exactly as on `main`, but any later `turbo` command may add the block again. Setting `"agentGuidance": false` in `turbo.json` would stop it; that change is the lead's to make, and other worktrees may show the same block.

### 05-10-2026, builder on the PC (review fixes)
- Fixes, in dc384172 (code and tests) and 49a91999 (documents); each Review row's State names its commit:
  - H1: migration 0103 adds the select policy `files_quote_pdf_read` on `files`: a `quote_pdf` file of a company in the request is read when a quote the caller reads names it, so own and team scope open their own quotes' documents. `files_read` is unchanged for every other file.
  - M1, L1: 0103 replaces `app.quote_search_ids()`. It joins the quote's lead and keeps only leads the caller reads (company scope, the caller's team or their own, as `app.lead_search_ids()` does) before the limit, and escapes a backslash, a percent sign and an underscore as `containsPattern()` does.
  - M2: the quote screens open for lead readers. `/quotes` and the quote page need `crm.lead.read` at own scope (the menu item and `navRequires('quotes')`), and the builder `/quotes/new` needs `sales.quote.create` as well. Mark as sent, Re-quote and Withdraw already follow their own permissions, so the CC, Accounts and the Project Manager can now open the quotes that ⌘K and Account 360 show them.
  - M3: one test covers send, withdraw and re-quote. An own-scope colleague gets `quote_missing`. A GM of company 1, and a caller who names company 1, are refused. The workers principal of company 1 attaches nothing to a quote of company 2.
  - L3: a line takes at most 100,000 (`QUOTE_MAX_QTY`, refused when the input is checked). `priceQuote()` refuses a line or grand total past twelve digits of rupees with `validation_failed` and the catalogue reason `quote_amount_too_large`, in the preview and when the quote is made.
  - L5: `quotes.page.pdfLate` now says to ask an Executive to send the document again from Integration health if it is still missing after a few minutes.
  - L6: `crm.account.tier.set` takes the page's `entityId`. It records the audit row in that company and writes a `customer_updated` row (`{ changed: 'tierId' }`) to the customer's timeline there. The Account 360 form and the e2e set-up pass the company.
  - L7: the tier test now checks the trigger's message (`/pricing\.write/`).
  - L4: the PRD §8 rows for SAL-03, SAL-04, SAL-05 and RPT-03 now name S1's tests.
  - The owner's kit rule is the DECISIONS row of 05-10-2026 (decision 2 above).
  - DATABASE, SECURITY and design §7.3 describe the PDF read, the scoped candidates, the menu rule and the amount limit. `pnpm db:docs` was rerun for the new policy.
  - L2 and L8 are left as the lead asked; their States say why.
- Tests added or changed:
  - Domain `tests/commands/quotes.test.ts`: 2 new (the quantity and amount limits; every state change refused to a colleague and to another company, with attach for another company's worker), and 2 strengthened (L6 and L7). Now 20 tests.
  - Db `tests/security/quotes.test.ts`: 4 new (the document read with its quote; not read through a quote that names another file; the candidates kept to the caller's leads with 205 newer matches of a colleague; the backslash, percent and underscore). Now 18 tests.
  - `src/sales/quote-pricing.test.ts`: 1 new (an overflowing line and grand total). Now 12 tests.
  - `apps/web/src/nav.test.ts`: the own-scope lead reader now sees Quotes. `agent-refusals.test.ts` and the e2e set-up pass `entityId` to the tier command. `e2e/quotes.spec.ts`: the tele-caller now opens `/quotes` (axe), and gets not-found on `/quotes/new`.
- Checks:
  - `pnpm typecheck`: Tasks: 8 successful, 8 total.
  - ESLint on `packages/contracts`, `packages/domain`, `packages/db` and `apps/web` with `--max-warnings 0`: clean.
  - `pnpm copy-lint`: catalogues and templates are clean. Prettier on the changed code files: all use Prettier code style.
  - Unit: `quote-pricing.test.ts` 12 passed; `nav.test.ts` 10 passed.
  - Affected security files alone: db `quotes.test.ts` 18 passed; domain `quotes.test.ts` and `agent-refusals.test.ts` 69 passed.
  - `pnpm test:security`, once, while the D1 builder was also running on the PC:
    - db: 1 failed, 969 passed (970). The one failure was the new document test at its 20 s limit (20,006 ms); `quotes.test.ts` alone passed 18 of 18.
    - turbo then stopped, so the domain and web suites ran next on their own.
    - domain: 29 failed, 565 passed, 35 skipped (629); web: 5 failed, 234 passed (239). Every failure was a time limit or a `CONNECT_TIMEOUT` to 54343.
    - Each failed file was rerun alone, and all passed: crm-pipelines 22, lead-flows 6, lead-guard 24, tags 11, tax 11, search 16, search-equivalence 19, reader-parity 8, actions 41, realtime-token 6, saved-views 3.
    - tax, search-equivalence, reader-parity and actions needed a second solo run. The first actions rerun found the field engineer role left short by the aborted run's role test, which that rerun's own clean-up restored.
  - `reader-parity`'s Executive case takes about 12 s alone, now that it also reads the quote queries, so it has little room under its 20 s limit when the PC is loaded.
- Not done:
  - The H1 journey as a non-Executive. No seeded non-Executive owns a quote, and the seeded team lead has no team; H1 is covered on real Postgres as an LC, a team lead and a GM.
  - The build, the JS budget and the journeys were not rerun after the fixes. The menu change alters the tele-caller's menu, so the menu baselines change at the lead's baseline run.
- Decisions:
  - M2: open the quote screens to lead readers, rather than hide quote hits from those without `sales.quote.create`. Quotes are read with their leads, and every action on the page already checks its own permission.
  - The quantity limit of 100,000 a line is a sanity bound, not client data: it only stops a typing slip from overflowing `numeric(14,2)`.

## Review
### 05-10-2026, review of 9f13b654..45fafe0a
| # | Severity | Finding | State |
|---|---|---|---|
| H1 | High | A Lead Converter or Sales Team Lead cannot open the PDF of a quote they made. The render worker records the `quote_pdf` file, so `created_by` is `system:workers`. `files_read` (0066, lines 41 to 47) passes a `quote_pdf` only at `crm.lead.read:entity`, or at `:own` for the file's creator. `openFile` (`apps/web/src/actions/files.ts:108`) reads under that policy, so "Open the document" on the quote page (`quote-screen.tsx:207`) answers `file_missing` for everyone below GM. Reproduced on 54343: the quote is visible to its own-scope maker, and its file is not visible at own or team scope, only at entity scope. The journey passes only because it runs as an Executive. Fix: let the file be read through its quote (a `files_read` branch for `quote_pdf` where a quote the caller reads names the file, or a quote PDF read that goes through the quote's policy), and add a test as an LC and a team lead | fixed in dc384172 (0103 `files_quote_pdf_read`; db tests as an LC at own scope, a team lead and a GM) |
| M1 | Medium | `app.quote_search_ids()` (0102:305-320) answers the 200 newest matching quotes of the request's companies before any lead scope is applied, and `searchQuotes()` then filters them under RLS. A Lead Converter who types part of a number (`SMP/Q/2026-27/00`, `2026-27`) gets the company's 200 newest matches, mostly colleagues' quotes, and their own older quote is missing. `app.lead_search_ids()` (0052) applies the caller's scope inside the definer for this reason. The spike measured time only. Fix: join `opportunities` in the definer and keep only leads the caller reads (`crm.lead.read` own, team or entity, as in 0052) before the limit; test with more than 200 matching quotes of other people | fixed in dc384172 (0103 scopes the candidates before the limit; db test with 205 matches of a colleague) |
| M2 | Medium | Quote links reach people who cannot open them. ⌘K (`actions/search.ts:30`) and Account 360 (`customers.ts:513`) list quotes for `crm.lead.read:own`, but the quote page and `/quotes` need `sales.quote.create:own` as well (`navRequires('quotes')`). CC, Accounts and Project Manager hold `crm.lead.read` without `sales.quote.create` (SECURITY §3.2), so the quote numbers they find lead to the not-found screen. Fix: open the quote page with `crm.lead.read:own` (the actions already follow `canSend`, `canRequote` and `canWithdraw`), or show quote hits and rows only to callers who may open the page | fixed in dc384172: `/quotes` and the quote page open with `crm.lead.read:own`, the builder needs `sales.quote.create` as well |
| M3 | Medium | `sales.quote.withdraw`, `sales.quote.requote` and `sales.quote.pdf.attach` have no wrong-company test, and send, withdraw and requote have no test for an own-scope colleague (`otherLc`) on someone else's quote (`packages/domain/tests/commands/quotes.test.ts:533-658`). AGENTS §10 asks for denied, wrong-company and happy-path tests for every command. Fix: add `gm1` or `{ entityId: 1 }` cases for each, an `otherLc` case answering `quote_missing`, and `workers(1)` for attach | fixed in dc384172 |
| L1 | Low | The backslash escape in `app.quote_search_ids()` does nothing: `replace(coalesce(p_text, ''), '\', '\')` (0102:308) replaces a backslash with itself (0052 uses `'\'`). A typed `\` becomes an escape character in the candidate pattern, so the candidates disagree with `containsPattern()`. Fix: replace with `'\'` | fixed in dc384172 (0103; db test for a backslash, a percent sign and an underscore) |
| L2 | Low | An expiry batch writes one audit row with a made-up aggregate (`quote_expiry_batch`, `expire-quotes.ts:87`), so a quote's own Activity log never shows that it expired, while send, withdraw, re-quote and attach audit the quote. This follows the rescoring's batch row. Fix: one `ctx.audit()` per expired quote (`aggregateType: 'quote'`, before and after state) | left: follows the rescoring's batch audit row (lead's instruction) |
| L3 | Low | A quantity is limited only by `QuantitySchema` (up to 999,999,999.999). Quantity times the list price can go past `numeric(14,2)`: the preview shows the amount, but making the quote fails with a numeric overflow, shown as the internal error. Fix: a sensible quantity limit in `QuoteLineInput`, and a check in `priceQuote()` with a catalogue reason | fixed in dc384172 (at most 100,000 a line; `quote_amount_too_large` past twelve digits of rupees) |
| L4 | Low | PRD §8 still traces SAL-03 to the machine and numbering tests only, SAL-04 to "—", and RPT-03 and SAL-05 without S1's tests. Fix: add `packages/domain/tests/commands/quotes.test.ts`, `packages/db/tests/security/quotes.test.ts`, `packages/domain/src/sales/quote-pricing.test.ts` and `apps/web/e2e/quotes.spec.ts` | fixed in 49a91999 |
| L5 | Low | When printing fails for good, the quote page says to refresh in a minute (`quotes.page.pdfLate`). A seller has no way forward: the quote cannot be sent until someone sends the dead letter again from Integration health. Fix: copy that says whom to ask once the wait has run out | fixed in dc384172 |
| L6 | Low | `crm.account.tier.set` writes its audit row with no company and nothing on the customer's timeline. Other customer changes on Account 360 are written to the timeline of the company they are made from (DATABASE `accounts`). A change that moves every price the customer is quoted is hard to find afterwards. Fix: write the timeline row in the company of the page, as `crm.account.update` does | fixed in dc384172 |
| L7 | Low | The tier test accepts any error for the direct `update accounts set tier_id` (`quotes.test.ts:744`, `toBeInstanceOf(Error)`), so a policy refusal would pass in place of the trigger. The db suite checks the message. Fix: match `/pricing.write/` | fixed in dc384172 |
| L8 | Low | Outside the slice, surfaced by it. The script now says one QStash account serves dev and staging, and DEPLOY step 6 runs it for each environment, but `outbox-publish` and `lead-rescore` keep fixed ids (`qstash-schedule.ts:16-17`). Whichever environment runs it last takes both schedules. Fix: decide whether the minute and nightly schedules belong to one environment (accounts.md says the minute schedule is staging's), and name or document them to match | left: the D1 slice changes those schedule ids |

## Integration notes
1. Hosted PDFs wait on the owner's AWS files stack, as P4's do.
