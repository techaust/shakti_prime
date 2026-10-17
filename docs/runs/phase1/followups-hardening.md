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

### 17-10-2026, the PC (slot 2, Postgres 54332), Opus 5.5 medium
All eleven items are built on `fix/followups-hardening` (commits `51bdb4d5` to the report's commit). Skills: the brief names none and none was loaded.

**Tests that failed once (cause, and whether the test or the code was wrong)**
1. `orders.test.ts`: not reproduced. Alone: 32 tests in 35.3 s, the longest case 1.9 s; in a full domain run (77 files, 1,019 tests, 523 s) the file took 19.9 s and its longest case 2.3 s, against a 20 s limit per case. The one way the file could wait with no limit was in the test: its clean-up and `confirmedWithoutAccrual()` turned triggers off with `alter table … disable trigger`, which takes a table lock and waits for it without any limit (the migrator has no `lock_timeout`). The test now uses `set local session_replication_role = replica` in those migrator transactions (no lock, no waiting); in `beforeAll` it is set back to `origin` right after the price-list rows, so every later row there runs its triggers. The test was wrong; the code is unchanged.
2. `search.test.ts`: both "puts the exact name first…" cases (leads and team members) now compare the order of their own rows only (`onlyOf`, room for 20 hits); the Suresh lead is in the lead case's own rows, so a lead that should not match still fails it. A team-member search by an Executive reads every staff member of company 1, so another file's person can come in; the lead case's caller has own scope, so no other file's lead can, and it was changed to match. The test was wrong.
3. `customers.test.ts`: the run's word was six id characters with every digit turned into `x` (a few thousand likely words), so a long-lived database met an earlier run's tag name. It is now 12 id characters with each hex digit written as a letter. The test was wrong.
4. `pipelines.spec.ts` "lists the referral partners…": already fixed after the 12-10 failure by `870b96d5` (13-10, waits for hydration before the first click). No change; it passed in both journey runs below (three projects, no retries).
5. `orders.spec.ts` "dealer credit" and the snapshot journey: already fixed after the 09-10 and 10-10 failures by `9e9b5110` (13-10: the row menu waits for hydration; the snapshot journey has `test.slow()`). No change; both passed in both journey runs below.
6. The Aadhaar-column upload: the file's checks run when the upload's event is delivered, by the outbox publisher that the upload's own command starts in the app (no queue in the journeys), and that run first delivers every event still waiting, such as the seed's. The uploader waits 30 s for the checks (`CHECK_WAIT_MS`), then says the check is taking a while and leaves Read the file to the person: the job never opens by itself, so the journey's fixed 45 s wait could run out. `uploadImport()` now follows the file: it chooses Read the file whenever the screen hands it over, until the job opens (up to 120 s). The test was wrong; the screen behaves as designed.

**Product defects**
7. Account 360: `Account360Dto.callConsentWithdrawn` comes from the existing `callConsentWithdrawn()` rule (a contact withdrew consent to calls and gave none since, as the call queue reads it). When it is true, each number shows as plain text with the badge "Asked not to be called" (`customers.contacts.noCalls`), the way do-not-disturb does. The leads list link (`leads-screen.tsx`) is unchanged, as told.
8. Activity log: `auditChanges(before, after, aggregateType)` reads a `state` through the catalogue of the record kind (`opportunity`, `task`, `agent_action`, `duplicate_candidate`, `import_job`, `quote`, `sales_order`), and a kind not listed reads it by value as before. A duplicate card set aside now reads "Set aside"; no new copy was needed.
9. Passed-on enquiry: `crm.enquiry.take` passes the form's consent to `crm.enquiry.route` (`RouteEnquiryInput.consent`, the shared `FormConsentSchema`). The caller may not write the colleague's customer, so the route records the consent through a new definer, `app.record_routed_consent()` (migration `0156_routed_enquiry_consent`, row in DATABASE's definer table). It works only on routed work the caller filed in the same transaction (open, on a customer, in a company of the request, `created_at = now()`) and needs `crm.lead.write:own` and `crm.account.write:own`. It writes the consent on the contact with the typed number, else on the owner contact, given now with the form's source and no proof file, with a `consent_recorded` timeline row. The route's audit row records `consent`. The note: the lead and walk-in forms take no note, so none travels; no note field was added.
10. Push toggle: a new query, `loadPushBrowser()`, and action, `pushBrowser()`, ask whether the browser's subscription address is one of the signed-in person's own (`push_subscriptions_read` shows a person only their own). The toggle reads "on" only then, and otherwise offers Turn on alerts. Turning on drops a subscription another person made on this browser before making a new one (that person's alerts here end, as the `push_browser_taken` path already did).
11. Admin › Agents: checked in the browser before the fix (a scratch journey, not committed). With the old `w-72` wrapper, "As set for the agent here: Needs approval" measured 275 px of text in 238 px of room. On a wide screen the box now takes the width of its chosen label, at least 18rem, and the line under it wraps to the box (`md:w-max md:min-w-72`; the select `md:w-auto md:min-w-full`). On a phone the wrapper fills its row. Afterwards the text was 275 px and the room 276 px.

**Tests added or changed**
- Web unit: `audit.test.ts` +1 (a state by record kind); `activity-details.test.tsx` new, 3 (set aside, dismissed, lead lost, through the component); `push-toggle.test.ts` new, 3.
- Web security: `tests/notifications.test.ts` +1 (`pushBrowser` before, during and after a subscription).
- Domain reader parity: `loadPushBrowser` reads the same on the reader pool as on `app_user`.
- Domain: `customers.test.ts` +1 (`callConsentWithdrawn` false, after a call consent, true after its withdrawal, false after a new consent); `notifications.test.ts`: the take's denied and other-company cases now carry the consent and also run for a colleague's customer (no consent left), the happy path checks the consent on the contact with the typed number (walk-in source, no proof, by the caller), its timeline row and the route's audit `consent`; the push case checks `loadPushBrowser` for the owner, another person, after unsubscribing, and an unknown push service.
- DB security: `notifications.test.ts` +2 (the definer records on the contact with the number, else the owner, with timeline rows; it refuses routed work from an earlier transaction, another person, a request narrowed to another company, a role without the rights and no request).
- Journeys: `customers.spec.ts` (call consent: the number is a call link before and plain text with "Asked not to be called" after the withdrawal), `agents.spec.ts` (no per-action box cuts its label short, desktop projects), `imports.spec.ts` (`uploadImport` follows the file).

**Checks run**
- Typecheck: contracts, db, domain and web, passed.
- Lint of each edited folder (contracts, domain, db/tests, web src, e2e, tests), passed after two fixes; `pnpm copy-lint`: "catalogues and templates are clean"; `pnpm db:docs` regenerated `docs/data/` (the snapshot and the last migration's name).
- Unit, three runs in a row of the changed files: web 24 passed (24) each time. Once each: contracts 182 passed, domain 2,241 passed, web 854 passed and 1 skipped.
- Security, changed files three runs in a row: db `notifications` 13 passed; domain `notifications`, `customers`, `search` and `orders` 84 passed; web `notifications` 18 passed.
- Full domain security run (before items 7 to 10 were finished): 1,016 passed and 3 failed. The three were `Account360Dto` parses that saw the new field while the contract edit was half made; they passed in the later runs.
- Journeys (build, `e2e:seed`, `--retries=0`, three projects), two runs on the same database: customers, agents, imports, pipelines and orders specs. Run 1: 5 failed, 111 passed, 3 skipped. Run 2: 1 failed, 115 passed, 3 skipped. Runs 3 and 4 (customers and agents only, after the agents tweak): 1 failed, 70 passed each time. Every failure was a lead save in `customers.spec.ts` that never answered within its 30 s (mostly "records a consent…" on desktop-light), before any changed step (see the finding below). Runs 5 and 6 (customers, agents and imports, the seed's events delivered first): 84 passed and 2 skipped, both times. Pipelines and orders passed in runs 1 and 2.
- `pnpm test:security`, first run: db 1,263 passed; domain 1,019 passed and 1 failed, `reader-parity.test.ts` "covers every query the domain exports", which now lists `loadPushBrowser` (added, then that file passed three runs in a row, 8 passed). Second run: db 1,263 passed; domain 1,019 passed and 1 failed, `crm-scoring-referrals.test.ts` "rescores the open leads of its scope…", which expects one rescoring batch, but the slot database now holds 1,383 open Farmer Pumps leads in company 1, over `RESCORE_BATCH` (1,000), after six journey runs and three suite runs. It passed in the first run, and nothing here touches scoring. Turbo stopped before the web suite, so it ran alone: 327 passed.
- Whole-repository `pnpm lint` (6 GB heap): passed with no warnings; the one test file changed after it, `reader-parity.test.ts`, was linted on its own: passed.

**`EXPLAIN (ANALYZE)`** (slot database, 32 consents, 7 browsers)
- `loadPushBrowser`: Index Scan using `push_subscriptions_endpoint_unique`, filter on `user_id`; 0.9 ms.
- `callConsentWithdrawn` on Account 360: Index Only Scan on `account_contacts_account_id_contact_id_pk`, Nested Loop Anti Join with two Index Scans on `consents_contact_idx`; 0.5 ms.

**Finding for the lead (not changed here)**
`e2e:seed` leaves its events pending: 202 and 244 in two seeds today. The first commands of a journey run then deliver them inside a person's request (the in-process nudge, `LOCAL_NUDGE_BUDGET_MS`). Here that took 28 to 44 s: `crm.enquiry.take` at 43.6, 30.3, 36.3 and 35.3 s in four runs, each while 63 to 169 events older than a minute were published. The same events took 4 to 5 s from a script on a quiet database. This is likely the common cause of items 5 and 6 and of the customers failures above. One fix is for the seed (or the Playwright global setup) to deliver its events before the journeys start, with `AI_TRANSPORT=fake`. That changes what the journeys start from, so it is left to the lead.

**A new follow-up**
`crm-scoring-referrals.test.ts` "rescores the open leads of its scope…" expects one rescoring batch, so it fails once a long-lived database holds more than 1,000 open leads of its scope in company 1 (`RESCORE_BATCH`). It should count its own leads' batch, or make its leads in a scope of their own.

**Baselines to remake in the Linux image**
- `agents.spec.ts/admin-agents.png`, all three projects: the per-action box is wider on desktop and fills its row on a phone.
- No other screenshot shows a changed screen: the seeded snapshot customer has no withdrawn call consent; `notification-settings` shows alerts as not set up (no VAPID key locally); `activity-log` is the list, not the sheet.

**Decisions the brief did not settle**
- Item 7: the rule is read on the server, the call queue's own rule, rather than worked out on the screen. The badge reads "Asked not to be called".
- Item 9: a definer rather than widening the consents policy. It is limited to routed work filed in the same transaction, and its timeline payload carries the consent id. `FormConsentSchema` lives in `contracts/src/notifications.ts`, since `create-lead.ts` already imports from there and the reverse import would make a cycle. DATABASE cites the migration as 0156, which the lead renumbers at the merge.
- Item 10: turning alerts on ends another person's subscription on that browser before making the person's own.
- Item 1: `session_replication_role` in place of the trigger DDL, the pattern `home.test.ts` already uses. It also skips foreign-key checks in those transactions; every reference to the rows removed is `no action`, and the deletes run children first as before.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
