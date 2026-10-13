# Audit fixes: sales integrity (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-sales`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-sales`, slot 5: Postgres 54335 (container `shakti-pg-audit-sales`), app 3035 |
| Runs on | cloud, beside M1 and the web audit fixes (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (credit, orders, commissions, tax rates, row-level security): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted; the owner said to proceed (12-10-2026) |
| State | early check |
| Next step | builder: the findings below; stop for the early check after the migrations and commands |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations from 0134 move after `main`'s last one at the merge.
