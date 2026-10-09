# L1 Lead Converter workspace (wave 5)

| | |
|---|---|
| Branch | `feat/l1-converting`, from `main` at 2e4ad05a (#144) |
| PC worktree | cloud day: `/home/user/shakti-wt/l1-converting`, slot 2: Postgres 54332 (container `shakti-pg-l1-converting`), app 3032 |
| Runs on | cloud, beside A1 and the journey fixes (owner, 09-10-2026: all pending Phase 1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | C (a screen composed from existing commands): build Sonnet 5.5 high, review Opus 5.5 medium |
| Usage | not readable in the cloud session; the owner ran the day past the budget gate by instruction |
| State | building |
| Next step | build |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §9](../../03-roadmap-appendix/phase1.md#9-wave-5) (L1), §3 (L1 needs T2, S2, C4), §11 (workshop defaults: no converter capacity cap) and §12 (tests per slice).
- PRD TEL-03 ("Board, sizing, quote builder and next-best-action"; WhatsApp thread and Co-pilot are Phase 2) and its trace row; BLUEPRINT §8 (the Lead Converter's workspace) and the cost rule in `CLAUDE.md` (no supplier rates, item costs or margins on this screen).
- What exists and is reused, never forked: T1's Cold Caller workspace `/calling` (its keyboard model: `/` to search, J and K, focus returning to the workspace; `apps/web/src/app/(bos)/calling`), T2's handover and `/converters`, C3's pipelines and the leads board (`/leads`), C4's sizing (`packages/domain/src/sizing`, its screens and commands), S1's quote builder (`/quotes/new`) and quote expiry, S2's orders and credit holds, the call logging and callbacks of T1, N1's notices, the testing lists.
- Skills: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`; `add-command` only if a new command is unavoidable (state why in the report).

1. **Route** `/converting` (menu item "Converting", shown to the Lead Converter role and to those who supervise it, through `screenAccess()` with the permissions the board, sizing and quotes already use; `nav.ts` append-only).
2. **The converter's board:** the leads assigned to the signed-in converter (handed over by T2 or assigned), grouped by their pipeline stage, read through `executeQuery()` with existing queries where they exist; a new query only where none fits, with `EXPLAIN (ANALYZE)` under RLS in the report.
3. **One lead on the same screen:** the lead's summary, its calls and callbacks (log a call and set a callback through T1's commands), its sizing (open or make a sizing through C4's commands and components), and the quote builder (S1's, embedded or opened in place, the same command) — the converter never leaves `/converting` to do these.
4. **Next-best-action list, rules only** (a pure, unit-tested function in `packages/domain`, no model): callback due or overdue; a quote about to expire (S1's validity; use the existing expiry rule, not a new number); sizing missing on a lead in a stage that needs a quote; an order held (S2's credit hold) or blocked; each row opens the lead at the right panel. Name any threshold in `workshop-defaults.ts` only if one is truly new.
5. **Keyboard-first:** the same model as `/calling` (`/` search, J and K to move, Enter to open, keys for log call, callback, sizing, quote shown in a help panel), focus kept visible, every action reachable without a mouse; buttons placed per design system §6 (the alignment lint and `expectAligned`).
6. **Tests:** the next-best-action function (every rule, ties and ordering); any new query on Postgres with the role × company matrix if it reads a new path; the journey `apps/web/e2e/converting.spec.ts`: a converter opens a handed-over lead, logs a call, makes a sizing, builds a quote from the workspace and sees the next-best-action list change, with axe, `expectAligned`, and snapshots in light, dark and 400 px (seed its own figures so the picture does not depend on other journeys).
7. **Documents:** design §9 "Built (L1)", the PRD trace for TEL-03 (tests column), `docs/08-design-system.md` only if a new pattern appears; `pnpm db:docs` only if the schema changes.

Done when: the checks of AGENTS §10 pass on the branch; the journey above passes twice in a row on the same database; `js-budget` holds for `/converting`.

Not in L1: WhatsApp thread and Co-pilot (Phase 2), converter capacity caps, any new price, tax or credit logic, costs or margins. A1 (Triage in shadow) is built at the same time on `feat/a1-triage`: do not edit `packages/domain/src/ai`, the agent tables or `/inbox`. A third builder fixes the journeys on `claude/vibrant-cori-5kst85` (`apps/web/e2e/support`, `calling.spec.ts`, `customers.spec.ts`, `targets.spec.ts`, `notifications.spec.ts`): do not edit those files. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue, `copy-lint.config.json`) are append-only. Matrix fixture offsets, if needed: `per(e, 0x50)` to `0x57`.

**Migrations:** none expected; if one is needed, start at 0128 (A1 also starts at 0128; the lead renumbers at the merge).

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service. If a tool you need is missing, stop and report.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
