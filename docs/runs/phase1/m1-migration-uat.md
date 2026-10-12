# M1 Migration and UAT packs (wave 6)

| | |
|---|---|
| Branch | `feat/m1-migration-uat`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/m1-migration-uat`, slot 1: Postgres 54331 (container `shakti-pg-m1-migration-uat`), app 3031 |
| Runs on | cloud, beside the follow-up bundles `fix/followups-db` and `fix/followups-tooling` (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | A (deleting or anonymising data): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | building |
| Next step | builder: schema, migrations and commands, then stop for the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md`](../../03-roadmap-appendix/phase1.md) wave 6 (M1, line "M1 Migration and UAT"), §11 (workshop defaults), §12 (tests per slice).
- PRD IMP-01 and IMP-02 and their trace rows; BLUEPRINT §7.9 (retention: unqualified leads with no transaction are anonymised 24 months after their last activity; retention runs as scheduled, logged jobs).
- What exists and is reused, never forked: P2b's imports (`packages/domain/src/imports`, `packages/db/src/schema/imports.ts`, `apps/web/src/workers/imports.ts`, the imports screens), `retention_runs` and the retention functions of migrations 0053 and 0062 (`packages/db/tests/security/retention.test.ts`), the nightly route (`apps/web/src/workers/nightly-route.ts`) and the QStash schedules, ADR 0020 (the workers principal holds platform-only permissions and works through narrow definers), the audit redaction rules (`packages/domain/src/audit`), the masking rules (`packages/domain/src/privacy`).
- Skills: `add-table` and `add-command` where they apply, `supabase-postgres-best-practices`, `writing-guidelines`.

1. **Reconciliation report per import job:** for every import job, rows in, created, attached to an existing record, skipped, refused, with the refusals counted by reason (the `errors.*` reasons the import already records). A query through `executeQuery()` (with `EXPLAIN (ANALYZE)` under RLS in the report), a screen section on the import job's page that an importer can read and print or download as CSV, and the same figures in the job's completion notice if the notice exists. No new figures are invented: every count comes from what the import already stores; add a column only if a count is not recoverable, and say why.
2. **Anonymisation of old unqualified leads:** a scheduled, logged job that finds leads that are unqualified (not converted, no quote, no order, no payment, no project) whose last activity is 24 months or more ago, and anonymises them: name, phones, email, addresses and free-text notes replaced or cleared, consent records kept as the fact of consent without the contact, the account kept only if no other company or record uses it (ADR 0008), and Aadhaar never involved. Name the 24 months in `packages/domain/src/workshop-defaults.ts` (retention is confirmed with the CA). It runs as `system:workers` through a narrow definer that checks a platform-only permission (ADR 0020; append it to `app.platform_only_permissions()` taking `main`'s latest definition), logs each run in `retention_runs` (rows affected, error), writes one audit row per anonymised lead with no personal value in it, is idempotent and batched, and has a nightly schedule route beside the others (the hosted QStash schedule is made by the owner later; list its name in the report). A dry-run mode that counts without changing anything, for the cutover rehearsal.
3. **Cutover runbook (IMP-02):** `docs/runbooks/cutover.md`: the staging dry run, the count reconciliation (using item 1), the cutover weekend hour by hour, the go/no-go rule, the rollback, who does what (by role, never by a person's name).
4. **Parallel-run pack:** `docs/13-client-packs/parallel-run.md`: the two-week parallel run, what is compared each day between the old records and the BOS, how a difference is logged and resolved, and the exit rule.
5. **UAT pack per role:** `docs/13-client-packs/uat/<role>.md` for Executive, GM, Accounts, Sales Team Lead, Cold Caller, Lead Converter and Store Manager: numbered steps in business words, the expected result, a pass/fail box. Every step names a screen that exists today; nothing from a later phase.
6. **Role journeys:** Playwright journeys for the Cold Caller, Lead Converter, Store Manager and Executive, and the dealer credit block, end to end across modules (a new `apps/web/e2e/uat.spec.ts`, or one file per role if clearer), each with axe and `expectAligned`, no screenshots unless they seed their own figures. They must run locally as today's journeys do; that they can run against staging is a later lead step (record what they need: accounts per role and seeded data).
7. **Tests:** the reconciliation query on Postgres with the role × company matrix; the anonymisation definer in `packages/db/tests/security` (refused to every person's role and to agents, allowed to the workers principal, fail-closed without context, exactly the right leads touched — a lead with a quote, an order, a recent activity or another company's use is never touched — idempotent, the `retention_runs` row and audit rows); the job's unit tests; the journeys above.
8. **Documents:** design wave 6 "Built (M1)", the PRD trace rows for IMP-01 and IMP-02, `docs/09-testing.md` if a suite is new, `pnpm db:docs` for the schema, the client packs' readme.

Done when: the checks of AGENTS §10 pass on the branch; the new journeys pass twice in a row on the same database; the security suite passes on the slot's Postgres.

Not in M1: G1 (production accounts), the real parallel run and UAT (they need the client's file), any change to tax, price or credit logic. Two other builders run at the same time: `fix/followups-db` edits notifications, commission accruals, the Triage shadow report and `app.ensure_audit_partitions()`; `fix/followups-tooling` edits `tools/integration`, `.claude/hooks`, `converting.spec.ts`, `converting-fixtures.ts`, `files.spec.ts` and a few test files. Do not edit those. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue, `copy-lint.config.json`) are append-only.

**Migrations:** start at 0130 (the database bundle also starts at 0130; the lead renumbers at the merge).

**Early check:** when the schema, migrations, the definer and the commands and queries are committed with their security tests passing, commit, write a short report and stop; the lead reads that diff before the screens, runbooks and journeys.

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service.

**Reviewer's checklist (check it yourself before reporting):** no personal value in any audit row, log or `retention_runs.error`; the anonymisation can never reach a lead with a quote, order, payment or project, or one another company still uses; RLS fails closed on any new table; the platform-only permission is held by no person's role and no agent; every user-facing word in `en.json` and plain (copy lint); the reconciliation counts add up to rows in.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations from 0130 move after `main`'s last one at the merge; `app.platform_only_permissions()` is redefined: check it against `main`'s latest definition.
- The nightly anonymisation schedule on dev and staging is made by the owner after the merge (QStash is on the PC's tools).
