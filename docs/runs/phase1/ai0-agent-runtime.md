# AI0 Agent runtime and Inbox (wave 3)

| | |
|---|---|
| Branch | `feat/ai0-agent-runtime` on GitHub, from `main` at #99 |
| PC worktree | `ai0-agent-runtime`, slot 12: Postgres 54342, app 3042 (`bash tools/integration/setup-worktree.sh ai0-agent-runtime feat/ai0-agent-runtime 54342 3042`) |
| Runs on | PC (built and integrated there before the move to cloud-first on 05-10-2026) |
| State | merged (#108) |
| Next step | none: dev and staging migrated through 0108 on the day it merged |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §7.1](../../03-roadmap-appendix/phase1.md#71-ai0-agent-runtime-and-inbox), §4 and §12
- BLUEPRINT §9.3 (agent autopilot) and §7.8 (AI threat model)
- PRD AI-04 (Phase 1 part: the runtime and the Agent Inbox; Triage in shadow is A1's)
- SECURITY §3.2 (`agents.inbox.act`, `agents.autonomy.write`, `agents.killswitch` are in the catalogue already), §3.3 (agent principals) and §6 (AI security)
- ADR 0020 (agents and `system:workers` under the customer rules)
- The masking helpers in `packages/domain/src/privacy`; the event workers and `system:workers` (`apps/web/src/workers/events`); P1's Redis and observability
- Skills: `add-command`, `add-table`, `claude-api` (model ids, the SDK, prompt caching), `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Provider wrapper** in `packages/domain/src/ai`, with no framework imports:
   - every call names its agent and purpose, and the text is masked before it leaves (`packages/domain/src/privacy`);
   - a timeout, bounded retries, a circuit breaker in Redis, and a per-agent daily spend cap in paise, checked before the call and recorded after;
   - Claude through `@anthropic-ai/sdk` (already a dependency of `packages/domain`), Haiku 4.5 (`claude-haiku-4-5-20251001`) by default; Voyage embeddings through `fetch`;
   - a fake transport for tests.
   - No key is set on any environment yet: without `ANTHROPIC_API_KEY` (or `VOYAGE_API_KEY`) the wrapper answers `integration_unavailable` and nothing calls out. Add the variables to `turbo.json`, `.env.example` and DEPLOY as optional; a hosted runtime must not refuse to start without them.
2. **Tables**, each with RLS, forced and failing closed, in its `*_TABLES` list, with fixture rows, matrix rules and `app_reader` grants (AGENTS §6):
   - `agent_configs` (`agent`, `action_type`, `autonomy` suggest / needs approval / automatic, `daily_spend_cap_paise`, `enabled`, `entity_id` null for all): kill switches global, per agent and per company, resolved most specific first;
   - `agent_runs` (one per invocation: agent, purpose, model, tokens, cost in paise, outcome, duration, request id; no prompt or response text holding personal data);
   - `agent_actions`, append-only except its decision columns, which only the inbox command changes;
   - `agent_evals`;
   - `inbox_items` (`kind`, `assignee_id`, `team_id`, `subject_type`, `subject_id`, `state`), holding agent suggestions and routed work.
3. **Commands:**
   - `agents.inbox.approve`, `.edit` and `.reject`, with `agents.inbox.act` and `peopleOnly`. Approving runs the suggested command as the person who approves, through `ctx.run()` and under that person's permissions, never the agent's.
   - `agents.config.set` (`agents.autonomy.write`) and `agents.killswitch.set` (`agents.killswitch`), both `peopleOnly`.
   - Denied, wrong-company and happy-path tests for each; the agent refusal sweep.
4. **The runtime's own path:** a helper an agent worker uses to record a run and either propose an action (an inbox item), or act when its config says automatic and no switch is off. Test it with the fake transport and a stand-in agent defined in the test only. No real agent ships in AI0: Triage is A1's.
5. **Screens:**
   - The Agent Inbox in the top bar (a count) and at `/inbox` (`agents.inbox.act`): approve, edit or reject, keyboard-first.
   - `/admin/agents` (`agents.autonomy.write`, `agents.killswitch`): autonomy per agent and action type, spend caps, kill switches.
   - Both are menu pages with `screenAccess()`, copy in `en.json`, journeys with axe, and the JavaScript budget.
6. **Documents:** DATABASE (the tables), SECURITY §3.3 and §6, ARCHITECTURE (the AI layer as built), API if a route is added, design §7.1 "Built (AI0)", `pnpm db:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a stand-in agent's suggestion goes through the Inbox end to end in a journey (proposed, approved, and the approved command run as the approver), with the kill switch refusing it when off.

Not in AI0: real agents (A1, Phase 2), the vault (K1), voice (Phase 2), any client data or prompt wording the client must give.

## Report
### 05-10-2026, builder on the PC
**Built** (migrations 0092 and 0093 on the branch, after `main`'s 0091):
- Provider wrapper `packages/domain/src/ai`: `provider.ts` (agent and purpose on every call; text masked by `privacy/model-text.ts`, outside data labelled `untrusted_data`; 20 s timeout per attempt, two retries with backoff for a timeout, network failure, 429 or 5xx; circuit breaker in Redis, five failures in a minute pause the vendor a minute; per-agent daily cap in paise checked before and charged after, in the setting's company and the group, by IST day), `models.ts` (Haiku 4.5 `claude-haiku-4-5-20251001` by default, `claude-sonnet-5`, `voyage-3.5`, their prices, `PAISE_PER_USD`), `vendor-transports.ts` (Claude through `@anthropic-ai/sdk`, `maxRetries: 0`, system text marked for the prompt cache; Voyage over `fetch`), `transport.ts` (the fake transport), `env.ts` (`integration_unavailable` without `ANTHROPIC_API_KEY` or `VOYAGE_API_KEY`). `KeyValue.incrBy` in the port, the memory store and the Upstash adapter; the web runtime builds the wrapper on first use (`apps/web/src/integrations/ai.ts`). Both keys optional in `turbo.json`, `.env.example` and DEPLOY step 11.
- Tables `agent_configs`, `agent_runs` (append-only), `agent_actions` (append-only but its decision), `inbox_items`, `agent_evals` (platform table) in `packages/db/src/schema/agents.ts`, with RLS forced and failing closed, `app_reader` on every select policy and grant, the triggers `app.agent_configs_guard()` and `app.agent_actions_append_only()`; in `ENTITY_TABLES` and `PLATFORM_TABLES`, fixture rows per company, matrix rules, `NARROWER`, enum pairs. `AGENT_MATRIX` and `AGENT_PRINCIPAL_IDS` moved to `packages/contracts/src/agent-principals.ts`.
- Contracts `packages/contracts/src/agents.ts`; machines `agent_action` and `inbox_item`; commands `agents.run.record`, `agents.inbox.approve`, `.edit`, `.reject`, `agents.config.set`, `agents.killswitch.set` (`packages/domain/src/commands/agents`); `AGENT_ACTION_TYPES`, `resolveAgentConfig()`, `runAgentStep()`; queries `listInbox`, `countInbox`, `loadAgentSettings`; actions `apps/web/src/actions/agents.ts`.
- Screens `/inbox` (Agent Inbox, `agents.inbox.act:own`; J and K or arrows, A, E, R; edit dialog on first use) and `/admin/agents` (Agents under Admin, `agents.killswitch:all`; autonomy and limits only with `agents.autonomy.write:all`; a notice while no AI key is set); the inbox count in the top bar; copy in `en.json`; named JavaScript budgets.
- Journey `apps/web/e2e/agents.spec.ts` with the stand-in agent `e2e/setup/stand-in-agent.ts` (through the real runtime and the fake transport), seeded by `e2e/setup/seed.ts`.
- Documents: DATABASE §4.4, §5, §6.9; SECURITY §3.3 and §6; ARCHITECTURE §11; design §7.1 Built (AI0); DEPLOY step 11; PRD §8 (AI-04); `pnpm db:docs` and `machines:docs`. No API route.

**Tests added:** domain unit 27 (`provider` 11, `config` 4, `action-types` 5, `vendor-transports` 4, `model-text` 3) and 2 machine fixtures; web unit 6 (`screens/agents.test.ts`) and the `incrBy` case of `key-value.test.ts`; security suite `packages/db/tests/security/agents.test.ts` 12, `packages/domain/tests/commands/agents.test.ts` 19, `agent-runtime.test.ts` 7 (stand-in agent), `queries/agent-inbox.test.ts` 7, the five human controls in the agent refusal sweep, three queries in the reader parity sweep, four tables in the role × company matrix; 7 journeys per project (the kill switch one in desktop-light only).

**Checks** (Postgres 54342):
- `pnpm typecheck`: 8 successful, 8 total.
- Unit tests (`turbo run test --force`): 8 successful; tokens 134, copy-lint 17, ui 105, contracts 177, db 118, domain 1,433, web 583 (2,567).
- `pnpm test:security`: db 927 passed (927); domain 553 passed, 1 failed (554), `customers.test.ts` timing out at 20 s while other agents loaded the machine, then 9 passed alone; turbo then stopped, so the web suite ran alone: 218 passed, 1 failed (219), `auth.test.ts` timing out at 20 s, then 33 passed alone. An earlier full run also failed three of my tests: the journeys' seed rows in `agent_configs` collided with the tests' own inserts; fixed and re-run, 43 passed.
- `pnpm lint`: no problems; `pnpm copy-lint`: clean; `pnpm format:check`: all files use Prettier code style; `check-doc-links.py`: bad 0.
- `pnpm build`, `js-budget`: every page within its budget (29 pages); `/admin/agents` 226.1 kB (238), `/inbox` 193.4 kB (204).
- Journeys `agents.spec.ts` on Windows after `pnpm build` and `e2e:seed`: 25 passed, 2 flaky, 2 skipped; the two tele-caller journeys of desktop-light failed their first try (the inbox answered the `internal` sentence once on the first loads after `next start`; the server's line was not kept) and passed on the retry; run again with `--retries=0`, the tele-caller journeys passed (14 passed). An earlier run had the kill switch journey's company switch wait past 30 s under load, passing on the retry.

**EXPLAIN (ANALYZE) under RLS** (as `app_user` with the request settings; 20,000 runs, actions and inbox items in company 1, a third open, over 50 assignees, written as the owner and removed after):
- `listInbox`, tele-caller at own scope: Index Scan Backward using `inbox_items_assignee_open_idx` (51 rows), primary-key probes on `agent_actions`, `opportunities` and `accounts`; 3.4 ms. The first shape (company index filtering out 2,540 rows, and a CASE join reading every customer under its policy) took 65 ms, so the query now states the caller's inbox scope as the policy does and joins the customer by key.
- `listInbox`, GM at company scope: Index Scan Backward using `inbox_items_entity_open_idx`; 3.3 ms (the join for items about a customer, none filed yet, is a hashed scan of the readable customers, 1.8 ms on 1,256).
- `countInbox`: Index Scan using `inbox_items_assignee_open_idx`, 0.2 ms at own scope; 0.15 ms at company scope (stops at 100 rows).
- `loadAgentSettings`: spend today, Bitmap Index Scan on `agent_runs_entity_created_idx`, 6.6 ms; the decision record reads the company's 20,057 actions, 45.8 ms.

**Not finished or uncertain:**
- Linux baselines (`agent-inbox`, `admin-agents`) are the lead's step; the inbox icon in the top bar changes every staff-page baseline (its count is masked).
- The decision record of `loadAgentSettings` grows with every decision; a summary or partial index can come with A1's volume.
- `PAISE_PER_USD` (8,800) and the `voyage-3.5` price ($0.06 per million tokens) are from my knowledge, not checked with the vendors or the owner's card. The brief's model id is used as given; the vendor also serves `claude-haiku-4-5`.
- A temporary EXPLAIN script went into 3def93a6 by mistake and was removed in d1464e20 (no secrets in it).
- The design names migrations 0092 and 0093 in DATABASE and the design's Built record; they move with the renumbering.

**Decisions the brief did not settle:**
1. No new permission: `agents.run.record` declares, by its input, the permission of the command its action type runs, so an agent records and proposes only what it could do itself; only the agent named in the input may record. Each run is for one action type.
2. An action type is the command it runs; `AGENT_ACTION_TYPES` lists its agents, subject and editable fields. AI0 lists `crm.task.create` for the Caller Co-pilot (due time and note editable) so the stand-in agent has a real command; A1 adds the Triage agent's.
3. A switch off at any matching level stops the agent (a company's switch on does not undo the group's off); autonomy and the cap come from the most specific row; no autonomy set means Suggest, no cap set means no calls.
4. Suggest and Needs approval both file an inbox item with Approve, Edit and Reject (the level is kept on the action for the promotion record); Edit approves with the changes and counts as edited only when something changed; Automatic runs as the agent and files no item (people's notice waits for N1).
5. Approving re-checks the switches (`agent_switched_off`); rejecting is always allowed.
6. Automatic only on one action type, after 200 decided suggestions with 95 in 100 approved unedited in the companies the setting covers (`autonomy_not_earned`); the Executive's change is the sign-off.
7. `/admin/agents` opens with `agents.killswitch:all` so a GM can stop agents; autonomy and limits are read-only without `agents.autonomy.write`. The screen works at the company chosen at the top, or the group from All companies (`agents_need_all_companies` otherwise).
8. The cap is on the agent's row for every action type, in paise, typed in rupees; Redis keeps the day's running spend for the cap, `agent_runs` the durable cost the screen shows.
9. Only agents file inbox items in AI0; `routed_work` is allowed by the check for N1. An item for no one is read at company scope only.
10. `agent_runs` is append-only; `agent_evals` is a platform table written only by the eval runner as the owner.
11. The Activity log records the cap in rupees (`dailySpendCap`) and names agents, action types, autonomy and outcomes from the `agents` catalogue.

### 05-10-2026, builder on the PC (review fixes)
**Built** (every finding of the review below, with the owner's decisions A and B and the lead's C to E; each row of the Review table names its commit):
- Masking `packages/domain/src/privacy/model-text.ts`: digits of any script read as ASCII; a phone number of any shape (4-3-3, 3-3-4, hyphenated, with +91, 91 or 0, a landline with its code) becomes `[phone]`; any other run of nine or more digits, however spaced, dotted or hyphenated, becomes `[number]`; PAN, GSTIN, email and UPI addresses become `[pan]`, `[gstin]`, `[email]`, `[upi]`; a house, flat, plot, ward or similar number after its label becomes `[address]` and a PIN after its label or a place name `[pin]` (best-effort, SECURITY §6); UUIDs are kept; `labelUntrusted()` escapes `&` first.
- Named defaults `packages/domain/src/ai/agent-defaults.ts` (`AGENT_DEFAULTS`): ₹104 a dollar (10,400 paise), the price table checked on 05-10-2026 with only Haiku 4.5 and `voyage-3.5` (`claude-sonnet-5` removed), `automaticAvailable: false`, and the promotion rule (200 decisions, 95% unedited, 90 days, per company, Needs approval only, rejections counted), all flagged for the owner; `models.ts` reads them and adds `maxCostInPaise()`.
- Provider: every cap that applies (`caps`, the company's and the group's) is held; the most a call can cost (UTF-8 bytes as tokens at the dearest input price, plus `maxTokens` of output) is reserved with `incrBy` in both running totals before the call, refused and given back when either total passes its cap, and settled at the cost after (released on failure). `resolveAgentConfig()` returns `caps` and `autonomySource`; `appliedAutonomy()`, `lockAgentSettings()` (shared advisory locks for every agent and the agent) and `lockAgentSettingsForChange()` (exclusive) in `ai/config.ts`.
- Runtime: `AgentStep.eventId`; `agentStepKey()` (SHA-256 of event, agent and action type) is passed to `agents.run.record` as its idempotency key and read from `idempotency_keys` before any model call; a concurrent redelivery that meets `idempotency_mismatch` answers the recorded run.
- Commands: `agents.run.record` takes the settings lock, files a stored Automatic as Needs approval, fills a task's `assigneeId` from the proposal's assignee or refuses it, and refuses an agent or the workers as assignee and a subject the agent does not read in the company (`agent_proposal_invalid`); `agents.inbox.dismiss` is new (the `dismissed` state in the machine, the checks and the update policy of 0092 and 0093); approve, edit and reject refuse a Suggest item (`agent_suggestion_only`), dismiss refuses a Needs approval one (`agent_needs_decision`); approve takes the settings lock; an edit needs a time with its offset, may change nothing, and counts as edited only when a field changed (`wasEdited()`, instants for times); `agents.config.set` is patch-style, takes the change lock and refuses Automatic (`autonomy_automatic_unavailable`); the record behind Automatic follows the rule, on a new partial index `agent_actions_record_idx` (company, agent, action type, decided time; Needs approval decisions only), changed in place in 0092.
- Queries: `listInbox` joins the lead in the item's company and returns `summary` (who the task is for, with the name, and its kind) and the fields on every card; `loadAgentSettings` returns the `effective` and `inherited` autonomy with their sources, `groupCapPaise` and `automaticAvailable`, and counts decisions as the rule does.
- Web: one `InboxCard` per suggestion with its own commands and keys; a Suggest card shows a sentence, Open customer (O) and Dismiss (D), and no Approve; the edit dialog sends only changed fields; the agents screen names what applies and where it comes from, the empty choice names what it inherits, it shows the group's limit, sends only the field it changes and shows Automatic unavailable; the top bar's count is kept 10 seconds per person and company scope and dropped on the person's own decision (`apps/web/src/actions/inbox-count-cache.ts`); copy in `en.json` (`errors.agent_suggestion_only`, `agent_needs_decision`, `autonomy_automatic_unavailable`, `nothing_to_change`, the inbox's and the agents screen's new lines), `dismiss` in the copy-lint button keys, `inboxDismiss` in the Activity log.
- Journeys: the seed sets the Co-pilot to Needs approval in companies 1 to 3, files one Suggest item per project for the tele-caller and files the kill switch item for the Executive; a new journey dismisses the Suggest item with D after A does nothing; the approve journey checks the read-only summary.
- Documents: SECURITY §3.3, §5 and §6 (placeholders, the caps and the reservation, the lock, the step key, Suggest and dismiss, Automatic refused, the address limitation), DATABASE §4.4 and §5, ARCHITECTURE §11, ADR 0011 (no fall back to Suggest; INCIDENTS §8), INCIDENTS §8 (the AI service is down or an agent has stopped), design §7.1 Built (AI0) with the decisions of 05-10-2026; `pnpm db:docs` and `machines:docs`.

**Tests added or changed:** domain unit 1,433 to 1,481 (`model-text` 3 to 29: every Aadhaar, bank, phone, PAN, GSTIN and address shape, ordinary text, the `&` escape; `action-types` +6: offsets, unedited edits, the assignee, the summary, the rule; `config` +2: both caps, the sources; `provider` +3: both caps, two calls at once, release on failure); web unit 583 to 585 (the count cache; keys O and D and the summary names in an existing test); security: domain `agents.test.ts` 19 to 28 (the assignee filled and an agent refused, a lead of another company, a stored Automatic filed as Needs approval, two decisions in two transactions, an approval waiting for a switch turned off in an open transaction and then refused, an unedited edit by instant and by no change, the offset, Suggest dismissed and refused one-tap, dismiss refused on Needs approval, dismiss denied for a role, an agent, another caller and another company, the patch-style setting, Automatic refused whatever the record, on keys nobody else writes); `agent-runtime.test.ts` 7 to 9 (a redelivered event answered with no second model call, refused proposals kept as failed runs, Automatic in Phase 1); `agent-inbox.test.ts` 7 to 8 (summary, fields, sources, the group's cap, its own Co-pilot rows over the seed's); db `agents.test.ts` the dismissed decision; the refusal sweep covers `agents.inbox.dismiss`; journeys 9 per project (the new Suggest journey), the kill switch one in desktop-light only. The lock test fails with the lock taken out (checked once by hand).

**Checks** (Postgres 54342, reset with `fresh-db.sh` before each suite run):
- Touched files alone: db `agents.test.ts` 12 passed; domain `agents`, `agent-runtime`, `agent-inbox`, the refusal sweep and reader parity 93 passed; the three agent files again after the journeys' seed, 45 passed.
- `pnpm typecheck`: 8 successful, 8 total.
- Unit tests (`turbo run test --force`): 8 successful; tokens 134, copy-lint 17, ui 105, contracts 177, db 118, domain 1,481, web 585 (2,617).
- `pnpm test:security`, final run: db 927 passed (927); domain 564 passed, 2 failed (566), `timeline.test.ts` timing out at 20 s under load, then 4 passed alone; turbo then stopped, so the web suite ran alone: 219 passed (219). Earlier runs found my `agent_actions_decided_check` written with a value list, which the enum pairing counts (fixed in e392d22d and 67c4bd32); after that failure vitest ran `enum-sync.test.ts` first, where "a site point is on the globe" needs an account another file makes (a pre-existing order dependence); it passed alone on a used database, and the next full run ordered the files as before.
- `pnpm lint`: no problems; `pnpm copy-lint`: clean; `pnpm format:check`: all files use Prettier code style; `check-doc-links.py`: bad 0; `pnpm db:docs` and `machines:docs`: nothing left to change.
- `pnpm build`, `js-budget`: every page within its budget (29 pages); `/admin/agents` 226.2 kB (238), `/inbox` 193.9 kB (204).
- Journeys `agents.spec.ts` after `pnpm build` and `e2e:seed`: 30 passed, 2 skipped. The first run (a forwarded argument that ran every spec) failed the new Suggest journey, which found no card by its note because a Suggest card showed no fields (fixed in 0ec53f4c); a second run had the edit journey's dialog close only after 15 s under load and its retry find the suggestion already approved; the third run passed. The other specs' desktop-dark failures in the first run (customers, imports, integrations, leads) were page loads under load, outside this slice.

**EXPLAIN (ANALYZE) under RLS** (as `app_user` with the request settings; 20,000 actions and inbox items in company 1, a third open, over 50 assignees, written as the owner and removed after):
- `listInbox`, tele-caller at own scope: Index Scan Backward using `inbox_items_assignee_open_idx` (51 rows), primary-key probes on `agent_actions`, `opportunities` (with its company) and `accounts`; 3.7 ms. GM at company scope: Index Scan Backward using `inbox_items_entity_open_idx`; 1.3 ms. The names of a page's assignees: Bitmap Index Scan on `principals_pkey`, 0.05 ms.
- `loadAgentSettings`, the decisions the rule counts: Bitmap Index Scan on the new partial `agent_actions_record_idx`, 4,467 rows, 3.9 ms (14.4 ms on `agent_actions_run_idx` before the index); the Phase 6 record of `agents.config.set` 3.3 ms on the same index.
- The subject read as the agent: Index Scan using `opportunities_id_entity_account_unique`, 0.05 ms; the recorded run of a step: Index Scan using `idempotency_keys_pkey`, 0.03 ms.
- `inboxCount()` per call through `executeQuery` (finding 17): median 6.3 ms, p95 10.4 ms for a tele-caller; median 5.5 ms, p95 10.1 ms for a GM (the query itself 0.2 ms; the rest is the request's transaction), so it is kept 10 seconds.

**Not finished or uncertain:**
- Linux baselines (`agent-inbox`, `admin-agents` and the staff pages with the inbox count) are the lead's step; the inbox cards now show the summary and the fields.
- The owner's decisions A and B are recorded here and in design §7.1; 11-decisions.md is the lead's.
- ₹104 and the two prices are flagged for the owner; `apps/web/src/integrations/voice/claude-stream.ts` (the voice spike, outside this slice) still names `claude-sonnet-5`.
- `enum-sync.test.ts` "a site point is on the globe" passes only after another file has made an account (pre-existing).
- The inbox count may lag up to 10 seconds for a suggestion filed or decided by someone else, and is kept per server instance.

**Decisions the brief and the review did not settle:**
1. Dismiss is its own command, `agents.inbox.dismiss`, with the state `dismissed`; a Suggest item is not rejected and a Needs approval item is not dismissed.
2. A stored Automatic (only the owner could write one) files a Needs approval item in Phase 1; the act path stays behind `AUTOMATIC_AVAILABLE` for Phase 6, when Automatic is set only on one action type in one company.
3. A reservation is refused when it would take a running total past a cap, so a call is refused when the headroom left is smaller than its most possible cost.
4. A step's key is the SHA-256 of its event, agent and action type (64 characters, the key column's limit); the check before the model call reads `idempotency_keys` on the `app_user` pool, the reader pool having no grant there.
5. The settings lock is a pair of transaction advisory locks, `agent-config:*` and `agent-config:<agent>`: shared for a run's record and an approval, exclusive for a setting or a switch.
6. A task's assignee and its inbox item's must agree; the item goes to the task's person when the agent names only the task's.
7. At the group level the agents screen sums the companies' decisions; the rule itself is per company.
8. The inbox count is kept in the server's memory for 10 seconds per person and company scope, and the person's own counts are dropped on each decision.
9. `agent_actions_decided_check` names the decided states as not-equal tests, so the enum pairing does not count it as a value list.

### 05-10-2026, builder on the PC (second review fixes)
**Built** (every finding of the second review; each row of its table names its commit):
- Masking `packages/domain/src/privacy/model-text.ts`, rewritten by method (317c1205): the text is read normalised (every `\p{Nd}` digit as ASCII by its distance from its script's zero; every `\p{Zs}`, `\p{Cf}`, tab, line break, U+2010 to U+2015 and U+2212 as a space, runs of spaces as one; full-width letters and signs as ASCII), with a map from each normalised position back to the original, so each placeholder replaces the original characters; then UUIDs are kept, email, UPI (`(?![\w@-]|\.[a-z])`, hyphenated handles), GSTIN and PAN (spaces or hyphens between groups) masked; then dates, times, timestamps with offset, ranges, rupee amounts, quantities with units and product codes are kept when nothing joins them to another digit; then every run of digit groups joined by at most three of space . , / _ - : and brackets, digits touching letters included, with nine or more digits becomes `[phone]` or `[number]`; then `[address]` after the house labels only and `[pin]` after a PIN label or a capitalised place name only. Texts are cut at `MODEL_TEXT_LIMIT` (20,000 characters) with ` [truncated]`, never through a number. Output keeps the original text outside the placeholders, digits written in ASCII as before. SECURITY §5 and §6 state what is caught, what is kept and what is not caught.
- `packages/domain/src/ports/redaction.ts`: the logs' email rule starts only where a word starts (same matches; a long word was read once per letter, which made `maskForModel()` quadratic on long words) (7a37e138).
- `appliedAutonomy()` reports a stored Automatic as Needs approval with `automaticHeld` while `AUTOMATIC_AVAILABLE` is false; `AppliedAutonomyDto.automaticHeld`; `agents.run.record` takes the resolved autonomy; the agents screen adds the sentence `agents.admin.automaticHeld` and shows a stored Automatic in the agent-level select as a disabled choice (204f568b).
- `agents.run.record`: the assignee must be a `principals.kind = 'user'`, not archived, with a `user_entity_roles` row in the company, and the item's `team_id` comes from that row; `teamId` is gone from `AgentProposalSchema` (204f568b).
- `runAgentStep`: only `validation_failed`, `forbidden` and `not_found` end as a failed run; anything else is rethrown so the delivery is retried (204f568b).
- Checks `agent_actions_dismissed_check` and `agent_actions_decided_autonomy_check` in the schema and in 0092 and its snapshots, in place (204f568b); `pnpm db:docs` (314a4bfa).
- Integration note 2 for the owner (₹104 and the dated price table).

**Tests added or changed:** domain unit 1,481 to 1,566: `model-text` 29 to 105 (every shape the review named, other scripts, the masking of PAN, GSTIN, UPI and email, the address labels, 36 texts left alone, three seeded property tests of 1,000 Aadhaar numbers, mobiles and 9 to 18 digit accounts each in random groups, separators, scripts and words, 500 mobiles after +91, 91 or 0, 1,000 rounds of dates, times and amounts left alone, five 50,000-character texts each masked in under 500 ms, the cut); `runtime.test.ts` 6 new (three refusals kept as failed runs, a conflict, an internal error and a lost connection rethrown); `config` +1 (stored Automatic held); `provider` +2 (a store that fails every call, or only the reservation: refused, nothing sent). Security: db `agents.test.ts` 12 to 13 (the two checks, even as the owner; the decision test on a Needs approval action); domain `agents.test.ts` 28 to 29 (the team from the role row, `teamId` refused, a person with no role, a role in another company, an archived person and an unknown id refused; the kill-switch race waits on `pg_locks` for the blocked advisory lock instead of 300 ms); `agent-runtime.test.ts` (the owner is a user with a role; someone with no role in the company refused); `agent-inbox.test.ts` 8 to 9 (stored Automatic reported as Needs approval with its note; the callers are users with roles). Journey: the Suggest journey records every server action sent after the card is focused and expects exactly one (the dismissal), so A sends nothing.

**Checks** (Postgres 54342, `fresh-db.sh` before the suite runs; the database URL check printed nothing):
- Touched files alone: db `agents.test.ts` and `enum-sync.test.ts` 16 passed, 1 failed (17), the failure "a site point is on the globe", which needs an account another file makes (pre-existing); domain `agents`, `agent-runtime`, `agent-inbox`, the refusal sweep and reader parity: 95 passed (95).
- `pnpm typecheck`: 8 successful, 8 total.
- Unit tests (`turbo run test --force`): 8 successful; tokens 134, copy-lint 17, ui 105, contracts 177, db 118, domain 1,566, web 585 (2,702). The first run failed `data-docs.test.ts` until `pnpm db:docs` ran.
- `pnpm test:security` on a fresh database: db 927 passed, 1 failed (928), the same "a site point is on the globe" (vitest ran `enum-sync.test.ts` early after its failure in the touched-file run); turbo then stopped, so the domain and web suites ran on their own: domain 566 passed, 2 failed (568), `audit-trail.test.ts` and `price-lists.test.ts` timing out at 20 s under load, then 21 passed alone; web 212 passed, 7 failed (219), `auth-actions.test.ts` timing out at 20 s, then 13 passed alone.
- `pnpm lint`: the first full run found one unnecessary assertion in `provider.test.ts` (fixed in 4eed143b); a second timed out at 20 minutes under load; the third ran 13.5 minutes with no problems. `pnpm copy-lint`: catalogues and templates are clean; `pnpm format:check`: all files use Prettier code style; `machines:docs`: nothing changed; `check-doc-links.py`: bad 0.
- `pnpm build`: 2 successful; `js-budget`: every page within its budget (29 pages); `/admin/agents` 226.3 kB (238), `/inbox` 193.9 kB (204).
- Journeys `agents.spec.ts` after `e2e:seed`: all projects, 29 passed, 1 failed, 2 skipped: the kill switch journey passed its refusal and its approval but ran past the 60 s test limit under load, and its retry found the suggestion the first attempt had approved. Desktop-light again with two workers and no retries: 14 passed, 2 failed (the edit took 44 s on the server and the dialog's 15 s wait ran out; a page reload was aborted). Desktop-light with one worker and no retries: 16 passed (16), the edit 0.3 s and the approval 1.0 s on the server.

**EXPLAIN (ANALYZE):** no list or search changed. The assignee check of `agents.run.record` is a key lookup: Index Scan using `user_entity_roles_user_entity_key` and Index Scan using `principals_pkey`, 1.0 ms (as the owner, 239 role rows).

**Not finished or uncertain:**
- `fast-check` is a dependency of `@shakti/contracts` only, and adding it to `@shakti/domain` would change `pnpm-lock.yaml`, so the property tests use a seeded generator (mulberry32) in the test file; swapping to `fast-check` needs the lead to add it.
- The 44 s edit in the two-worker journey run is unexplained: one worker ran it in 0.3 s, and the machine was loaded by other agents; the earlier report saw the same journey slow under load.
- The optional check constraint against a stored Automatic was not added: the tests of a stored Automatic (filed as Needs approval, reported with its note) need to write one, and `agents.config.set` already refuses it.
- "a site point is on the globe" in `enum-sync.test.ts` still depends on another file's account (pre-existing, outside this slice).
- The second review's findings 1 to 3 are summarised in its table from the lead's brief.

**Decisions the brief did not settle:**
1. `:` and brackets join digit groups as well as space . , / _ -; a run of spaces reads as one, so "four or more spaces" still joins.
2. Format characters (`\p{Cf}`, such as a zero-width space) read as a space; full-width letters and signs read as ASCII (a full-width PAN is masked).
3. A kept shape keeps its digits only when nothing joins it to another digit; a list of dates or of small numbers with nine digits in all is masked.
4. Rupee amounts are kept up to eleven digits with lakh commas, nine with western commas or none; a code is kept only with six digits or fewer besides its year; a quantity keeps at most six digits before its decimals.
5. Plot, Flat, Khasra, Ward and Gali count as labels with or without "No" (the existing `Ward 5` and `Flat 3B` cases); House, H, Door, Shop and Quarter need "No". `#14` is no longer an address (`order #1234` stays).
6. The text outside the placeholders is the original, with its digits written in ASCII as before (`५ HP` becomes `5 HP`).
7. The email rule of the logs' redaction (`ports/redaction.ts`, on `main` since P1) gained the same word-start lookbehind, because `maskForModel()` runs it last and it was the quadratic part.
8. `teamId` is removed from the proposal rather than ignored, so an agent naming a team is refused.

## Review
### 05-10-2026, lead session on the PC
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | HIGH | `maskForModel()` misses Aadhaar written with runs of spaces, dots or hyphens or in Devanagari digits, unlabelled 9 to 18 digit runs (bank accounts), phones in 4-3-3, 3-3-4, hyphenated and landline (0141-2345678) shapes, PAN and addresses; SECURITY §5 and §6 disagree on placeholders against last four. | fixed in 5a30d342, 01ea9c3c; SECURITY §5 and §6 in e56d8038 |
| 2 | MEDIUM | An edit with no change counts as edited: the due time is compared as strings, not instants, and the form sends every field. | fixed in 5a30d342, 01ea9c3c; the form in 265e0c74 |
| 3 | MEDIUM | The inbox card does not show every input that changes the outcome (who the task is for, its kind). | fixed in 5a30d342, 01ea9c3c; the card in 265e0c74 and 0ec53f4c |
| 4 | MEDIUM | `crm.task.create` proposals can leave `assigneeId` unset or name an agent principal. | fixed in 5a30d342, 01ea9c3c |
| 5 | MEDIUM | The settings screen does not show the effective autonomy and cap or where each comes from; the empty choice does not name the inherited value. | fixed in 5a30d342, 01ea9c3c; the screen in 265e0c74 |
| 6 | MEDIUM | `runAgentStep` and `agents.run.record` have no idempotency: a redelivered event calls the model and files the suggestion again. | fixed in 5a30d342, 01ea9c3c |
| 7 | MEDIUM | `agents.config.set` overwrites every field: two Executives' edits lose one another. | fixed in 5a30d342, 01ea9c3c; the screen sends one field in 265e0c74 |
| 8 | LOW | The spend cap is checked before the call and charged after, so concurrent calls can pass it together. | fixed in 5a30d342, 01ea9c3c |
| 9 | LOW | Approve and record read the config rows without a lock, racing the kill switch. | fixed in 5a30d342, 01ea9c3c |
| 10 | LOW | An edit accepts a time without an offset. | fixed in 5a30d342, 01ea9c3c |
| 11 | LOW | The subject is not checked as readable in the company under the agent's RLS; the inbox join lacks `o.entity_id = i.entity_id`. | fixed in 5a30d342, 01ea9c3c |
| 12 | LOW | ADR 0011 says Suggest is the fallback and names an outage runbook that does not exist; SECURITY §6 claims token budgets per run. | fixed in e56d8038 |
| 13 | LOW | The Automatic test depends on leftover rows. | fixed in 5a30d342, 01ea9c3c; the inbox query test in 10ff12f8 |
| 14 | LOW | No two-transaction test of two decisions on one suggestion. | fixed in 5a30d342, 01ea9c3c |
| 15 | LOW | `model-text` does not escape `&` first. | fixed in 5a30d342, 01ea9c3c |
| 16 | LOW | The inbox card reuses one idempotency key across its actions. | fixed in 265e0c74 |
| 17 | LOW | `inboxCount()` runs on every render without a measure of its cost. | measured and cached in 2c68a233 |

Owner decisions (05-10-2026):
- A. Automatic is not available in Phase 1: the level stays in the data model, `agents.config.set` refuses it with a plain reason until Phase 6, and the screen shows it disabled with a plain sentence. The promotion rule (95% approved unedited over 200 cases, Executive sign-off; rolling 90 days, per company, rejections count, only Needs-approval decisions count) is a named default flagged for later. Applied in 5a30d342, 01ea9c3c and 265e0c74; design §7.1 in e56d8038.
- B. The rupee cost per US dollar for spend caps is a named default of ₹104 (₹88 plus 18% GST on imported services), flagged for the owner to confirm from the card statement. The model price table is named and dated, flagged for the owner to check, and holds only the models the design names (Haiku 4.5 and Voyage). Applied in 5a30d342 (`AGENT_DEFAULTS`); design §7.1 in e56d8038.

Lead decisions (05-10-2026):
- C. Suggest follows BLUEPRINT §9.3: the item appears in the Agent Inbox for a person to act on themselves (Open, Dismiss), with no one-tap run; Needs approval gets Approve, Edit and Reject. Applied in 5a30d342, 01ea9c3c (`agents.inbox.dismiss`) and 265e0c74.
- D. When a company cap and a group cap both exist, both apply: the call is refused if either would be exceeded. Applied in 5a30d342, 01ea9c3c.
- E. Address masking is best-effort (a PIN and house-number heuristic), recorded in SECURITY §6 as a known limitation; digits are masked fully. Applied in 5a30d342, 01ea9c3c; SECURITY §6 in e56d8038.

### Second review (05-10-2026)
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | HIGH | `maskForModel()` still misses numbers joined by other Unicode spaces (U+00A0, U+2009, U+202F), line breaks, four or more spaces, `/`, `,`, `_` or U+2212, and digits touching letters (`UID234567890123`, `Mob9876543210`, `98765 43210ji`); patterns are added one spelling at a time. | fixed in 317c1205 (by method: normalised reading mapped back to the original, safe shapes set aside, every run of nine digits); long words linear in 7a37e138 |
| 2 | MEDIUM | The masking over-masks ordinary text: dates with times, timestamps, ranges, amounts (`quoted 245000`, `amount 1250000.50`), `block 2`, `sector 7`, `order #1234`, `SP-7.5-100-2026` and six digits after any word. | fixed in 317c1205 |
| 3 | MEDIUM | UPI misses a sentence-ending dot and hyphenated handles; PAN and GSTIN with spaces or hyphens are missed; the email rule can run quadratically; SECURITY §5 and §6 do not say what is and is not caught. | fixed in 317c1205 (SECURITY §5 and §6 state both); the logs' email rule in 7a37e138 |
| 4 | LOW | With Automatic unavailable, the settings screen and `appliedAutonomy()` report a stored Automatic as Automatic; the agent-level select cannot show it. | fixed in 204f568b (`automaticHeld` and its note; the stored value shown, disabled) |
| 5 | LOW | The assignee is not checked as a person with a role in the company, and the item's team is the agent's word. | fixed in 204f568b (`teamId` removed from the proposal; taken from `user_entity_roles`) |
| 6 | LOW | `runAgentStep` turns every failure of the record into a failed run, so a database failure is never retried. | fixed in 204f568b (only `validation_failed`, `forbidden`, `not_found`) |
| 7 | LOW | The UPI lookahead and the email lookbehind. | fixed with 1 in 317c1205 and 7a37e138 |
| 8 | LOW | ₹104 a dollar and the price table are unconfirmed. | integration note 2 |
| 9 | LOW | The kill-switch race test sleeps; the Suggest journey does not show that A sends nothing; no test of a store that fails. | fixed in 204f568b (`pg_locks` wait, a failing `KeyValue`) and 7a37e138 (the journey counts server actions) |
| 10 | LOW | No check ties a decision to the autonomy: a Needs approval action could be dismissed, a Suggest one approved. | fixed in 204f568b (`agent_actions_dismissed_check`, `agent_actions_decided_autonomy_check`, in 0092 in place); `db:docs` in 314a4bfa |

## Integration notes
1. Hosted keys wait on the owner (STATUS, Waiting on the owner): until `ANTHROPIC_API_KEY` is set, hosted agents answer unavailable.
2. For the owner, before agents spend money: confirm the rupee cost of a dollar (₹104, `AGENT_DEFAULTS.paisePerUsd`) from the card statement's charge for the Anthropic and Voyage invoices, and check the dated price table in `packages/domain/src/ai/agent-defaults.ts` against the vendors' price pages.
3. `main` taken after P2b (a04bd2b): 16 conflicts resolved (lists by union, the message catalogue and copy-lint config by their scripts, documents by hand); the matrix fixture's agent config and inbox rows moved to `per(e, 0x1c)` and `0x1d`; the migrations moved to 0107 and 0108; DATABASE and the design cite them.
4. The integration run (05-10-2026, fresh Postgres on 54340, two builders running beside it): install, lint, format, copy lint, the generated files, typecheck, `db:verify`, the audit, the build, the JavaScript budget and the secret scan passed; the unit, security and journey steps failed only on time limits under load, each file passing alone (unit: masking speed 84 ms of its 500 ms alone; security: `lead-guard`, `customer-read-through-leads` 22 alone, the web imports file 32 alone; journeys: the phone Agent Inbox journeys 15 of 15 alone).
   - One real gap, fixed in 635006bd: `main`'s people-only refusal list (`agent-refusals.test.ts`) had no inputs for the six Inbox and settings commands, so they were refused by validation rather than by the guard; with the inputs every agent and worker principal is refused by the guard (49 passed).
   - The domain security suite on a fresh database after the fix: 679 passed.
5. Linux baselines on a fresh database (99d925de), each looked at: `agent-inbox` and `admin-agents` new in every project; `home-tele-caller` (three projects), `team-members` and `imports-list` (light, dark) remade for the Agent Inbox and Agents menu items (main's `imports-list` also predated C2's menu and P2b's wording). The run after it without updating: 231 passed, 1 flaky, 3 failed on time limits (two Agent Inbox journeys on desktop light, C4's sizing and C2's consent journeys on dark); every screenshot matched; `agents.spec.ts` alone in the Linux image then passed 30 of 30.
