# Audit fixes: sales integrity (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-sales`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-sales`, slot 5: Postgres 54335 (container `shakti-pg-audit-sales`), app 3035 |
| Runs on | cloud, beside M1 and the web audit fixes (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (credit, orders, commissions, tax rates, row-level security): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted; the owner said to proceed (12-10-2026) |
| State | integrated with `main` (#167 to #172), migrations 0143 to 0148; pull request open |
| Next step | the owner's duplicate-acceptance query on dev and staging; then the `hold` label off, merge on green, `migrate-hosted` (0143 to 0148), and the owner validates the two widened quote checks |

## Brief
The Phase 0–1 audit of 12-10-2026 confirmed these defects by running the real commands as `app_user`. Each finding's evidence, file and line and proposed fix are in the auditor's file and the verifier's verdict (read both first; the verdict corrects several of DOM-1's line references and adds DOM-V1), and the verifier's reproduction scripts show the exact paths:
- `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/3-domain.md` and `3-domain.verdict.md`
- `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/verify/dom1.mts` … `dom5.mts` (with `harness.mts`, `fixtures.mts`)
- `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/1-security.md` and `1-security.verdict.md` (SEC-4), `6-arch.md` (ARCH-5)

Fix, each with a test on real Postgres that fails before the fix (turn the verifier's scripts into tests where they fit):
1. **DOM-1 (high):** a change of a customer's type to or from `dealer` is refused to everyone but the holder of the credit permission at the company (decide the exact permission from `packages/contracts/src/permissions.ts` and state it), in the command with a catalogue reason and in the database by a trigger; the order snapshots the customer's type at creation and the confirm runs the dealer credit check on the snapshot, so a type change between hold and confirm cannot skip it; the quote, sizing and signed-acceptance gate for non-dealers likewise reads the snapshot. A type change must not move a customer between price tiers silently either (today the tier-by-type map is empty; make the rule hold when the workshop fills it).
2. **DOM-4 (medium):** accepting a quote is refused when another quote of the lead is accepted (a partial unique index on `quotes(opportunity_id) where state = 'accepted'`, mapped in `constraintReasons`), and the lead's other draft and sent quotes are withdrawn or superseded in the same transaction; no second order or second commission can follow.
3. **DOM-2 (medium):** a lead merge never strands a quote or an order: refuse the merge while the merged lead has a live quote or an order not cancelled (a catalogue reason), or move them to the kept lead; choose the safer and state why.
4. **DOM-3 and DOM-V1 (medium):** an import rollback keeps (and counts as kept) every lead and customer that has since got a quote, an order, dealer terms, an outstanding entry, a call or a change by someone other than the importer.
5. **DOM-5:** a cancelled order no longer shows or counts as held for credit.
6. **DOM-6:** calling hours are checked on the call's start (`startedAt`), with a short stated grace for logging after 21:00 a call that started in hours, and a start before 09:00 IST refused; the stored start time is the call's real start.
7. **DOM-7:** recording a bounded GST rate or composite rule inside an open-ended one never leaves a gap (insert the continuation, or refuse with a sentence asking for the rate after it).
8. **ARCH-5:** dealer exposure and its overdue test worked out in one place that all three readers call, following the SALE-5 setting.
9. **SEC-4 (low):** the write policies on leads and the timeline allow only what the commands do (a lead cannot be pointed at a customer the writer cannot already reach; the timeline insert rule narrowed), with security tests in the role × company matrix.

Not here: DOM-8 (the kW behind commissions and targets) waits for the database follow-ups (`fix/followups-db`, which changes `commission_accruals`) to merge. Anything M1 builds (`feat/m1-migration-uat`: import reconciliation, anonymisation — it also edits `packages/domain/src/queries/imports/import-queries.ts`; keep your import-rollback change to the rollback code) and the web audit fixes (`fix/audit-web`: screens, the session, ⌘K order search, enquiry routing). Shared lists are append-only.

Done when: the checks of AGENTS §10 pass on the branch; the security suite passes on the slot's Postgres; every verifier script's path is now refused or behaves as the brief says.

**Migrations:** start at 0134 (other branches hold 0130 to 0133 for now; the lead renumbers at the merge). Every redefined function or check from `main`'s latest version.

**Early check:** when the migrations, triggers, the index and the command changes are committed with their tests passing, commit, write a short report and stop; the lead reads that diff before the rest.

**How to work:** commit at least every 20 minutes and after each finding; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files; the whole-repository lint once, last. Other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash /home/user/shakti_prime/tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service.

**Reviewer's checklist (check it yourself before reporting):** no path left by which a person without the credit permission confirms a dealer order without the credit check; no second accepted quote, order or commission for a lead under concurrency (two accepts at once); every new refusal has a plain sentence in `en.json`; every redefined function keeps what `main`'s version does; no tax, price or credit figure computed in UI code.

## Report

### 13-10-2026, cloud (lead's VM), early check: migrations, triggers, index and commands

**Skills loaded:** add-command, add-table, supabase-postgres-best-practices.

**Migrations** (numbered from 0134 as the brief asks; the journal `idx` stays contiguous, 130 to 132, because `journalProblems()` refuses a gap, and the snapshots are `0130`–`0132`):
- `0134_audit_sales.sql` (generated, hand-edited backfill): `sales_orders.account_type` (added, backfilled from the customer with `set_updated_at` off, then `not null`) with `sales_orders_account_type_check`; `quotes.withdrawn_for_id` with `quotes_withdrawn_for_fk` and a partial index; `quotes_withdrawn_reason_check` redefined (a reason or the accepted quote, never both); the partial unique index `quotes_opportunity_accepted_unique` on `quotes(opportunity_id) where state = 'accepted'`.
- `0135_audit_sales_rls.sql`: trigger `accounts_type_guard` (`app.guard_account_type()`); `sales_orders_insert` redefined from 0117 (adds the type snapshot check); `grant update (withdrawn_for_id) on quotes`; `app.merge_leads()` redefined from 0113 verbatim plus `has_sale`; `app.import_accounts_in_use()` redefined from 0106 verbatim plus quotes, orders, dealer terms, outstanding, calls and a change by someone else; new definer `app.import_leads_in_use()`; `opportunities` table-wide `update` replaced by column grants; `activities_insert` redefined from 0088 with the narrowed rule.
- `0136_audit_sales_order_type.sql`: `app.fill_sales_order_account_type()` (before insert: an insert that names no type takes the customer's). It is a separate file because 0135 was already applied on the slot's database and I may not reset it (a manual reset was refused by the permission check); fold it into 0135 at the renumbering if you prefer.

**Per finding:**
1. **DOM-1.** The permission is `sales.credit.write` at company scope (Executive all, Accounts their company): `crm.account.update` refuses a change to or from `dealer` without it (`account_type_needs_credit`), and the trigger refuses it to any request. A type that would move a customer with no tier of their own to another tier of `WORKSHOP_DEFAULTS.pricing.tierByAccountType` needs `pricing.write:all` (`account_type_moves_tier`; `packages/domain/src/crm/account-type-change.ts`, unit-tested with a filled map). Orders keep `account_type`: `saveSalesOrder` writes it, the insert policy holds it to the customer's type, no update grant covers it, and `lockSalesOrder` (confirm, cancel, release) and the order DTO read the snapshot, so the credit check and the quote/sizing/acceptance gate run on it.
2. **DOM-4.** `sales.quote.accept` takes a transaction advisory lock per lead before locking the quote, refuses when another quote of the lead is accepted (`quote_lead_already_accepted`, also mapped from the unique index in `constraintReasons`), and withdraws the lead's other draft and sent quotes through the quote machine with `withdrawn_for_id`, emitting `sales.quote.withdrawn` (catalogue `emittedBy` updated). `QuoteDto` gains `withdrawnForId` and `withdrawnForNo`.
3. **DOM-2.** Refuse, not move (`merge_leads_has_sale`): moving a quote or order would change the lead its sizing, site, signed copy and commission were made on, and could put two accepted quotes on the kept lead against the new index; refusing keeps every record where it was signed and the person picks which lead to keep.
4. **DOM-3, DOM-V1.** The rollback keeps (and counts under `kept`) leads in use by `app.import_leads_in_use()` and customers by the extended `app.import_accounts_in_use()`; only `rollback-job.ts` changed in the domain (no change to `import-queries.ts`).
5. **DOM-5.** Cancel clears `credit_held_at`, the reason and the facts (the audit row keeps the reason); the row DTO, `creditHoldOf`, the order record and Accounts' home count only drafts as held.
6. **DOM-6.** `callLogRefusal()` in `telecom/dial-policy.ts`: the start (`now − duration`, stored as `started_at`) must be in 09:00–21:00 IST, and the log no later than 21:00 + `CALL_LOG_GRACE_MINUTES` (15) on that day (`call_logged_too_late`).
7. **DOM-7.** A bounded rate or composite rule inside an open one inserts the continuation of the old one from its end date (same rate and source, or same shares and rates), audited; no client figure is made up.
8. **ARCH-5.** `creditStanding()` in `sales/credit-check.ts` works out exposure (following `exposureCountsConfirmedOrders`) and the overdue test; the confirmation's check, `homeCredit()` (now `heldOrdersSql` + `dealerPositionsSql`, folded in TypeScript) and `listDealerCredit()` all call it.
9. **SEC-4.** `opportunities` update is limited to `stage_id, owner_id, team_id, state, state_changed_at, locked_until`, the four score columns, `referral_partner_id, archived_at, updated_at, updated_by`. A timeline row on a lead needs `crm.lead.write` (or `calls.log` for `call_logged`); a row on the customer needs `app.account_in_scope(account_id, 'crm.account.write')`. I kept the lead rule at the permission, not the row's scope, because a routed repeat enquiry and a task on a colleague's lead legitimately write rows on leads the caller only reads.

**Catalogue sentences added** (`errors.*`): `account_type_needs_credit`, `account_type_moves_tier`, `quote_lead_already_accepted`, `merge_leads_has_sale`, `call_logged_too_late`.

**Tests added:** domain unit 14 (`account-type-change.test.ts` 5, `dial-policy.test.ts` 5, `credit-check.test.ts` 4); domain commands on Postgres 16 (`sales-integrity.test.ts` 14: DOM-1 ×5 including the database trigger and the insert policy, DOM-4 ×3 including two acceptances at once and the index, DOM-2 ×2, DOM-3/V1 ×2, DOM-5, ARCH-5; `calls.test.ts` 1; `tax.test.ts` 1, and the composite test now checks the continuation); db security 13 (`activities.test.ts` 6, of which 5 are the role cases; `crm-scope.test.ts` 1; `imports.test.ts` 4; `grants.test.ts` NARROWER entry; `enum-sync.test.ts` pairing). Changed: the timeline test that let a caller who only reads a customer through their lead write a customer row now expects a refusal (SEC-4), and three fixtures that insert orders with triggers off name the type.

**Checks run** (all through the lock):
- `pnpm test:security`: db 40 files, 1206 passed; domain 73 files, 948 passed; web 22 files, 303 passed.
- typecheck contracts, db, domain, web: clean. eslint `packages/contracts`, `packages/db`, `packages/domain` with `--max-warnings 0`: clean. `pnpm copy-lint`: clean.
- unit: web 104 files, 765 passed, 1 skipped; domain 77 files, 2070 passed and 1 failed (the event-emitter catalogue test), fixed in bd8ab0e7 by emitting the withdrawals inside the command.
- Recheck after bd8ab0e7: typecheck contracts and domain clean; eslint contracts and domain clean; domain unit 77 files, 2071 passed; db unit 9 files, 130 passed; `sales-integrity.test.ts` and `quotes.test.ts` on Postgres, 36 passed.
- `pnpm db:docs` regenerated (data dictionary, ERD, events).

**EXPLAIN (ANALYZE)** (`spike:targets`, Accounts, company 4 with 200 dealers and 3,000 orders): orders held for credit 1.1 ms (seq scan on `sales_orders` under RLS, as before the change); dealer credit positions 50.4 ms (bitmap scan on `accounts_dealer_name_idx`, the definer per dealer). The import definers look up by the indexed `opportunity_id`/`account_id` keys of quotes, orders, calls, sizings, activities, tags and dealer entries.

**Not done yet (after the early check):** the screens (the type select on Account 360 for people without `sales.credit.write`, the withdrawn quote's "accepted instead" line, the new refusals in the dialogs), journeys, the design's Built record and API wording, and the whole-repository lint.

**Decisions the brief left open, and things to know:**
- Accounts hold `sales.credit.write` but not `crm.account.write`, so today only the Executive can make or unmake a dealer through Account 360. Giving Accounts that power needs a role change or a dedicated command; that is the owner's decision.
- A lead whose accepted quote's order was cancelled keeps that accepted quote, so it can take no second accepted quote (accepted is terminal in the quote machine). A new sale for that customer needs a new lead.
- Creating a quote on a lead that already has an accepted quote is still allowed; only accepting it is refused. Refusing it at creation would be a small further change.
- The new unique index fails to build on a hosted database that already holds two accepted quotes for one lead; check dev and staging for `select opportunity_id from quotes where state = 'accepted' group by 1 having count(*) > 1` before migrating.
- The 15-minute grace for logging a call after 21:00 is my stated value (`CALL_LOG_GRACE_MINUTES`), not a client figure.

### 13-10-2026, cloud (lead's VM), after the early check: defaults, screens, journeys, documents

**Built:**
- The call log grace is `WORKSHOP_DEFAULTS.calling.logGraceMinutes` (15), a default for the sales head to confirm as the new workshop question CALL-8 (`docs/13-client-packs/workshop-pack.md`, its answer row, and `client-actions.md` item 1a). `callLogRefusal()` takes it as a parameter; the constant in the calls code is gone.
- 0136 stays its own migration, as the lead asked.
- **Account 360** (`customer-dialogs.tsx`): the view carries `canChangeDealer` (`sales.credit.write` at company scope and the customer write scope). Without it, a dealer's type is locked with the sentence "Only an Executive can change a dealer to another kind of customer, since it changes how their orders are checked for credit.", and any other customer's type is not offered Dealer, with "Only an Executive can make a customer a dealer." This follows the owner's decision of 13-10-2026 that only the Executive makes or unmakes a dealer; the code is as built.
- **Quote page** (`quote-screen.tsx`): a quote withdrawn by another quote's acceptance shows "Withdrawn when the customer accepted" with a link to that quote.
- The new refusals reach the dialogs through the `errors.*` catalogue, as every refusal does.
- **Documents:** the design's Built record line (`docs/03-roadmap-appendix/phase1.md`, after S2); the state machine readme regenerated (it lists the new default). API: no change, since no `/api/v1` route runs these commands.

**Journeys** (Linux VM, `e2e:seed` then Playwright, through the lock): `customers.spec.ts`, `orders.spec.ts`, `quotes.spec.ts` and `calling.spec.ts` ran on desktop-light, desktop-dark and phone, with 86 passed and 2 failed.
- **New:** `customers.spec.ts` "may not make their customer a dealer, and is told who can (DOM-1)" (with axe on the dialog) passed on all three projects. `orders.spec.ts` now makes a second quote of the lead and checks that it is withdrawn and links to the accepted quote (with axe); it passed on all three.
- **The 2 failures** are screenshot comparisons outside the Playwright image: `quote-page` (desktop-light) and `customers-list` (phone).
  - The quote-page diff is font rendering, plus a menu one row out in the sidebar.
  - The customers-list diff is font rendering and line wrapping.
  - This branch changes neither the menu nor the list, and the snapshot quote is not a withdrawn one.
- **Baselines for the lead to remake or check in Linux:** `quote-page.png` (desktop-light) and `customers-list.png` (phone). No other baseline changes.

**Checks** (through the lock):
- **Typecheck:** contracts, domain and web clean.
- **eslint:** `packages/contracts`, `packages/domain` and `apps/web` clean.
- **Whole-repository `pnpm lint`:** exit 0, no warnings.
- **`pnpm copy-lint`:** clean.
- **Unit tests:**
  - domain: 2072 tests at first, 2 failing: the approved-values test (the new default) and the stale machine readme. Both were fixed in 72b87a78.
  - The recheck of `workshop-defaults`, `state-machines/render` and `telecom` passed 67 of 67.
  - web: 765 passed, 1 skipped.
- **Security suites on Postgres:** domain `calls.test.ts` and `tests/queries`, 219 passed.
- **`pnpm build`:** passed.

**Open for the owner:** whether Accounts may make or unmake a dealer. Today only the Executive can: Accounts hold `sales.credit.write` but not `crm.account.write`.

**For the hosted migration:** on dev and staging, check `select opportunity_id from quotes where state = 'accepted' group by 1 having count(*) > 1` before migrating; the new unique index will not build if it returns a row.

### 13-10-2026, cloud (lead's VM), fix round

Each of the review's eight findings is fixed, with the lead's decisions.

**1. Only an Executive makes a customer a dealer, at creation too.**
- `accounts_type_guard` is now `before insert or update of type` (migration `0138_audit_sales_fix_rls.sql`, section 1). A new dealer row needs `sales.credit.write` at company scope, as a change does.
- `crm.lead.create` refuses a new dealer without it (`account_type_needs_credit`).
- The leads and customers import previews mark such a row `dealer_needs_executive` (a new row code, with its sentence under `imports.rowErrors`).
- The New lead form offers Dealer only where the person has the right. Elsewhere it shows "Enter a dealer as a business. An Executive makes them a dealer when their credit terms are set."
- A tele-caller's dealer enquiry enters the Dealer/Wholesale pipeline as a `business`. The Account 360 sentences stay true.
- Tests: the Lead Converter's refused create, the tele-caller's raw insert refused by the trigger, the Executive's create, and a converter's Dealer/Wholesale enquiry as a business (all in `sales-integrity.test.ts`). The General Manager's import refused while the Executive's passes is in `imports.test.ts`, the import row rule in `leads.test.ts`, and the form option in the journey `customers.spec.ts`.

**2. Customer merge across dealer status.**
- `app.merge_customers()` is redefined from 0117 verbatim, plus a `dealer_mismatch` refusal (`merge_dealer_mismatch`, with its sentence).
- Test: `duplicates.test.ts`, both ways round.

**3. The DOM-6 grace.**
- `LogCallInput` takes an optional `startedAt`, which the calling screen fills when Dial shows the number. Calling hours are checked on it and the call keeps it.
- A start that leaves no room for the call's duration (allowing a 2-minute fast device clock), or is older than the longest call plus the grace, is `call_start_invalid`. Without a start, the start is now less the duration.
- Test: `calls.test.ts`. A call from 20:58 logged at 21:01 with no duration and with 30 s is accepted. The same call logged at 21:15:01, a start of 21:00, and two impossible starts are each refused. The CALL-8 wording still holds.

**4. A cancelled draft order.**
- The quote machine has a new move `order.cancel`, from accepted to withdrawn (`sales.order.cancel`, a reason). Accepted is no longer final.
- `sales.order.cancel` of a draft order withdraws its quote with the cancel reason and emits `sales.quote.withdrawn`; the catalogue's `emittedBy` now names it.
- The quote keeps how it was accepted: `quotes_acceptance_check` is relaxed in migration `0137_audit_sales_fix.sql`, generated from the schema.
- The lead can then be quoted, accepted or merged again. A confirmed order's quote stays accepted.
- The machine and data documents are regenerated, and the two sentences rewritten:
  - `quote_lead_already_accepted`: "…and its order stands. Open that order, or cancel it first if the customer wants a different quote."
  - `merge_leads_has_sale`: "…has an open quote or an order. Keep that lead instead, or first withdraw its quote or cancel its order."
- Tests: the cancel frees the lead for a second acceptance, and a merge after the cancel.

**5. The concurrency test** now asserts that the refusal's reason is `quote_transition_not_allowed` or `quote_lead_already_accepted`.

**6. The lead read when a quote is made.** `loadQuoteLead` reads the lead `for share` (`of opportunities`) when `sales.quote.create` or `sales.quote.requote` builds a quote. The read-only preview takes no lock.

**7. The importer in `app.import_leads_in_use()`.** It compares each lead against its own `created_by`, the person whose commit made it (migration 0138, section 3).
- Test: `imports.test.ts` (security), with a job uploaded by one General Manager and committed by another.
- `app.import_accounts_in_use()` is unchanged (job creator, as since 0106), as the lead asked.

**8. Documents.**
- `07-security.md` line 198 now says the definer answers the figures and `creditStanding()` works out exposure and overdue.
- The three code comments are corrected.
- The comment in `0135_audit_sales_rls.sql` (lines 8–9) is not edited. 0135 is applied on the slot's database, and a changed file fails `assertAllApplied`, which I may not reset. Section 1 of 0138 states the rule. Correct that comment when you renumber, if you like.
- SECURITY, DATABASE and the Built record now state the creation, merge, real-start and cancel rules.

**Also fixed:**
- `enum-sync.test.ts` now pairs the relaxed acceptance check.
- `import-kinds.test.ts` "adds the different site…" failed on a second run against the same database, because an earlier run's "Two Sites" customer in Sikar was suggested. It now names its customer per run. This was not a regression of this branch.
- The New lead form showed the dealer line to a multi-company Executive before a company was chosen. That moved the form and failed the Executive's lead-form alignment check in `imports.spec.ts`. Dealer is now judged across all their companies until one is chosen.

**Checks** (all through the lock):
- `pnpm db:migrate`: 0137 and 0138 applied.
- Typecheck contracts, db, domain and web: clean.
- eslint `packages/contracts`, `packages/db`, `packages/domain` and `apps/web`: clean.
- `copy-lint`: clean.
- Unit tests: domain 2081 passed, web 765 passed and 1 skipped.
- Security suites:
  - db (`activities`, `imports`, `grants`, `enum-sync`, `quotes`, `sales-orders`, `crm-scope`, `duplicates`): 316 tests. The one enum-sync failure was fixed; the rerun passed 4 of 4.
  - domain (`sales-integrity`, `calls`, `duplicates`, `imports`, `import-kinds`, `orders`, `quotes`, `create-lead`, `customer-edits`, `lead-flows`, `tests/security`): 249 tests. The one import-kinds failure was fixed; the rerun passed 22 of 22.
  - web, whole suite: 303 passed.
- `pnpm build`: passed.
- Journeys with `--ignore-snapshots`:
  - `customers`, `orders`, `calling`, `leads`, `imports` and `quotes`: 125 passed, with 2 failures (the alignment above, on desktop-light and desktop-dark).
  - After the fix, `imports`, `customers` and `leads`: 82 passed.
- Whole-repository `pnpm lint`, last: exit 0.

**Baselines:** none new. `quote-page.png` (desktop-light) and `customers-list.png` (phone) are still the two to remake in Linux, as before.

**Not run:** the whole `pnpm test:security` this round (only the affected files, as above), and EXPLAIN. No list or search query changed this round; the import definers keep their indexed keys.

### 13-10-2026, cloud (lead's VM), second fix round

Findings 9 to 14 are fixed, with the lead's decisions. 15 needs no code.

**9. Walk-in dealer enquiry.** `WALK_IN_KINDS.dealer_wholesale` sends `business`, as the New lead form does. The Executive makes the customer a dealer on Account 360. The comment and `walk-in.test.ts` are updated. The Store Manager's journey "saves a dealer enquiry without asking for a village" passes again on all three projects.

**10. The Converting workspace** keeps the time of the dial in `use-call-logging.ts`, sends it as `startedAt`, and clears it after a save. Test: `calls.test.ts`, a Lead Converter's 20:58 call logged at 21:01.

**11. A late start.**
- The stored start is the earlier of the given start and (now − duration). Calling hours are checked on that start.
- A start later than that is clamped, not refused, so a retry with the same start goes through. The 2-minute slack is gone.
- Only a start older than the longest call plus the grace is `call_start_invalid`, with a reworded sentence.
- Tests:
  - 20:58 with 600 s, logged at 21:01, is stored as 20:51, twice (the retry).
  - A start of 10:05 logged at 10:00 is stored as 10:00.
  - A start of 09:00:30 logged at 08:59 is `outside_calling_hours`.
- **Further fix, `c386f2b2`:** the start now comes from the server's clock. `DialNumberDto` carries `dialledAt`, the server's time of the dial, and both workspaces send it back. Before this, the calling journey failed: its server runs on a test clock while the browser used the wall clock, and real devices drift the same way.

**12. A cancelled confirmed order.** I chose the first option: `sales.order.cancel` withdraws the order's quote with the cancel reason, whether the order was draft or confirmed. The order and commission rules allow it:
- the cancelled order's accrual is cancelled with it;
- the lead stays won, since there is no move out of won;
- the next confirmed order on the lead earns its own accrual;
- one accepted quote per lead still holds.

The quote machine's note, the comments, DATABASE and the Built record say so. The data repair is in a new migration, `0139_audit_sales_fix2_rls.sql`, section 1, not in 0138: 0138 is applied on the slot, and a changed file fails `assertAllApplied`. It withdraws every quote still `accepted` whose order is cancelled, with that order's cancel reason, and is idempotent. Fold it into 0138 when you renumber, if you prefer. Test: the confirmed order cancelled, then a second quote of the won lead accepted and confirmed.

**13. A commit by someone else.** `imports.job.commit_batch` first sets aside every valid dealer row of the job as invalid, with `dealer_needs_executive`, when the committer lacks `sales.credit.write` at company scope. It moves the counts, and the rest of the job commits. Test: `imports.test.ts`, an Executive previews and a General Manager commits. Result: committed 1, invalid 1 with that code.

**14. The lead hold.** `loadQuoteLead` holds the lead through a new definer, `app.hold_quote_lead()` (migration 0139, section 2), instead of a locking read under the policies.
- The definer asks `sales.quote.create` over the lead, sets `search_path = ''`, is revoked from `public` and `readonly_reporter`, and is listed in DATABASE.
- Test: a custom Sales Team Lead with `crm.lead.write` narrowed to own quotes a teammate's lead.

**15.** No code. You remake the eight baselines in Linux.

**Checks** (all through the lock):
- `pnpm db:migrate`: 0139 applied.
- Typecheck contracts, db, domain and web: clean.
- eslint `packages/contracts`, `packages/db`, `packages/domain` and `apps/web`: clean.
- `copy-lint`: clean.
- Unit tests: domain 2081 passed; web 765 passed and 1 skipped.
- db security files (`activities`, `imports`, `grants`, `enum-sync`, `quotes`, `sales-orders`, `crm-scope`, `duplicates`): 316 passed.
- domain security files (`sales-integrity`, `calls`, `duplicates`, `imports`, `import-kinds`, `orders`, `quotes`, `create-lead`, `customer-edits`, `lead-flows`, `tests/queries`, `tests/security`): 445 passed.
- web security suite: 303 passed.
- After `c386f2b2`:
  - domain `calls`, `call-queue` and `reader-parity`: 52 passed;
  - domain unit 2081 passed;
  - web unit 765 passed.
- `pnpm build`: passed.
- Journeys with `--ignore-snapshots`:
  - walk-in, converting, quotes, orders, calling, customers and leads: 136 passed, with 3 failures in calling.
  - After `c386f2b2`, calling and converting: 37 passed.
- Whole-repository `pnpm lint`, last: exit 0.

**Not run:** the whole `pnpm test:security` (the affected files only, as above), and EXPLAIN (no list or search query changed).

## Review

### 13-10-2026, cloud (lead's VM), slice-reviewer (Opus 5.5 xhigh), head 61bff719

Reviewed `git diff origin/main...fix/audit-sales` against the brief, the audit files and verdicts (`docs/14-reviews/2026-10-audit/`), and the owner's decision of 13-10-2026. Every bypass was reproduced on the slot's Postgres (54335) as `app_user` inside rolled-back transactions: the verifier's `dom1`–`dom5` scripts rerun against this branch's code, two probes of my own (`dom1x`, `dom4x`) and a SQL script (`sec4.sql`), all in `scratchpad/review-as/`. Afterwards there were no rows from these probes and both test quotes were back in draft.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | high | The owner's rule that only the Executive makes or unmakes a dealer holds only for an edit: any lead creator makes a new customer a dealer | fixed in ddbb3b50, 880261b4 |
| 2 | medium | A customer merge unmakes a dealer without the Executive, and the dealer's credit drops off Accounts' lists | fixed in ddbb3b50 |
| 3 | medium | The DOM-6 grace works only when the logged duration runs right up to the moment of logging | fixed in ddbb3b50 |
| 4 | medium | After a draft order is cancelled, its lead can take no other sale, and both new sentences name a step that cannot be taken | fixed in ddbb3b50, 22072433 |
| 5 | low | The "two acceptances at once" test would pass without the lead lock | fixed in ddbb3b50 |
| 6 | low | A quote made while its lead is being merged away or rolled back still lands on the archived lead | fixed in ddbb3b50 |
| 7 | low | A leads rollback keeps every lead when someone other than the uploader committed the job | fixed in ddbb3b50 |
| 8 | low | SECURITY and four code comments contradict the code | fixed in ddbb3b50 (the 0135 comment stays; see the Fix round) |

**1 (high, confirmed). The rule holds only for an edit.**
- **Where:**
  - `0135_audit_sales_rls.sql:8-9` says "A new customer may be made a dealer", and the trigger at `:25` is `before update of type` only.
  - `crm.lead.create` takes `account.type` as given (`create-lead.ts:223`).
  - The New lead form offers Dealer to every lead creator (`screens/lead-form.ts:5-11`, `new-lead-form.tsx:159-164`).
  - The customers import accepts `dealer` from a General Manager, who holds `imports.write` and `crm.account.write` but not `sales.credit.write`.
- **Reproduced (`dom1x.mts` (c)):**
  - A Lead Converter's `crm.lead.create` with `account: { type: 'dealer' }` answers ok with type `dealer`.
  - The same Lead Converter's `sales.order.create` for that customer, with no quote, answers ok (`accountType` `dealer`). So the order has no sizing, no pump or DCR guard and no signed acceptance.
  - In `sec4.sql`, a tele-caller's `insert into accounts (… type 'dealer' …)` answers `INSERT 0 1`.
- **Failure:**
  - A converter enters a household as a Dealer on the New lead form and makes an order without a quote. Only the missing limit holds it.
  - Once Accounts enter terms for what looks like a new dealer, the order confirms. This is DOM-1's move (b), done at creation.
  - Account 360 tells that same person "Only an Executive can make a customer a dealer." The Built record and SECURITY state the rule as enforced.
- **Fix, one of two, before the merge:**
  - Enforce the rule at creation:
    - `accounts_type_guard` becomes `before insert or update of type`, and refuses a new `dealer` row to a request without `sales.credit.write:entity`.
    - `crm.lead.create` and a customers-import row refuse it with `account_type_needs_credit`.
    - The lead form offers Dealer only to a person who has that right.
  - Or the owner narrows the decision to changes only, since PRD CRM's Dealer/Wholesale pipeline takes dealer enquiries through the lead form. Then the two Account 360 sentences, the Built record and SECURITY say so.

**2 (medium, confirmed). A customer merge unmakes a dealer.**
- **Where:** `app.merge_customers()` (`0117:511-680`) never compares the two customers' types.
- **Reproduced (`dom1x.mts` (d)):**
  - The setup: a dealer with ₹1,000 terms and an order held as `credit_limit_exceeded`.
  - A Sales Team Lead (`crm.lead.merge:team`) merges that dealer into a household customer of the same team: merged.
  - Afterwards the kept customer is still `household`, but holds the dealer's terms row and order. The dealer is archived.
  - Neither customer is now a live dealer, so neither appears on `/dealer-credit` or Accounts' home (these show customers of type `dealer` that are not archived). The moved order is still held, because the order keeps its own copy of the type.
- **Failure:** this is the DOM-V1 harm, a dealer's unpaid exposure that nobody watches. It is reached by a person without the credit right, against the 13-10-2026 decision.
- **Fix:** redefine `app.merge_customers()` from 0117 to refuse a pair whose dealer status differs. It answers a new status with an `errors.*` sentence asking an Executive to make the types match first. Add a test in `duplicates.test.ts`.

**3 (medium, confirmed by the code path). The grace does not cover the usual late log.**
- **Where:**
  - `log-call.ts:199-201` takes the call's start as now − duration.
  - `callLogRefusal()` (`dial-policy.ts:69`) refuses any start from 21:00.
- **Failure:**
  - A call starts at 20:58, rings 30 s unanswered and is logged at 21:01 with duration 0 or 30.
  - Its start is taken as 21:00:30 or later, so it is refused with `outside_calling_hours`: "Calls can be made only between 9 AM and 9 PM". In fact the call was made in hours.
  - The new tests pass durations equal to the gap (300 s at 21:03, 1020 s at 21:15), so this case is never tried.
  - `errors.call_logged_too_late` and workshop CALL-8 promise "A call that started before 9 PM can be logged until 9:15 PM".
- **Fix:** let the log carry the call's real start. This means an optional `startedAt` in `LogCallInput`, which the calling screen fills when Dial is pressed. It may be no later than now − duration and no earlier than now − (duration + grace). Check calling hours on that start and store it. Add a test of a short call logged after 21:00.

**4 (medium, confirmed). A lead with a cancelled draft order is stuck.**
- **Reproduced (`dom4x.mts`):**
  1. Q1 is accepted, and the General Manager cancels its draft order. The lead is still `open`.
  2. A new quote is made and **sent** (the customer gets its document). Accepting it is refused with `quote_lead_already_accepted`, whose sentence says "Work from the order of that quote", but that order is cancelled.
  3. Merging the lead away is refused with `merge_leads_has_sale`, whose sentence says "withdraw the quote or cancel the order first". Withdrawing the accepted quote answers `quote_transition_not_allowed`.
- **Cause:**
  - `has_sale` counts an accepted quote whatever its order's state (`0135:130-135`).
  - The index `quotes_opportunity_accepted_unique` keeps the old acceptance.
  - Accepted is a final state in the quote machine.
- **Failure:** a customer who changes the size after signing can be sold to only by marking the lead lost with an untrue reason and starting a new lead.
- **Fix:** the lead or the owner chooses.
  - Preferred: when a draft order of a quote is cancelled, its quote leaves `accepted` (withdrawn with the cancel reason, or a new final state). That frees the lead under both the index and `has_sale`.
  - At least: refuse `sales.quote.create` and `sales.quote.send` on a lead with an accepted quote, and rewrite both sentences to name a step the person can take.

**5 (low, plausible). The concurrency test proves only the index.**
- **Where:** `sales-integrity.test.ts:390-408` asserts one fulfilled and one rejected acceptance, but not the rejection's reason.
- **Failure:** remove `holdLeadSale` and the two acceptances lock Q1 and Q2 crosswise in `withdrawOtherQuotes` against the index, so Postgres aborts one with a deadlock (40P01). The test still passes.
- **Fix:** assert that the rejection's `details.reason` is `quote_transition_not_allowed` or `quote_lead_already_accepted`.

**6 (low, plausible). A quote can still be stranded by a race.**
- **Where:** `loadQuoteLead` (`quote-facts.ts:98`) reads the lead without a lock.
- **Failure:**
  - `app.merge_leads()` and `app.import_leads_in_use()` lock the lead `for update` and then look for quotes.
  - A quote whose insert starts inside that window passes its policy on the earlier snapshot. Its foreign-key check waits for the lock, then succeeds on the archived lead.
  - That quote is then stranded, as in DOM-2.
- **Fix:** read the lead `for share` with `archived_at is null` in `loadQuoteLead`. The quote then waits for the merge or rollback to finish and checks the lead again.

**7 (low, plausible). The importer is taken from the job, not the commit.**
- **Where:** `app.import_leads_in_use()` takes the importer as `import_jobs.created_by` (`0135:262`).
- **Failure:**
  - The leads, their `lead_created` rows and their stamps carry the person who asked for the commit (`commit-leads.ts:57`; the worker's `importPrincipal`). Any holder of `imports.write:entity` may commit a job.
  - When the uploader and the committer differ, every lead counts as in use, and the rollback archives nothing yet answers `rolled_back`.
  - `app.import_accounts_in_use()` has done the same since 0106.
- **Fix:** compare against each lead's `o.created_by`, the person whose commit made it, instead of the job's creator.

**8 (low, confirmed). Documents.**
- `docs/07-security.md` (line 198) still says "The exposure is worked out in one definer, `app.dealer_credit_position()`". Since ARCH-5, `creditStanding()` works out the exposure and the overdue test, and the definer answers only the figures.
- Four comments say Accounts make dealers: `account-type-change.ts:9`, `customer.ts:119`, `customers.ts:563` and `0135:6`. With today's roles only the Executive can (owner, 13-10-2026).

**Checked and sound:**
- **The verifier's scripts against this branch:**
  - DOM-1 (a): the Lead Converter's type change is refused (`account_type_needs_credit`), the second confirm stays held, and the order ends as a draft with no release. DOM-1 (b): the Lead Converter cannot make a household a dealer, and the order without a quote is refused.
  - DOM-2: the merge is refused, and the order then confirms.
  - DOM-3: the sold lead is kept, and its order confirms.
  - DOM-V1: the dealer is kept, and its next order is accepted.
  - DOM-4, in both orders of steps: 1 accepted quote, 1 confirmed order and 1 commission accrual; the second acceptance is refused.
  - `dom5` calls the removed `creditSummarySql`; DOM-5 is covered by `sales-integrity.test.ts`, which passed.
- **The database paths, as `app_user`:**
  - A caller's `update opportunities set account_id` and `set created_by` are refused ("permission denied"). A stage move still works.
  - Accounts' `won` row on a lead, and their `customer_updated` row, are refused by RLS.
  - A type change is refused by the trigger for a caller and for a General Manager. Accounts see no customer row to change, and the Executive succeeds.
  - With no request settings, the update reaches no row (fails closed).
  - `sales_orders.account_type` cannot be updated, even by the Executive.
- **The unique index, in two sessions:**
  - The second acceptance waited on the first's transaction for 4.5 s until it ended.
  - Within one transaction the second acceptance fails with 23505 on `quotes_opportunity_accepted_unique`.
- **Migration 0136 and the redefinitions:**
  - `merge_leads` (0113), `import_accounts_in_use` (0106), `sales_orders_insert` (0117), `activities_insert` (0088) and `quotes_withdrawn_reason_check` (0109) are main's latest versions with additions only.
  - `main`'s 0130–0133 touch none of them.
  - The journal times are after `main`'s 0133. Journal `idx` 130–132 clash with `main`'s and are renumbered at the merge.
  - The hashes applied on the slot match the files.
  - The fill trigger runs before the insert policy checks the row.
  - 0134 holds ACCESS EXCLUSIVE locks on `sales_orders` and `quotes` for the length of the migration transaction. That is fine at today's sizes.
  - Run the duplicate-acceptance query in the run file before migrate-hosted.
- **Definers and money:**
  - `app.import_leads_in_use()` checks its permission, sets `search_path = ''`, revokes from `public` and `readonly_reporter`, locks the leads it answers for, and is listed in DATABASE.
  - The trigger functions revoke execute as well.
  - `creditStanding()` works in paise, and the confirmation, Accounts' home and `/dealer-credit` all call it.
  - The DOM-7 continuation copies the rate and its source, is audited, and leaves no gap or overlap.
  - Cancelling an order clears its hold, and the reads count only drafts as held.
  - The event catalogue's `emittedBy` matches the code.
  - The web layer computes no figures, and every new sentence is in `en.json`.
- **Suites on the slot, through the lock:**
  - domain `sales-integrity`, `calls` and `tax`: 53 passed.
  - domain `quotes`, `orders`, `duplicates`, `imports`, `customer-edits`, `create-lead`, `tasks`, `timeline`, `lead-flows`, `consent`, `handover`, `crm-scoring-referrals`, `opportunity` and `triage`: 242 passed.
  - db `activities`, `crm-scope`, `imports`, `grants` and `enum-sync`: 276 passed.
- **Screenshots:** the two failing diffs (`quote-page` desktop-light, `customers-list` phone) are not from this branch. The actual image has a Converting row that the older baseline lacks, and the phone list wraps differently. Both actual images lay out cleanly.

**Not checked:**
- The journeys were not run. The dialog's new helper line and the quote page's withdrawn line have no screenshot, so their layout in light, dark and phone width is unseen until the Linux baselines are remade.
- `pnpm copy-lint` waited behind other builders in the heavy-command lock queue, and I stopped it before it ran. The new keys are neither button labels nor titles; the builder's run was clean.
- I did not run the whole security suite, as instructed, and did not rerun EXPLAIN.

### 13-10-2026, cloud (lead's VM), slice-reviewer second review (Opus 5.5 xhigh), head 81827753

Re-checked the fix round (`git diff 1a69e1cd..81827753`) against the eight rows above, and attacked what it added. Every case was reproduced on the slot's Postgres (54335) as `app_user` inside rolled-back transactions, running the domain commands, with `walkin.mts`, `calls.mts`, `orders.mts`, `nouser.sql` and `share.sql` in `scratchpad/rev2/p/`. The hashes applied on the slot match the files of 0137 and 0138.

**The first review's rows:**

| # | Verdict |
|---|---|
| 1 | Fixed for Account 360, `crm.lead.create`, both imports, raw SQL and merges. But the walk-in form can now take no dealer enquiry at all (finding 9). |
| 2 | Fixed. `app.merge_customers()` is 0117's text plus the `dealer_mismatch` refusal, made after both customers are locked. No other line differs, and the grants are kept. |
| 3 | Fixed on the Cold Caller screen only. Still open on the Converting workspace (finding 10). |
| 4 | Fixed for a draft order. A lead whose confirmed order was cancelled still meets an untrue sentence (finding 12). |
| 5 | Fixed. A deadlock answers `concurrent_change`, outside the asserted pair, so the test fails without the lead lock. |
| 6 | Fixed for every seeded role; finding 14 covers a customised one. |
| 7 | Fixed. 0138's function is 0135's with `o.created_by` in all five comparisons, and the new test fails on 0135. |
| 8 | Fixed. The 0135 comment waits for the renumbering, as the Fix round says. |

**New findings:**

| # | Severity | Finding | State |
|---|---|---|---|
| 9 | high | The walk-in form's Dealer/Wholesale enquiry is refused to everyone but the Executive | fixed in 34485149 |
| 10 | medium | The Converting workspace still logs a call with no start, so the DOM-6 grace does not reach Lead Converters | fixed in 34485149, c386f2b2 |
| 11 | low | A start later than the moment of logging is accepted and stored | fixed in 34485149, c386f2b2 |
| 12 | low | A lead whose confirmed order was cancelled can still be quoted and sent a quote, and the refusal names an order that stands | fixed in 34485149 |
| 13 | low | An import committed by a non-Executive after an Executive previewed it fails the whole job, with a sentence that does not say why | fixed in 34485149 |
| 14 | low | `loadQuoteLead … for share` hides a lead from a customised role that may quote it but not write it | fixed in 34485149 |
| 15 | low | Six New lead baselines change, and nobody has looked at them | no code; the lead remakes the eight baselines in Linux |

**9 (high, confirmed). The walk-in form cannot take a dealer's enquiry.**
- **Where:**
  - `apps/web/src/screens/walk-in.ts:21` maps the Dealer/Wholesale interest to `account.type: 'dealer'`, and the form has no type field.
  - `crm.lead.create` now refuses a new dealer without `sales.credit.write` (`create-lead.ts:228`).
  - `walk-in.test.ts:55-63` still asserts `type: 'dealer'`.
- **Reproduced (`walkin.mts`):**
  - `buildWalkInInput()` for a Dealer/Wholesale walk-in, run as a Store Manager, answers `forbidden` / `account_type_needs_credit`.
  - The Executive's same input makes a dealer.
- **Failure:**
  - PRD CRM-01's Store Manager can record no new dealer who walks in, and nor can any other role with the walk-in form except the Executive.
  - The form tells them "Ask an Executive to make this change". The decision of 13-10-2026, the Built record and SECURITY all say that a dealer's enquiry enters as a business.
- **Fix (one line):**
  - `dealer_wholesale: { account: 'business', site: undefined }`; the Executive makes the customer a dealer on Account 360 when their terms are set.
  - Update `walk-in.test.ts`, and add a case of a Store Manager's dealer walk-in, on Postgres or in a journey.

**10 (medium, confirmed). The Converting workspace logs no start.**
- **Where:**
  - `apps/web/src/components/converting/use-call-logging.ts:36-46` sends neither `startedAt` nor a duration. Only `calling-screen.tsx` was changed.
  - `log-call.ts` then takes the start as the moment of logging.
- **Reproduced (`calls.mts`):**
  - A Lead Converter's call logged at 21:01 IST with the Converting screen's input answers `outside_calling_hours`.
  - The same call with the Cold Caller screen's `startedAt` of 20:58 is logged.
- **Failure:**
  - Finding 3 stays for the Lead Converters, who log their calls on the Converting workspace.
  - A call made at 20:58 gets "Calls can be made only between 9 AM and 9 PM", against CALL-8's "can be logged until 9:15 PM".
- **Fix:** keep the time Dial showed the number in the hook and send it as `startedAt`, as the calling screen does. Set it in `showNumber`, and clear it when the lead changes and after a save.

**11 (low, confirmed). A start later than the log is kept.**
- **Where:** `log-call.ts:49-63` accepts a given start up to 2 minutes later than now less the duration, and returns it unchanged. That time is the one checked and stored.
- **Reproduced (`calls.mts`):**
  - Logged at 08:59:00 IST with `startedAt` 09:00:30: logged, with `started_at` 09:00:30, after the moment it was logged.
  - The same log without a start answers `outside_calling_hours`.
- **Failure:**
  - A call that really started in the two minutes before 9 AM passes the 9 AM rule (DOM-6: "a start before 09:00 IST refused").
  - The call row says the call started after it was logged.
  - A device clock more than 2 minutes fast gets `call_start_invalid` on every retry, because the screen keeps the same `dialledAt` until the lead is opened again.
- **Fix (one line):**
  - Return `new Date(Math.min(at.getTime(), now.getTime() - (durationS ?? 0) * 1000))`, and drop the refusal on the late side; the slack constant is then not needed.
  - Stronger: `dialNumber` records the server's own time of the dial, and the log uses that.

**12 (low, confirmed). A lead whose confirmed order was cancelled is still quoted.**
- **Where:**
  - Quoting and acceptance read no lead state (`quote-facts.ts`, `accept-quote.ts:160-170`).
  - By design, cancelling a confirmed order leaves its quote accepted and its lead won.
  - The sentence is `errors.quote_lead_already_accepted` (`en.json:345`).
- **Reproduced (`orders.mts` A):**
  1. The order is confirmed, then cancelled. The lead is `won` and the quote `accepted`.
  2. A new quote on the lead is made and **sent** to the customer.
  3. Accepting it answers `quote_lead_already_accepted`: "…and its order stands. Open that order, or cancel it first…". That order is already cancelled.
- **Failure:** the customer gets a quote that can never be accepted, and the sentence names a step that does not exist. This is the first review's finding 4, for a confirmed order.
- **Fix, one of two:**
  - Refuse `sales.quote.create` and `sales.quote.send` on a lead that has an accepted quote, or on a won lead, with a sentence saying to start a new lead.
  - Or answer a second reason when the accepted quote's order is cancelled.

**13 (low, confirmed by the code path). An import committed by someone else fails.**
- **Where:**
  - The preview judges dealer rows by the person who previews (`preview-job.ts:236`, `:294`).
  - Any holder of `imports.write` may run `imports.job.commit`, and the commit does not judge those rows again.
  - For a General Manager, the trigger refuses the set-based batch, then `crm.lead.create` or the customers insert refuses the row.
  - That refusal is not a held-by-colleague one, so `commit-job.ts:356` throws it again and `:374-387` fails the job with `commit_failed`.
- **Failure:**
  - An Executive previews a file with dealers, and a General Manager commits it.
  - The job stops at the first dealer row with "This row could not be added, so the rows added with it were taken back…", which does not say why. Earlier batches stay committed.
- **Fix, one of two:**
  - In the commit, mark a dealer row `dealer_needs_executive` for a committer without the right, and set it aside as held rows are.
  - Or refuse the commit with that reason before it starts.

**14 (low, plausible). The shared lock needs the right to write the lead.**
- **Where:**
  - `quote-facts.ts:104` reads the lead `for share`.
  - Postgres applies the UPDATE policy's `USING` to a locking read, and `opportunities_update` asks `crm.lead.write` over the lead's owner and team.
  - `quotes_insert` asks `sales.quote.create` instead.
- **Reproduced (`share.sql`):** with `crm.lead.read:team`, `sales.quote.create:team` and `crm.lead.write:own`, a plain select reads a teammate's lead (1 row), and `for share` does not (0 rows).
- **Failure:**
  - No seeded role is affected, since every role's `sales.quote.create` scope equals its `crm.lead.write` scope.
  - A role given wider quoting than lead writing in the role editor gets `lead_missing` on every teammate's lead it may quote.
- **Fix, one of two:**
  - Hold the lead through a definer that checks `sales.quote.create`.
  - Or, instead of a locking read under RLS, read `archived_at` again after the quote insert, whose foreign-key check has waited for the merge or rollback.

**15 (low, confirmed). Six New lead baselines change.**
- **Where:**
  - `leads.spec.ts:47` snaps `leads-new-teleCaller` and `leads-new-teamLead` on desktop-light, desktop-dark and phone.
  - Neither role holds `sales.credit.write`, so all six now show the new helper line under "Type of customer". The row grows and every field below it moves.
  - The fix round ran its journeys with `--ignore-snapshots` and says no baseline is new.
- **Failure:**
  - The six comparisons fail in the Linux run.
  - The new line has not been seen in any width or theme.
  - The helper renders under the select (`packages/ui/src/field.tsx:73`), so the two selects of the row stay level.
- **Fix:** remake the six in the Linux image, with the two already listed (eight in all), and look at each.

**Checked and sound:**
- **Every path that makes a dealer, as `app_user`:**
  - `crm.lead.create`: refused to a Lead Converter; the Executive's makes a dealer.
  - A raw insert of a dealer under a Store Manager's request is refused by the trigger (42501). With no request settings, RLS refuses it.
  - With permissions set but no user id, the trigger lets a dealer row in (`nouser.sql`). That adds no path: no request sets permissions without a user id (`withRequestContext` sets both), and a raw session could forge either.
  - Both imports apply the preview's row rule. The commit runs as the person who commits it (`importPrincipal`), so the trigger holds there.
  - No definer inserts a customer or changes their type, and an unmerge only un-archives.
  - The repeat and routed enquiry paths make no customer.
  - No agent principal and not `system:workers` holds `sales.credit.write`. Accounts hold it without `crm.account.write`, so with today's roles only the Executive makes or changes a dealer.
- **The New lead form:**
  - Before a company is chosen, Dealer is offered only when every company on offer allows it.
  - The page judges each company on its own, while the action runs with the All-companies principal, as it already does for the lead rights themselves. So a person with different roles in different companies may be offered Dealer and then refused. No seeded set-up does this.
- **The owner's decision of 13-10-2026** is on the lead's branch (`claude/beautiful-dijkstra-ndybwa`), not yet on this branch or on `main`. The code matches it except for finding 9.
- **`app.merge_customers()`:**
  - Diffed against origin/main's latest version (0117): identical apart from the seven added lines.
  - `main`'s 0130–0133 touch none of the objects in 0137 and 0138.
  - The new status maps to `merge_dealer_mismatch`, which has its sentence, and the test tries both orders.
- **The quote machine's `order.cancel`:**
  - Only a draft order's cancel withdraws its quote; a confirmed order's quote stays accepted (`orders.mts` A).
  - A withdrawn quote cannot be withdrawn or accepted again (`quote_transition_not_allowed`, `orders.mts` B), and `sales.quote.withdraw` fires only `withdraw`, from draft or sent.
  - Commission accruals are made only at confirmation, so a cancelled draft leaves none. The test's second acceptance makes one draft order, and the index still allows one accepted quote a lead.
  - The event, the audit row and `auditFields` match the other ways a quote is withdrawn; none of them writes a timeline row.
  - `quotes_acceptance_check` keeps main's signed-copy clause, and allows `accepted_via` only on accepted and withdrawn quotes.
  - The old check never held back a raw writer: `app_user` has had update on `accepted_via` and `signed_file_id` since 0117. So relaxing it opens no path.
  - The cancel locks the order, then the quote. An acceptance of another quote takes the lead lock, then locks only draft and sent quotes, so the two cannot deadlock.
- **`loadQuoteLead … for share`:** `saveQuote` writes no lead row, so two quotes made at once do not deadlock on the shared lock.
- **`app.import_leads_in_use()`:**
  - 0135's function with `o.created_by` in all five comparisons, and its grants unchanged.
  - `created_by` is outside `app_user`'s column grants, and a score refresh keeps `updated_by`.
- **Documents:** SECURITY, DATABASE, the Built record and the quote machine's document match the code, except for the walk-in (finding 9).
- **Suites on the slot, through the lock:**
  - domain `sales-integrity`, `calls`, `duplicates`, `imports` and `create-lead`: 104 passed.
  - db `imports`, `enum-sync`, `quotes` and `grants`: 218 passed.

**Not checked:**
- The journeys and screenshots were not run, so finding 15's images are unseen.
- Whether dev or staging hold a quote that is still accepted although its draft order was cancelled before 0137:
  - No backfill moves such a quote, so its lead stays as finding 4 described. The slot has none.
  - Before migrate-hosted, run `select q.id from quotes q join sales_orders so on so.quote_id = q.id where q.state = 'accepted' and so.state = 'cancelled' and so.confirmed_at is null`.
- The whole security suite, copy-lint and EXPLAIN.

**Merge:**
- Blocked by finding 9 (high, a one-line fix).
- Finding 10 is a change to one hook, and finding 11 is one line, so both are worth fixing with it.
- The rest are follow-ups.

## Integration notes
- Migrations from 0134 move after `main`'s last one at the merge.
- 14-10-2026, lead: `main` (#167 to #172) taken by a merge commit; the migrations move to 0143 to 0148. The two checks this slice drops and adds again (`quotes_withdrawn_reason_check` in 0143, `quotes_acceptance_check` in 0146) are added `NOT VALID`, as `main`'s migration rule (DATA-5) asks; both only widen what was allowed, and the owner validates them with the GST checks (DEPLOY §2 step 8, exit-gate action 18). No function, trigger or check here is redefined by `main`'s 0130 to 0142. The conflicts were the message catalogue, three DATABASE rows (kept from both sides) and `import-kinds.test.ts` (`main`'s fix kept).
