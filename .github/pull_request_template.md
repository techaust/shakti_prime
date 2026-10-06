## What this changes

<!-- What it builds or fixes, in final words; the slice or follow-up it belongs to; the PRD requirement IDs it serves. -->

## Migrations

<!-- None, or their numbers and what each does. A slice built while others merged has taken main by a merge and renumbered after main's last migration (docs/runbooks/slice-integration.md §5). -->

## Definition of done (AGENTS.md §10)

<!-- The same list as AGENTS.md §10, word for word; tick what holds, strike through a line that does not apply. -->

- [ ] The code path works end to end (contract → command → tests → server action or route → screen), with no layer half wired.
- [ ] Every new table: RLS enabled, forced and failing closed; in its `*_TABLES` list with a fixture row per company and a rule in the role × company matrix; `app_reader` on its select policy and its select grant; `NARROWER` and `enum-sync` where they apply (§6).
- [ ] Every new command: denied, wrong-company and happy-path tests on real Postgres; every `auditFields` key labelled in `apps/web/src/screens/audit.ts`; a restricted command's input in the agent refusal sweep (§5).
- [ ] The tests of §7 pass locally and in CI, the security suite included, run on the local Postgres.
- [ ] Migrations apply cleanly on a fresh database, and, once staging holds data worth keeping, on a copy of staging (`docs/13-client-packs/exit-gate-actions.md`).
- [ ] Every user-facing word is final plain language in `apps/web/messages/en.json` (English on screen, Hinglish only in the spoken channels), and `pnpm copy-lint` passes.
- [ ] New or changed screens: an end-to-end journey with axe; Linux screenshot baselines made on a fresh database; the JavaScript budget per page holds.
- [ ] New lists and searches: `EXPLAIN (ANALYZE)` evidence under RLS.
- [ ] Documents and contracts match the code: the module documents, the design's "Built" record, `pnpm db:docs` and `machines:docs` regenerated; no change-log wording.
- [ ] Nothing invented that the client must give (tax rates, prices, numbering, scripts, targets).
- [ ] The summary states what was verified and how, and what was not.

## Checks run

<!-- Each check with its summary line: lint, typecheck, unit tests, security suite, build with .env aside, JavaScript budget, end-to-end, secret scan. Say what was not run. -->

## For the owner

<!-- Decisions, hosted steps or inputs this needs from the owner or the client; "None" if nothing. -->
