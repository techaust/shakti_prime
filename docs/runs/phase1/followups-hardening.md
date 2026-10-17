# Hardening follow-ups, batch 1 (wave 6, beside G1)

| | |
|---|---|
| Branch | `fix/followups-hardening` on GitHub, from `main` at 485a43eb (#184) |
| PC worktree | `followups-hardening`, slot 2: Postgres 54332 (container `shakti-pg-followups-hardening`), app 3032 |
| Runs on | PC, beside G1 (owner, 17-10-2026: spend the week's remainder before the reset) |
| Tier | B (notifications, consent on a passed-on enquiry, flaky tests): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | build Opus medium from week 83, 5h 11 (17-10-2026) |
| State | building |
| Next step | the builder reports; the lead reads the diff and starts the review |

## Brief
Open follow-ups from [STATUS](../../10-status.md#open-follow-ups) that need no client input: tests that fail by order or time, and small product defects. No change to tax, price, credit or row-level security policies; a migration only if item 9 needs one, and then as [AGENTS §6](../../../AGENTS.md#6-database-changes) says.

**Tests that failed once and passed on retry.** For each: find the cause, fix it in the test (or in the code when the code is wrong), and say which it was in the report.
1. `packages/domain/tests` `orders.test.ts` timed out once in a full domain run and passed alone (09-10-2026).
2. `search.test.ts` "puts the exact name first…" failed once on `main` after #168: another test's person can match the fuzzy name search. Make the case independent of other files' rows.
3. `customers.test.ts` reused a random tag name of an earlier run on the same database (M1's run, 13-10-2026): make its names unique per run.
4. `apps/web/e2e/pipelines.spec.ts` "lists the referral partners…" was flaky once in the Linux screenshot run (12-10-2026).
5. `apps/web/e2e/orders.spec.ts` "dealer credit" failed once in a screenshot run and passed on retry (10-10-2026); the orders snapshot journey's page load can pass 60 s on a loaded PC.
6. The Aadhaar-column upload journey once took more than 45 s to open its job on CI's desktop-dark run (#175); about 8 s locally. Find what it waits on and make the wait follow the job's state, not a fixed time.

**Product defects.**
7. Account 360 marks a withdrawn call consent beside the number but keeps its `tel:` link: drop the link when call consent is withdrawn (the number stays readable to whoever may read it).
8. The Activity log reads a duplicate card set aside as "Dismissed", the agent action's word, because states are looked up by value alone: look states up by the activity's kind and value, so each kind uses its own catalogue key. New copy goes in `apps/web/messages/en.json` and passes `pnpm copy-lint`.
9. A passed-on enquiry carries no note and drops a consent captured on the walk-in form (N1 review L2): the note and the consent travel with it through the existing command layer, the consent recorded as the walk-in form recorded it (same source and evidence), with the denied, wrong-company and happy-path tests the command already has extended.
10. The push toggle tells a second person at a browser held by another that alerts are on (#168 review L4): the toggle reads "on" only when this browser's subscription belongs to the signed-in person; otherwise it offers to turn alerts on for them.
11. Admin › Agents: the per-action autonomy select cuts its text short on desktop: the trigger shows the whole chosen label (a width or layout fix in the screen, tokens only, no hard-coded colour).

Files: the tests and screens above, their commands and queries, `en.json`. Not here: anything G1 owns (`feat/g1-production`: `.github/`, `release.yml`, `infra/aws/files.yaml`, `apps/web/scripts/qstash-schedule.ts`, `apps/web/src/auth/deps.ts`, deploy and accounts runbooks). Shared lists are append-only.

Done when: each changed unit test passes three times in a row, each changed journey twice in a row on the same database; the security suite passes on the slot's Postgres if item 9 touches a command or a definer; a screen change has its journey and, where the screen has a screenshot, the baselines that change listed for the lead to remake in the Linux image (do not remake them on the host).

**How to work:** another builder (G1) runs beside you on the 8 GB PC, so every lint, typecheck, test, build and journey, folder-level ones too, goes through `bash tools/integration/heavy.sh <command>` (the main checkout's copy). Commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Never open a pull request, install a dependency or touch a hosted service.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
