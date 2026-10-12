# Audit fixes: sales integrity (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-sales`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-sales`, slot 5: Postgres 54335 (container `shakti-pg-audit-sales`), app 3035 |
| Runs on | cloud, beside M1 and the web audit fixes (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (credit, orders, commissions, tax rates, row-level security): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted; the owner said to proceed (12-10-2026) |
| State | building |
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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations from 0134 move after `main`'s last one at the merge.
