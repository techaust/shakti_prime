## What this changes

<!-- What it builds or fixes, in final words; the slice or follow-up it belongs to; the PRD requirement IDs it serves. -->

## Migrations

<!-- None, or their numbers and what each does. A slice built while others merged has taken main by a merge and renumbered after main's last migration (docs/runbooks/slice-integration.md §5). -->

## Definition of done (AGENTS.md §10)

- [ ] Every new table: RLS forced and fail-closed, in its `*_TABLES` list, a fixture row per company and a matrix rule; `app_reader` on its select policy and grants
- [ ] Every new command: denied, wrong-company and happy-path tests; labelled `auditFields`; in the agent refusal sweep unless an agent may run it
- [ ] Every user-facing word final plain English in `apps/web/messages/en.json`; copy lint clean
- [ ] New screens: end-to-end journey with axe, Linux baselines made on a fresh database; the JavaScript budget holds
- [ ] New lists or searches: `EXPLAIN` evidence under RLS
- [ ] Documents match the code (module documents, the design's "Built" record, `pnpm db:docs`, `machines:docs`); no change-log wording
- [ ] Nothing invented that the client must give (tax rates, prices, numbering, scripts, targets)

## Checks run

<!-- Each check with its summary line: lint, typecheck, unit tests, security suite, build with .env aside, JavaScript budget, end-to-end, secret scan. Say what was not run. -->

## For the owner

<!-- Decisions, hosted steps or inputs this needs from the owner or the client; "None" if nothing. -->
