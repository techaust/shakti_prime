# T2 Handover (wave 4)

| | |
|---|---|
| Branch | `feat/t2-handover` on GitHub, from `main` at 9fd37458 (#135) |
| PC worktree | `D:/shakti-wt/t2-handover`, slot 19: Postgres 54349 (container `shakti-pg-t2-handover`), app 3049 |
| Runs on | PC only, one agent at a time this week, heavy commands through the PC's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | B (state machines, permissions, workers): build Sonnet medium, review Opus |
| Usage | build (Sonnet, medium, 09-10-2026): 74 % of the week at its start |
| State | built, checks pass (see the Report for the two not-rerun-safe tests) |
| Next step | review (Opus) |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §8.2](../../03-roadmap-appendix/phase1.md#82-t2-handover), §3, §4, §11 (q2, the lock period) and §12; §7.2 "Built (T1)" for `moveCallTasks()`, `cancelCallTasks()` and the callback rules; §8.1 "Built (N1)" for the `lead_assigned` notice and the Agent Inbox routing.
- PRD TEL-02 (both acceptance criteria) and its trace row; BLUEPRINT's telecom and lead-ownership sections.
- [ADR 0020](../../adr/0020-system-workers-treated-as-agent.md), SECURITY §3.3 (agent and system principals), DATABASE §4.1 (definers), AGENTS §5 and §6.
- Workshop pack CALL-4 (the lock period: `WORKSHOP_DEFAULTS.opportunity.handoverLockHours`, 48 h today; per pipeline `lock_hours` where set). No new client value is invented.
- What exists: the opportunity machine (`packages/domain/src/state-machines/machines/opportunity.ts`: `stage.move` with the effect `handover_if_qualified`, `assign` from `open` only with the guard `lockFree`, `locked_until`); `crm.opportunity.assign`; `crm.lead.assign` (Executive all, General Manager entity, Sales Team Lead team); T1's `moveCallTasks()` and `cancelCallTasks()` (`packages/domain/src/commands/crm/call-tasks.ts`); `app.hand_over_customer()` (it answers `unchanged` for any `agent:%` or `system:%` request since 0064); `system:workers` and `SYSTEM_MATRIX` (`packages/contracts/src/system-principal.ts`), `app.platform_only_permissions()` (latest in `0123_knowledge_rls.sql`: seven keys); the event workers and outbox (`apps/web/src/workers`), Upstash Redis; N1's `lead_assigned` notice.
- Skills: `add-command`, `add-table`, `vercel-react-best-practices`, `web-design-guidelines`, `writing-guidelines`.

**Owner decision (09-10-2026), to build and record:** a round-robin handover moves the customer relationship to the converter, as a person's handover does. So `app.hand_over_customer()` stops treating `system:%` requests as agents for the handover move (agents still never move it); the read rule (`account_entities_read`, `app.lead_search_ids()`) stays as it is for `system:workers`. ADR 0020's status becomes decided with this outcome and the migration that applies it; SECURITY §3.3 and DATABASE say the same.

1. **Table** `caller_profiles` (AGENTS §6 in full: RLS forced and failing closed, the testing lists, a fixture row per company and its matrix rule (take the next free `per()` offsets after K1's 0x42/0x43, and check `main` for any clash), `app_reader`, `NARROWER` and `enum-sync` where they apply): `user_id`, `entity_id`, `is_converter`, `presence` (present / away), `max_open` (null for no cap), `languages` (text[] from the existing language values), `segments` (text[] from the existing segment values), `updated_at`, `updated_by`; one row per person and company. Read by the person themself and by whoever may assign leads in that company; written by the Sales Team Lead (team), General Manager (company) and Executive; a person may set only their own `presence`.
2. **Permissions:** reuse `crm.lead.assign` for editing profiles and moving a leaving caller's leads unless SECURITY §3.2 names another key; if a new key is needed, give it its SECURITY row, seed, oracle case and refusal-sweep entry. `system:workers` gains only what the handover command needs, as a platform-only permission (add it to `app.platform_only_permissions()` keeping all seven existing keys, and to `SYSTEM_MATRIX`), never a person's `crm.*` grant (ADR 0020, CLAUDE.md "The workers principal holds platform-only permissions"); it reaches leads, profiles and tasks through narrow definers that check that permission.
3. **The handover** on `crm.opportunity.stage_moved` when the target stage is `qualified` (the event's `handover: true`): an event worker picks a Lead Converter by the pure function `pickConverter()` in `packages/domain` (present, under `max_open`, language and segment match, fewest open leads; ties by a weighted round-robin cursor kept in Redis per company, with the pure function deciding from the cursor so it is unit-tested without Redis), and assigns the lead as `system:workers` through the assign path within 10 seconds of the event (measure it in a test with the outbox nudge). No converter qualifies: the lead goes to the company's Sales Team Lead (the lead's team lead, else any in the company), through the Agent Inbox as N1 routes work, with a notice. The assignment sets `locked_until` (the pipeline's `lock_hours`, else the 48 h workshop default) so no other caller takes the lead during the lock; the Sales Team Lead can still reassign (TEL-02 AC 2). Idempotent on redelivery (claim by event id; a lead already assigned by this handover is left alone).
4. **Callbacks and nurture (design §8.2):**
   - the handover and every reassignment move an open lead's callbacks to the new owner (T1's rule), including when the assigner is `system:workers`: today `moveCallTasks()` moves only tasks in the assigner's `crm.lead.write` scope, so give the worker's path a definer that moves that lead's open callbacks (and test the handover with a callback open);
   - nurtured leads: allow `assign` from `nurture` in the opportunity machine (stays in nurture, owner changes, its nurture calls move to the new owner), with `machines:docs` regenerated; say so in the report.
5. **`crm.lead.reassign_all`** (people only; the Sales Team Lead for their team, the GM and Executive): moves every open and nurtured lead of a leaving caller in a company to one named person or round-robin over the eligible converters, through the same assign path, with their callbacks and nurture calls; refuses a target who is not active in that company; audited; returns the count moved.
6. **Customer relationship:** the owner's decision above, with a test that a round-robin handover moves the customer's "looked after by" and that an agent's handover still does not.
7. **Screens** (each with a journey, axe, copy in `en.json` per `docs/08-design-system.md` §11, the JavaScript budget):
   - a "Lead converters" page under Admin (or Settings, following where the menu keeps team settings): each person's converter switch, presence, capacity, languages and segments, editable by the Sales Team Lead, GM and Executive;
   - a person's own presence switch (top bar or profile, wherever is lightest for the bundle);
   - "Move all leads" for a leaving caller on Admin › Team members (the row menu), with the target choice.
8. **Tests:** `pickConverter()` unit tests (each rule, ties, the cursor, nobody qualifies); the machine's new `assign` from `nurture`; the handover end to end on Postgres (qualified → assigned within 10 s, lock set, callback moved, customer moved, notice sent; nobody qualifies → Sales Team Lead's inbox); `reassign_all` (denied, wrong company, happy path); the agent refusal sweep; the role × company matrix; the follow-up from STATUS (a nurtured lead's owner and nurture calls on reassignment). Journeys: a tele-caller qualifies a lead and a present converter gets it with the bell; the converters page; Move all leads.
9. **Documents:** DATABASE (the table, definers, the `hand_over_customer` change), SECURITY (§3.2 rows, §3.3 and the platform-only list), ADR 0020 (decided), design §8.2 "Built (T2)", the PRD trace for TEL-02, the workshop pack's CALL-4 "Today" line if the slice changes it, `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch; a journey qualifies a lead and sees it assigned to a present, matching converter with the lock set and the callback moved; with no converter present the lead reaches the Sales Team Lead; a leaving caller's leads move at once.

Not in T2: the Lead Converter workspace (L1), WhatsApp and Exotel (Phase 2), per-pipeline lock editing beyond what exists, any client value (CALL-4 stays the 48 h default until the workshop answers).

**How to work:** commit at least every 20 minutes and at each finished layer; long output to log files, reading summaries only; the whole-repository lint once, last. Stop the slot's Postgres and app at the end (`docker stop shakti-pg-t2-handover`). Never push to `main`, open a pull request, install a dependency or touch a hosted service. If a tool you need is missing, stop and report.

## Report

### 09-10-2026, PC, Sonnet medium (slot 19)

**Built.** Skills loaded: `add-table`, `add-command`, `vercel-react-best-practices`, `web-design-guidelines`, `writing-guidelines` (the last two fetch their rules from a site this run may not reach, so their rules were applied from memory of the design system only).
- Schema and migrations: `0124_caller_profiles` (the table) and `0125_caller_profiles_rls` (RLS forced; read by the person and by a manager through `app.caller_profile_manages()`; insert and update policies; the guard trigger `caller_profiles_guard`, which holds requests only; the eighth platform-only key `crm.handover.run` in `app.platform_only_permissions()`, keeping the seven of 0123; `app.new_uuid7()`; the definers `app.caller_profile_people()`, `app.handover_lead_facts()`, `app.handover_candidates()`, `app.handover_team_lead()`, `app.handover_assign()`, `app.handover_route_to_team_lead()`; `app.hand_over_customer()` redefined from 0064's text with the agent-only test and the handover permission). Testing lists, fixture rows at `per(e, 0x44)` and `0x45` (no clash with K1's 0x42 and 0x43), matrix rule, `NARROWER`, `enum-sync` and the reader grants are done.
- Contracts: `packages/contracts/src/commands/crm/handover.ts`, the permission, `SYSTEM_MATRIX`, the event catalogue (`crm.opportunity.stage_moved` subscribed; `emittedBy` of `crm.opportunity.assigned`).
- Domain: `pickConverter()` and `qualifiesAsConverter()` (`packages/domain/src/crm/handover.ts`), the commands `crm.caller_profile.set`, `crm.caller_profile.set_presence`, `crm.opportunity.hand_over` and `crm.lead.reassign_all`, the queries `listCallerProfiles` and `loadOwnPresence`, and the machine's `assign` from `nurture` (`machines:docs` regenerated).
- Worker: `apps/web/src/workers/handover/handover-event.ts`, registered for `crm.opportunity.stage_moved` in `EVENT_WORKERS`; the Redis cursor is `handover:cursor:<company>`.
- Screens: `/converters` (menu item Lead converters), "Taking new leads" on Settings › Your profile, "Move all leads" on Admin › Team members, and a variant of the Agent Inbox routed-work card for a qualified lead. Copy is in `en.json`; the audit labels are in `audit.ts`.
- Documents: DATABASE (table, definers, `hand_over_customer`), SECURITY (§3.2 row, the platform-only list, §3.3, a handover paragraph), ADR 0020 (Decided, with the outcome), design §8.2 "Built (T2)", the PRD trace for TEL-02, `db:docs` and `machines:docs`. The decision row in `docs/11-decisions.md` is the lead's to reconcile with #136.

**Decisions the brief left open.**
- No converter qualifies: the lead is assigned to the Sales Team Lead (the lead's team's own lead, else a Sales Team Lead of that team, else any in the company) with an open `routed_work` inbox item on the lead (`subject_type` opportunity, so the card reads "is ready for a quote", not "asked again"); the assigned notice is the notice. A company with no Sales Team Lead leaves the lead where it is (`no_one`).
- "Weighted" is the fewest open leads, then ties in turn after the cursor (the person chosen last), decided in the pure function.
- A converter's languages and segments: an empty list takes all. The lead's language is the preferred language of its customer's owner contact (else any contact; Hinglish when none); the segment is the pipeline's.
- Presence is `away` until the person switches it. Its switch is on the profile page (`profile.write`), per company the person works in. Profile edits reuse `crm.lead.assign` (no new person permission); a team-level manager manages the people of their own team, and the page and actions are narrowed to the chosen company so team scope applies.
- The handover is made once per event: the event's id is stored in the lead's timeline row, and Redis (`deliverEvent`) claims the id as well.
- `crm.lead.reassign_all` moves at most 500 leads a run, counts each pick in a round, and refuses a round with no converter present (`reassign_no_converter`).
- The worker moves a lead's callbacks in its definer (new task at the same time, or now when due; old one cancelled; timeline rows) because `moveCallTasks()` works under the assigner's write scope.
- The definers write ids with `app.new_uuid7()`: the contracts accept only version 7 ids, and `gen_random_uuid()` made Account 360 fail (found by the first journey run).
- Existing tests that encoded the old rule were changed on purpose: `lead-guard.test.ts` (the worker with the handover permission now moves the relationship; an agent still does not), `crm-scoring-referrals.test.ts` (the worker holds `crm.handover.run`), `opportunity.test.ts` (nurture allows `assign`).
- Taking the lock: a lead's lock never stops the handover; the Sales Team Lead can still reassign it (tested).

**Checks run, with results** (on a fresh slot database, migrated and seeded, then used by every run below).
- Unit: contracts 181; domain `src` 1965+ (the new `handover.test.ts`: 8 cases, and the machine case); web `src` 703.
- `pnpm test:security` as one run: the db suite ran 38 of its 39 files green and `pin-codes.test.ts` failed (see below), so turbo did not start the domain and web suites. I ran them by themselves on the same database: **domain 67 files, 867 tests passed; web 21 files, 300 tests passed**; db 39 files passed on two earlier runs of this branch. My own tests: `caller-profiles` 14, domain `handover.test.ts` 17, `apps/web/tests/handover.test.ts` 3 (qualified, assigned in under 10 seconds through the outbox nudge, lock about 48 hours, callback and customer moved, notice event; no converter reaches the Sales Team Lead; a repeat changes nothing), `agent-refusals` 49, `lead-guard` 12, plus `grants`, `enum-sync`, `role-entity-matrix`, `role-editor`, `reader-parity`.
- `pin-codes.test.ts` ("clears the flag of every company's sites once the PIN is known", 2 vs 1) fails now and then and passes alone (three alone runs: pass, pass, fail): it draws one of 40 fixed PINs and every run leaves a flagged site behind, so a database used for several runs collides. It is not T2's and not rerun-safe: a follow-up.
- `pnpm db:docs` and `machines:docs`: no diff after commit. `pnpm copy-lint`, `pnpm format:check` clean. `pnpm typecheck` clean. `pnpm build` passed. `pnpm --filter web js-budget`: every page within budget (43 pages). **`pnpm lint` (whole repository, last): clean.**
- Journeys: the full `pnpm --filter web e2e` ran once on the slot database (333 tests); it ran while the PC was short of memory and was cut near its end. Its failures were in `duplicates.spec.ts:104`, `quotes.spec.ts:33`, `agents.spec.ts:41`, `orders.spec.ts:40` and `:111`, `leads.spec.ts:43`, none of them journeys T2 touches. Rerun alone through the lock, with the memory free: `quotes`, `agents`, `leads` and `orders:40` pass; the handover journey's first case failed once on the notification centre still loading (its wait is now 8 seconds an attempt) and passed on the retry; `orders:111` failed on a second run of the same database and passed on the third; `duplicates:104` ("show none" in the snapshot company) failed because the security suites had left 210 customer pairs there, 66 of them from my domain and web handover tests, whose customers shared one name and village. The tests now give each customer its own name and village; I removed the cards the suites left in company 3 and the journey then passed, with `handover.spec.ts` and `orders.spec.ts` (45 passed, none failed). `calling.spec.ts` passes in all three projects. The journeys remain sensitive to a database the security suites have used, as the design notes say (CI uses a fresh one).
- "No converter present" journey: the board shows one company at a time and the journey did not name it; the journey was wrong, not the screen. It now opens `/leads/board?company=2&pipeline=farmer_pumps`, and passes.

**EXPLAIN (ANALYZE), slot database under RLS** (small data, so the timings show only that the plans run):
- `app.caller_profile_people(1)` as a General Manager: function scan, 883 buffers hit, 4.9 ms.
- `app.handover_candidates(1)` as `system:workers`: function scan, 434 buffers hit, 3.3 ms; its per-person count of open leads: `Index Scan using opportunities_open_created_idx` with the owner as a filter, 7 buffers hit, 0.1 ms. The count has no index on `(entity_id, owner_id)` for open leads in particular (`opportunities_entity_owner_idx` serves it when a company holds many leads): a follow-up if one does.

**Follow-ups.**
- `pin-codes.test.ts` is not rerun-safe on a database used for several runs (above).
- Linux screenshot baselines: `/settings/profile` changes for every role that works on leads (the presence section); the converters page has no screenshot (its rows depend on the people other journeys make).
- The handover journey's cap edit leaves the converter's cap at 500 until the seed resets it each run.
- The hosted QStash URL group `evt-crm.opportunity.stage_moved` is made by the publisher on its first event (DEPLOY step 5); nothing to do by hand.
- Documents cite migration 0125; the lead renumbers at the merge.
- A converter's open-lead count counts only `open` leads; nurtured leads do not count against the cap.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
