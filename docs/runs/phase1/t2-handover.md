# T2 Handover (wave 4)

| | |
|---|---|
| Branch | `feat/t2-handover` on GitHub, from `main` at 9fd37458 (#135) |
| PC worktree | `D:/shakti-wt/t2-handover`, slot 19: Postgres 54349 (container `shakti-pg-t2-handover`), app 3049 |
| Runs on | PC only, one agent at a time this week, heavy commands through the PC's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | B (state machines, permissions, workers): build Sonnet medium, review Opus |
| Usage | build (Sonnet, medium, 09-10-2026): 74 % of the week at its start |
| State | building |
| Next step | the builder builds the slice from this brief |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
