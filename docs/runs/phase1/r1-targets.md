# R1 Targets and home pages (wave 5)

| | |
|---|---|
| Branch | `feat/r1-targets` on GitHub, from `main` at 9fd37458 (#135) |
| PC worktree | `D:/shakti-wt/r1-targets`, slot 20: Postgres 54350 (container `shakti-pg-r1-targets`), app 3050 |
| Runs on | PC only, beside T2 (owner, 09-10-2026: two builders this run), heavy commands through the PC's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | B (permissions, home pages over existing commands): build Sonnet medium, review Opus |
| Usage | build (Sonnet, medium, 09-10-2026): 75 % of the week at its start |
| State | built, checks pass; Linux baselines not made |
| Next step | review (Opus) |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §9](../../03-roadmap-appendix/phase1.md#9-wave-5) (R1), §3 (R1 needs T1 and S2), §4 (`sales.targets.write`: Executive all, General Manager entity, Sales Team Lead team; no agent), §11 (targets have no default: they stay empty until the client gives them) and §12.
- PRD TEL-06 and RPT-01 with their trace rows; BLUEPRINT §8.10 (role home pages) and the cost rule in `CLAUDE.md` (margins only through report queries under the viewer's own permissions; Phase 1 shows no margins, PRD RPT-01's trace says margins come in Phases 3 and 5).
- What exists: `/home` (`apps/web/src/app/(bos)/home/page.tsx`, the shortcuts per role), T1's call queue and `calls` (`/calling`), the leads board and pipelines (C3), quotes (S1), orders and dealer credit (S2, `app.dealer_credit_position()`), N1's notices, the Agent Inbox, the testing lists and the role × company matrix.
- Skills: `add-command`, `add-table`, `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`.

1. **Table** `targets` (AGENTS §6 in full: RLS forced and failing closed, the testing lists, a fixture row per company and its matrix rule (take free `per()` offsets after 0x43 and above anything T2 uses; check `origin/feat/t2-handover`'s matrix fixture and pick offsets that clash with neither), `app_reader`, `NARROWER`, `enum-sync`): `entity_id`, `scope` (`caller` or `team`), `subject_id` (the user or the team), `metric` (`calls`, `qualified`, `orders`, `kw`), `period` (`day`, `week`, `month`), `starts_on` (the period's first day, IST), `value` (numeric, ≥ 0), `set_by`, `set_at`; one current value per subject, metric and period start; history kept (append-only rows, the newest counting, or audited updates — state the choice). Read by the subject (their own and their team's), by their team lead, the GM of the company and the Executive.
2. **Permission** `sales.targets.write` with its SECURITY §3.2 row, seed, oracle case and the agent refusal sweep.
3. **Command** `sales.target.set` (people only, `sales.targets.write` at its scope: a team lead only for their team and its callers), with denied, wrong-company and happy-path tests; audited.
4. **Progress, worked out, never stored by hand:** a query (a definer if a caller must count what they cannot read row by row) giving, for a subject, metric and period, the actual against the target: calls logged (`calls`), leads moved to qualified, orders confirmed (S2), and kW of the sizings on leads whose orders were confirmed in the period (state the exact rule). Pure functions for the period boundaries in IST and the progress fraction, unit-tested. `EXPLAIN (ANALYZE)` under RLS for each home page's queries and the leaderboard.
5. **Home pages per role** on `/home` (each a server component reading through `executeQuery()`, `screenAccess()`, no cost or supplier-rate data):
   - Cold and Lead Converter callers: their queue summary (due callbacks, today's calls) and their targets with live progress (empty state, in plain words, when no target is set);
   - Sales Team Lead: the team's progress against its targets, a leaderboard of the team's callers for the period, and the team's queues (overdue callbacks, leads not called in time);
   - General Manager: response-time limits missed (first-call SLA) and the pipeline by stage per company;
   - Accounts: dealer credit (held orders, dealers over their limit, overdue invoices) from S2's queries;
   - Executive: pipeline by stage, quotes sent and accepted, orders confirmed, per company and for the group; no margins in Phase 1;
   - a person with several roles sees the sections of each; the shortcuts that exist stay.
   - A "Targets" page for those with `sales.targets.write` to set each caller's and team's targets per metric and period, with history.
6. **Tests:** the period and progress functions; `sales.target.set`; the progress query per metric on Postgres (including a caller who cannot read a teammate's leads still sees their own count, and a team lead sees only their team); the agent refusal sweep; the matrix. Journeys with axe and screenshots: each role's home (with and without targets), the Targets page, a team lead setting a target and a caller seeing it.
7. **Documents:** DATABASE (the table, any definer), SECURITY (§3.2 row, §3.3 if a definer), design §9 "Built (R1)", the PRD trace for TEL-06 and RPT-01, the workshop pack only if a question's "Today" line changes, `pnpm db:docs`, `machines:docs` if a machine changes.

Done when: the checks of AGENTS §10 pass on the branch; a journey has a team lead set a caller's daily call target and the caller's home show progress after logging calls; each role's home renders with its sections and their empty states.

Not in R1: incentives and statements (Phase 5), margins and P&L (Phases 3 and 5), inventory home (Phase 3), any target value (the client's; journeys use clearly synthetic fixtures). Files T2 owns right now: the opportunity machine's `assign`, `caller_profiles`, the handover worker, `/converters`, the profile page's presence section, Admin › Team members' Move all leads; do not edit them. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue) are append-only.

**Migrations:** start at 0124 (T2 also starts at 0124 on its branch; whichever merges second renumbers, which the lead does at the merge).

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Another builder (T2) shares the PC and the heavy-command lock: heavy commands wait their turn. Never open a pull request, install a dependency or touch a hosted service. If a tool you need is missing, stop and report.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
1. Merge after T2: renumber R1's migrations after T2's, and check the matrix fixture offsets and `nav.ts` against T2's.
