# Auditor 6: architecture, code quality, and documents against code (main at 23f78a5)

## Score
**8 / 10.** The architecture holds together. Every write in `apps/web` goes through `executeCommand()`. All 98 reads go through a named `executeQuery()`. There are 126 commands, all registered and all audited. Every state change goes through its machine. There are no TODO or FIXME markers. There are two lint suppressions and no `@ts-ignore`. The documents match the code unusually well:
- the link check reports `bad 0`;
- all 77 live tables and every live security definer are named in DATABASE, and every definer pins its `search_path`;
- the permission table in SECURITY is tested against the seed;
- every script, route and file the documents name exists.

The score loses points for four reasons:
1. The "one command layer" fence has a gap the lint does not cover. `apps/web` can define and run its own command, or run raw SQL inside `executeQuery`. I confirmed this with a lint probe.
2. Two Phase 1 PRD acceptance criteria are unbuilt and have no owning slice. Order numbers are not searchable in ⌘K (RPT-03), and a lead's score does not show who last changed it (CRM-06).
3. One business rule (routing an enquiry to the colleague who looks after the customer) lives in a server action.
4. Wave 4 and 5 slices left several documents behind: the PRD trace, the TESTING tables, the ROADMAP milestones, ARCHITECTURE and the JavaScript budgets.

To reach 10:
- close the fence: commands only from the registry, and no `drizzle-orm` in `apps/web` outside `src/auth`;
- build order-number search and "changed by";
- move enquiry routing into a domain command;
- work out dealer exposure in one place;
- bring the PRD §8 trace, TESTING §2 and §3, ROADMAP §1.1, README and the budgets up to date.

## Findings
| id | severity | effort | title | file:line | failure path | fix |
|---|---|---|---|---|---|---|
| ARCH-1 | medium | S | The import fences allow `apps/web` to write around the domain command layer: it can define and run its own command, and run any SQL inside `executeQuery` | `eslint.config.mjs:97-101` (only `withRequestContext`, `schema` and `entityIdsLiteral` are fenced); `packages/domain/src/index.ts:1,4` (exports `defineCommand`, `runCommand`); `packages/domain/src/command/execute.ts:67-72` (`executeCommand` takes any `Command`, with no registry check), `:192-196` (`executeQuery` takes any closure over `RequestContext`); `apps/web/package.json` lists `drizzle-orm` | *Confirmed.* I linted synthetic text under `apps/web/src/actions/zz-probe.ts` through the repository's ESLint config, the same way `lint-fences.test.ts` does. These imports all pass: `import { defineCommand, executeCommand } from '@shakti/domain'`, `import { sql } from 'drizzle-orm'`, `import type { RequestContext } from '@shakti/db'`. A builder can therefore write `executeCommand(p, s, defineCommand({ name:'x.y.z', permission:'crm.lead.read', ..., handler: (ctx)=>ctx.tx.update(...) }), input)` in a server action. That write lives outside `packages/domain` (CLAUDE.md "Never write to the DB from anywhere else", AGENTS §11), never appears in the registry, and so escapes three checks: the agent refusal sweep (`agent-refusals.test.ts` picks commands from the registry), the label check in `audit.test.ts`, and the registry test. A page can also run `executeQuery(p, s, ({tx}) => tx.execute(sql\`...\`))`, a read that skips the domain query's `checkPermission`; RLS still applies. AGENTS §3 says ESLint enforces that `apps/web` reaches the database only through domain commands and queries. | Add `defineCommand`, `runCommand`, `databaseAuditSink`, `databaseOutboxSink` and `databaseIdempotencyStore` to the `@shakti/domain` `importNames` fenced for `apps/web/src`. Restrict `drizzle-orm` in `apps/web` outside `src/auth`. Make `executeCommand` refuse a command that is not `getCommand(command.name)`. Add these probes to `lint-fences.test.ts`. |
| ARCH-2 | medium | S | PRD RPT-03 (Phase 1): order numbers are not searchable, and no slice owns that part | `apps/web/src/actions/search.ts:22-36` (searches leads, quotes and people only); `packages/domain/src/queries/sales/list-orders.ts:94-110` (filters by state only, no number search); `docs/03-roadmap-appendix/phase1.md:42` (S1 owns "RPT-03 (quote numbers)"; S2 at `:47` does not list RPT-03); `docs/02-prd.md:349` (the MVP row: "Phone, name, village, quote and order numbers") | *Confirmed (code read end to end).* Accounts or a General Manager types an order number (`sales_orders.so_no`, e.g. from a dealer's call) into ⌘K or `/orders` and finds nothing. The only way to reach the order is through its quote or its customer. No decision in DECISIONS defers this. *Plausible, same criterion:* a dealer customer with orders but no lead is not found by name or phone in ⌘K, because the palette searches leads, not customers. | Add `searchSalesOrders` (an index on `(entity_id, so_no)`, read under the order's policies) to `searchPalette`, plus an `EXPLAIN` under RLS. Add RPT-03 (order numbers) to the slice table and the PRD §8 trace. |
| ARCH-3 | low | S | PRD CRM-06 (Phase 1): the lead's score shows when it last changed, but not by whom | `packages/domain/src/queries/crm/lead-dto.ts:31`; `packages/contracts/src/dto/lead.ts:18`; `apps/web/src/components/leads/leads-screen.tsx:206-221`; `apps/web/messages/en.json:1272` (`"Last changed {when}"`) | *Confirmed.* `opportunities.score_changed_by` is written by `lead-attribution.ts:54`, `lead-scoring.ts:148` and `commit-leads.ts:312`, but it is never put in the DTO or shown. A team lead who sees a score jump cannot tell whether a person, an import or the nightly rescore changed it. The acceptance criterion "the last change (when and by whom) are visible on the lead" is unmet, and no decision defers it. | Carry the changer in `LeadDto` (a person's name; "Brought up to date overnight" for `system:workers`) and add it to the score popover and the lead page. |
| ARCH-4 | low | S | A business rule lives in a server action: routing an enquiry for a colleague's customer | `apps/web/src/actions/crm.ts:117-161` (`takeEnquiry` at :124), `:169-174` (`routeKey`), `:177-183` (`heldByColleague`) | *Confirmed.* Rule: when a colleague looks after the customer, the enquiry goes to that colleague (PRD RPT-04 criterion 2). It is implemented only as a try/catch around two `executeCommand` calls in the web action. This breaks API §4 ("No business logic in actions"). Three effects: (1) any other entry path to `crm.lead.create` (the Phase 2 `/api/v1` ingest, the voice agent) refuses the enquiry instead of routing it, unless it copies this code; (2) the two commands run in separate transactions, so a crash between them leaves only the refusal; (3) every routed enquiry first writes a `failed` audit row for `crm.lead.create` (`execute.ts` `recordRefusal`), which the Activity log shows as a failed lead creation. | Add a domain command (e.g. `crm.enquiry.take`) that runs `crm.lead.create` inside `ctx.savepoint()`, catches `customer_held_by_colleague` and runs `crm.enquiry.route` in the same transaction. The action then becomes a thin wrapper. |
| ARCH-5 | low | S | Dealer exposure is worked out in three places, and only one of them follows the SALE-5 setting | `packages/domain/src/sales/credit-check.ts:52-56` (counts confirmed orders only if `WORKSHOP_DEFAULTS.credit.exposureCountsConfirmedOrders`); `packages/domain/src/queries/home/home.ts:224-225` (always counts them; its comment at `:210-214` calls the definer "the one place the exposure is worked out"); `packages/domain/src/queries/sales/dealer-credit.ts:99-100,127` (always counts them, "the exposure the credit check reads") | *Confirmed (code).* Today both settings agree, because SALE-5 defaults to `true`. If the workshop answers SALE-5 "confirmed orders do not count" and the default is flipped, confirmations stop counting confirmed orders. Accounts' home and `/dealer-credit` would still count them, so dealers whose orders confirm would show as over their limit, and Accounts would chase the wrong dealers. | Work out exposure (and its overdue test) once, either in `app.dealer_credit_position()` with the flag passed in, or in one TypeScript function that all three call. |
| ARCH-6 | low | S | Seven Phase 1 pages have no measured JavaScript budget and fall back to the 250 kB default | `apps/web/js-budget.json` (no entry for `/orders`, `/orders/new`, `/orders/[entityId]/[orderId]`, `/dealer-credit`, `/targets`, `/knowledge`, `/converters`); `docs/09-testing.md:174` ("Each page's budget … is its measured size plus 5 %") | *Confirmed.* Comparable staff pages are budgeted at 195–213 kB (e.g. `/home` 195, `/converting` 213, `/quotes/new` 205). These seven pages were added by S2, R1, K1 and T2 without entries, so CI passes them up to 250 kB. One of them can grow by about 40 kB (a whole chart or PDF library pulled into a client component) and no check fails. That is the regression the per-page budget exists to catch (BLUEPRINT §11.4, NFR-01). | Measure each page after `pnpm build` and add entries at the measured size plus 5 %, with reasons. Make `js-budget` fail on an app page with no entry. |
| ARCH-7 | low | S | PRD §8 traceability is stale for two Phase 1 requirements | `docs/02-prd.md:407` (RPT-04 says "—", no test); `:411` (AI-01 lists only `files.test.ts`) | *Confirmed.* N1 merged with `packages/db/tests/security/notifications.test.ts`, `packages/domain/tests/commands/notifications.test.ts`, `apps/web/tests/notifications.test.ts`, `apps/web/src/notifications/push.test.ts`, `packages/domain/src/notifications/push-plan.test.ts` and `apps/web/e2e/notifications.spec.ts`. K1 merged with `packages/db/tests/security/knowledge.test.ts` (the per-role retrieval AI-01 requires), `packages/domain/tests/commands/knowledge.test.ts`, `apps/web/src/workers/knowledge/job.test.ts` and `apps/web/e2e/knowledge.spec.ts`. A UAT lead or the client reading §8 sees RPT-04 as untested. This breaks AGENTS §10 ("Documents … match the code"). | List these tests in the two rows. |
| ARCH-8 | low | S | ROADMAP milestones and the README describe a state two waves old | `docs/03-roadmap.md:23,29,31` (the last milestone reached is 06-10-2026; "Wave 4 complete (N1, T2, S2, K1)" and K1/A1 are listed as ahead); `README.md:36` ("Everything runs on the owner's PC … for when cloud sessions resume") | *Confirmed.* STATUS says waves 1 to 5 are merged (#133–#147). DECISIONS 09-10-2026 made cloud sessions a full working mode, and CLAUDE.md now says "the PC or a cloud session, whichever the owner chooses". A reader of the roadmap or README is told wave 4 is still to come and that cloud work is paused. | Add wave 4 (08–09-10) and wave 5 (10-10) to ROADMAP §1.1, remove the wave 4 row, reword the agents row to depend only on the keys, and align README "Where work runs" with CLAUDE.md. |
| ARCH-9 | low | S | TESTING omits the wave 4–5 security files and spike scripts | `docs/09-testing.md:32` (no `spike:orders`, `spike:targets` or `spike:knowledge`; all three are in `packages/domain/package.json`); §3 table (no row for `caller-profiles`, `knowledge`, `sales-orders` or `targets` in `packages/db/tests/security`) | *Confirmed.* TESTING §3 presents itself as the file-per-rule map of the security suite, yet the files proving the RLS of four Phase 1 tables are missing from it. A reviewer checking coverage of `targets` or `knowledge_chunks` from the document concludes they are untested. | Add the four rows and the three spike commands. |
| ARCH-10 | low | S | ARCHITECTURE calls A1's built work "planned" and describes an unused table as live | `docs/04-architecture.md:29` ("output filters on outbound messages (planned, A1 / Phase 2)"); `:323` ("`agent_evals` stores prompt versions, eval sets and scores") | *Confirmed.* A1 built `filterTriageAnswer()` (`packages/domain/src/ai/triage/filter.ts`). `agent_evals` is written by nothing: `git grep agentEvals` matches only `packages/db/src/schema`, and the eval sets live in `tests/fixtures/triage-sets.ts`. | Say the Triage output filter is built and the outbound-message filters come in Phase 2. Say `agent_evals` is reserved for the eval gate, with no writer yet. |
| ARCH-11 | low | S | Duplicated helpers and one dead fixture | IST offset `330 * 60_000` redefined in `packages/domain/src/telecom/call-schedule.ts:12`, `ai/provider.ts:160`, `ai/triage/read-facts.ts:14`, `sales/targets.ts:4`, `state-machines/machines/quote.ts:49`, `numbering/financial-year.ts:5`, `apps/web/src/screens/calling.ts:89`, `shadow-report.ts:10`; `istDay()` defined three times (`ai/provider.ts:159`, `apps/web/src/print/format.ts:64`, `screens/shadow-report.ts:13`); the worker-route `failure()` helper copied into 12 routes (`apps/web/src/app/api/v1/workers/*/route.ts`), with `quotes/expire`, `files/sweep` and `outbox/publish` repeating what `workers/nightly-route.ts` already factors out; `apps/web/src/print/fixtures/spike-images.ts` is imported by nothing | *Confirmed (code).* The audit of September closed L18 (duplicated magic values) by fixing them in one place. These copies came back with later slices. A future change to the calling day, the quote's end-of-day or a worker's retry headers has to be made 8–12 times. All copies agree today. | Use `istCalendarDate`/`istDayStart` from `numbering/financial-year.ts` everywhere. Share one `workerFailure()` and one signed-body prelude for the QStash routes. Delete the unused fixture. |

## Checked and sound
- **Import fences**, probed by linting synthetic text with the repository config:
  - These are refused as AGENTS §3 says: `@shakti/db/{client,testing,auth,outbox,bootstrap,grants}`, `postgres`, `drizzle-orm/postgres-js`, `withRequestContext`/`schema` in `apps/web`, relative `.js` imports, dynamic and built specifiers, `require`/`createRequire`, and testing helpers in journey specs.
  - The per-folder exceptions are as documented: auth, outbox workers, the import worker, scripts and the e2e seed.
  - `contracts`, `ui` and `tokens` have no workspace dependencies in `package.json`, so pnpm's strict linking blocks a stray import there.
  - Browser code imports no value from `@shakti/domain` or `@shakti/db`.
- **One command layer:**
  - all 126 `defineCommand` calls are registered;
  - every command writes at least one audit row (runner `run-command.ts:473-487`);
  - every `executeQuery` in `apps/web` (98) carries a `name`;
  - there is no `tx` use or `drizzle-orm` import in `apps/web` outside `src/auth`;
  - workers write only through registered commands;
  - the writes outside commands (the Better Auth adapter, auth audit events, the outbox publisher's delivery marks, the bootstrap, seeds, pg_cron) are each documented in DATABASE §3;
  - state changes go through machines (`fireUpload`, `transition`); no command sets a machine's state field by hand;
  - every `reason` in source maps to an `errors.*` sentence;
  - every `constraintReasons` key is a live constraint or a raised constraint name;
  - every worker route's status matches `ERROR_HTTP_STATUS`.
- **The database against the documents (live, on the local Postgres):**
  - all 77 public tables are in DATABASE and every "Built" row exists;
  - every `app.*` security definer is listed with `search_path` set;
  - no `app.*` function is unused;
  - `app.platform_only_permissions()` grows strictly across its 8 redefinitions (0073 → 0125), and a test keeps it equal to `PLATFORM_ONLY_PERMISSIONS`;
  - `system:workers` holds exactly the 8 platform-only grants;
  - the append-only triggers are on `audit_logs`, `price_change_log`, `activities`, `calls`, `quote_lines`, `sales_order_lines`, `dealer_terms`, `dealer_outstanding`, `targets`, `agent_runs`, `agent_actions` and `sizings`, with no `UPDATE`/`DELETE` grant to `app_user` on the ledgers;
  - there are 18 seeded roles, as TESTING says.
- **Documents:**
  - `check-doc-links.py`: `bad 0`;
  - my own check of backticked `apps/`/`packages/` paths and of every `*.ts` named in PRD §8, the design, the runbooks, AGENTS and CLAUDE.md: all exist, apart from planned apps and spike output;
  - every `pnpm` script the documents name exists;
  - the routes match API §3 and §3.6;
  - CI jobs match TESTING §6;
  - Turbo's three uncached tasks match CLAUDE.md;
  - `bom1` is pinned in `vercel.json`;
  - the production config check matches CLAUDE.md (MAILER required; ses in production);
  - model ids match ADR 0011;
  - the ADR statuses are consistent with DECISIONS;
  - STATUS's slice count (21 of 23) and migrations (0000–0129) match `main`;
  - every journey runs `expectNoAxeViolations`;
  - every BOS page calls `screenAccess`.
- **Code health:**
  - no TODO/FIXME/HACK;
  - two `eslint-disable` lines, both with reasons;
  - no `@ts-ignore`;
  - no module-level secret reads;
  - the largest modules are 1,012 lines (generated docs) and 995 lines (a dialogs file), within reason for their content.
- **Exit gates:**
  - **Phase 0:** two items are met (the security suite and the tooling). Four are deferred by the owner's decision of 29-09-2026 (design sign-off, the seven spikes, the review of the ERD and contracts, the vendor quotes). Each waits on the client, a vendor or a sandbox, so none can be met by code alone.
  - **Phase 1:**
    - tooling: met;
    - the two-week parallel run, reconciled migration counts and UAT sign-off: deferred to M1 (in flight on `feat/m1-migration-uat`) and to G1 with the client's data;
    - "Playwright E2E for the CC, LC, Store Manager and Executive paths": partly covered (`calling`, `converting`, `walk-in`, `targets` home journeys); the role journeys against staging are in flight in M1.
- **PRD Phase 1 requirements checked as built:**
  - CRM-01 to CRM-05, CRM-07, CRM-09 and CRM-10;
  - TEL-01 (scripts wait on CALL-2), TEL-02, TEL-03 and TEL-06;
  - SAL-01 to SAL-07;
  - INV-01, RPT-01, RPT-04, RPT-05 and IMP-01;
  - AI-01, AI-04 and AI-05;
  - NFR-01, NFR-04, NFR-10 and NFR-12.
  - The exceptions are RPT-03 (ARCH-2) and CRM-06 (ARCH-3). IMP-02 is M1, in flight.
- **Not checked:**
  - the test counts in STATUS (they need full suite runs);
  - the hosted environments (out of bounds);
  - whether `docs/data` and `docs/state-machines` are current (CI's generated-files step covers them, and regenerating would write to the repository).
