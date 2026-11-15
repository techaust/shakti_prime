# B1 Ask the Business (wave 2)

| | |
|---|---|
| Branch | `feat/b1-ask` on GitHub, from `main` at 27662a00 |
| Worktree | `b1-ask`, slot 5 (Postgres 54335, app 3035), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 14-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high; 5-hour window 0 % at 07:00 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §6.5](../../03-roadmap-appendix/phase2.md#65-b1-ask-the-business), §2 (question 1: Sonnet 5.5; question 9 (a): `knowledge.ask` for the Executive, GM, Sales Team Lead, Accounts, Inventory Manager and Project Manager), §4 (the `knowledge.ask` row: its scope only opens the screen), §9.1, §11 (`retention.askDays` 90, the Ask caps), §14 and "Built (K2)" (**`approvedPlaybook()` is the only read of the Playbook**, never `playbook_directives` directly).
- BLUEPRINT §9.2 and §9.3; PRD AI-02; SECURITY §3.2, §3.4 and §7; the cost isolation rule in `CLAUDE.md` (`procurement.rate.read`, `finance.cost.read`); API §2 and §3.6.
- What exists: the provider wrapper with spend names, caps and `effort` (`packages/domain/src/ai/provider.ts`, `agent-defaults.ts`, the fake transport `AI_TRANSPORT=fake`), `executeQuery()` and the reader pool, `searchKnowledge()`, `approvedPlaybook()`, the pipeline, lead, quote, order, target and dealer-credit queries in `packages/domain/src/queries`, the masking finder.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **Tables** `ask_conversations` and `ask_messages` (the person's own, read only by them; question and answer masked by the finder; cited ids; removed after `WORKSHOP_DEFAULTS.retention.askDays`), with RLS, the testing lists, fixture rows, the role × company matrix (AGENTS §6), and the retention sweep.
2. **Permission** `knowledge.ask` (scopes of §4) with its SECURITY §3.2 row, seed and oracle case; no agent holds it.
3. **The service** `askTheBusiness()` in `packages/domain/src/ai/ask`: Sonnet 5.5 through the provider wrapper (`knowledge:ask` spend name; `AGENT_DEFAULTS.ask.personDailyCapPaise` ₹50 a person and ₹1,000 for the group), with read-only tools each wrapping an existing query run through `executeQuery()` as the asking person on the reader pool: the vault search, `approvedPlaybook()` for the audiences the person may read, the pipeline by stage, leads, quotes and orders in summary, targets and progress, dealer credit only with `sales.credit.write`; each returns ids for citation. Tool results go to the model as data. No tool writes; cost and supplier-rate figures come back only where the person's own grants and RLS give them.
4. **The grounding filter** (deterministic, pure, unit-tested): every citation must be an id a tool returned in this conversation, and every number, amount and date in the answer must appear in a tool result; an answer that fails says what it could not source instead of the figure.
5. **Commands** for the conversation (ask, which records the question and the filtered answer; delete a conversation), audited without the text; denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.

**Early check (Tier A):** once steps 1 to 5 are committed with their tests, write a short report here, commit it with the subject `report: b1-ask early check`, push and stop. The lead reads that diff and starts you again for steps 6 to 9.

6. **Contract** `POST /api/v1/ask` (session, or V2's voice token later; build the session path and leave the token's check as a typed seam V2 fills) streams the answer; validation, rate limit, the caps answered plainly.
7. **Screen** `/ask` (menu Ask the Business, `knowledge.ask`): the conversation, each answer with its sources as links, figures as cards, the day's limit stated when reached. Copy in `en.json`; journeys with axe on the fake transport, light, dark and 400 px snapshots; the JavaScript budget.
8. **Tests** of §14: the grounding filter; citations only of returned ids; **the security suite asks the same questions as a General Manager and an Executive and proves no cost, margin or supplier rate reaches the GM's answer, tool results or stored messages**; an eval set of business questions on seeded data, run on recorded answers in CI (the live model by hand only, never in CI); prompt injection in vault text and customer names treated as data; `EXPLAIN (ANALYZE)` for every list.
9. **Documents:** DATABASE, SECURITY §3.2, §3.4 and §7, API §6, the design's "Built (B1)" under §6.5, `pnpm db:docs`.

Files owned: `packages/domain/src/ai/ask`, the Ask tables, commands, route and `/ask`. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, the event catalogue, `turbo.json` and `.env.example`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`. W1, I1, T3 and K3 build beside you: never touch the webhook handlers, `apps/web/src/screens/messaging`, `provider_calls`, `crm.lead.*` or the knowledge index job. You read existing queries; if one needs a change for Ask, add a narrow one of your own rather than change another module's.

Review checklist (check before your report): every tool runs as the asking person on the reader pool, never as a platform principal; no cost, margin or supplier rate in any GM path (answer, tool result, stored message, log, Sentry); the Playbook read only through `approvedPlaybook()`; stored text masked; the caps checked before the model call; a failed grounding never shows an unsourced figure.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §6.5 pass; `pnpm test:security` passes on your Postgres.

Not in B1: V2's voice token and Ask mode (V2 uses your route); any AI agent principal using Ask.

## Report

### Early check, 14-11-2026 (the lead's cloud VM, worktree `b1-ask`, Postgres 54335)
Steps 1 to 5 of the brief, committed and pushed on `feat/b1-ask` (last commit `test(ask): job counts follow the job list; lint`). Skills loaded: `add-table`, `add-command`, `claude-api` (tool use with Sonnet 5.5).

**Built:**
- Tables `ask_conversations` and `ask_messages` (`packages/db/src/schema/ask.ts`; migrations `0168_ask`, `0169_ask_rls`, `0170_ask_companies_check`): a conversation covers the companies in `entity_ids` (`entity_id` the one company, null when several); read only by its person (`user_id`) in a request covering all its companies (`app_user`, `app_reader`); written with `knowledge.ask:team` as oneself; a message names its conversation with the same person and companies (composite foreign key, cascade), is written once; a conversation changes only `updated_at` and is deleted by its person; no grant to reporting. Retention: `app.purge_ask_conversations(days)` (definer, no request role may run it) on the pg_cron job `ask-conversations-purge` daily at 02:50 UTC with lock and statement limits, registered in `DATABASE_JOBS`, `JOB_RUN_LIMIT_MINUTES`, the job label in `en.json` and the job lists of the suites. Testing lists (`ENTITY_TABLES`), matrix fixture rows and rules (own, another person's, one over every company), `NARROWER`, `enum-sync`, DATABASE §4.4, §6.9, §7 and the definer exceptions, `pnpm db:docs`.
- Permission `knowledge.ask` (Executive all, GM all, Sales Lead team, Inventory, Project Manager and Accounts entity): catalogue, scopes, `AGENT_FORBIDDEN_PERMISSIONS`, seed description, `STAFF_MATRIX` (the oracle), SECURITY §3.2 row, the role editor's label.
- The provider wrapper takes read-only tools and rounds of lookups (`transport.ts`, `vendor-transports.ts`, `provider.ts`): strict tools with `tool_choice: auto`, the model's turn sent back unchanged (thinking blocks included), each lookup's answer masked and labelled as untrusted data, the reservation bound including tools and rounds. Additive: no existing caller changes.
- `AGENT_DEFAULTS.ask` (spend name `knowledge:ask`, Sonnet 5.5 at medium effort, ₹1,000 a day for the group, ₹50 a person, at most 5 model calls a question, 25 records a lookup, 8 vault passages, 200 directives, 4 earlier turns, prompt `ask-1`); `WORKSHOP_DEFAULTS.retention.askDays` 90.
- `packages/domain/src/ai/ask`: `tools.ts` (nine lookups, each through `executeQuery()` as the person for the conversation's companies, on the reader pool where set: vault search, `approvedPlaybook()` for the audiences held, pipeline by stage, leads, quotes, orders, this month's sales, targets and progress, dealer credit only with `sales.credit.write`), `grounding.ts` (the pure filter), `prompt.ts`, `ask.ts` (`askTheBusiness()`); `queries/knowledge/ask.ts` (`loadAskConversation`).
- Commands `knowledge.ask.record` and `knowledge.ask.delete` (`commands/knowledge/ask.ts`), people only, `knowledge.ask:team`; record masks question and answer with the finder, checks every cited record against what the conversation's lookups returned (`ask_citation_unreturned`), audits `askAnswered`, `citedSources`, `unsourcedFigures` with an `auditInput` that leaves out both texts; delete audits `askMessages`. Registry, Activity log labels, five `errors.*` sentences (`ask_conversation_missing`, `ask_citation_unreturned`, `ask_unavailable`, `ask_person_cap_reached`, `ask_cap_reached`).

**Tests added:** `packages/db/tests/security/ask.test.ts` (6: own rows only, several companies only in a request covering them, insert only with the grant as oneself, the companies columns in step, column grants and cascade, the sweep and its job); the role × company matrix over both tables; `grounding.test.ts` (9); `provider.test.ts` (+1) and `vendor-transports.test.ts` (+1) for tool rounds; `packages/domain/tests/commands/ask.test.ts` (15: denied, agent, wrong company and another person for both commands, masking, audit without text, follow-up citations, caps before any model call or lookup, no key, the grounded answer with an injected instruction kept as data, no answer after the call limit, lookups not offered answered as errors, tools per grant, closed schemas, the sweep's days equal to `askDays`); the agent refusal sweep and reader parity over the new commands and query; enum pair, `NARROWER`, job lists.

**Checks:**
- `pnpm test:security` (through the lock): db 49 files, 1338 passed; domain 84 files, 1134 passed; web 28 files, 357 passed; `Tasks: 4 successful, 4 total`.
- Unit: contracts 185 passed; db 151 passed; domain 2411 passed after `machines:docs` (the workshop defaults table) and the refusal-coverage case; web `src/screens` and the lint fences 228 passed; `pnpm copy-lint` clean.
- `eslint --max-warnings 0` per folder (domain src and tests, contracts, db src and tests, web tests and screens): clean. Typecheck of web, db, contracts and domain: clean. The whole-repository lint is left for the final check.
- `EXPLAIN (ANALYZE)`: none yet. The only list read so far is `loadAskConversation` (one conversation by id, its messages on `ask_messages_conversation_idx`); the person's conversation list and its plans come with the screen (steps 7 and 8).

**Decisions the brief did not settle:**
1. No customer's or person's name, phone or address reaches the model: lookups name records by id (`ref`) and document number, and the screen will show each cited record as the person may read it. Targets give the person's own progress and their team's totals, not the callers' leaderboard.
2. Citations are written `[ref:<id>]`; source kinds are vault file, directive, pipeline stage, lead, quote, order and dealer. This month's sales and targets cite nothing, their figures still checked.
3. The filter reads figures the same way on both sides (dates in every common form, lakh and crore, number words two to ninety-nine); figures the person wrote and today's date count as sourced; a list's numbering is not a figure. A follow-up's figures must come from that turn's lookups; its citations may be anything the conversation returned. A failed figure or citation becomes `[unsourced]`, which the screen will put in words.
4. A conversation over several companies is read only while the person views them all, and a follow-up keeps its conversation's companies.
5. The sweep's 90 days sit in the pg_cron command, and a test keeps them equal to `WORKSHOP_DEFAULTS.retention.askDays`.
6. The vault search's embedding is counted under `knowledge:ask` with Ask's caps, not the staff search's.
7. The model's last round is told no more lookups are available; a model still asking ends as `no_answer`.

**Uncertain or unfinished:**
- `0170_ask_companies_check` only rewrites `0168`'s companies check without an array literal (the enum-sync test read `ARRAY[` as a value list); the lead may fold it into `0168` at the renumbering on a fresh database.
- Earlier runs of `ask.test.ts` left six test principals of kind `agent` in this worktree's database, which broke the `fail-closed` count; the test now uses principals without rows, and the six rows were turned into `user` rows locally. A fresh database does not have them.
- The route, the screen, the eval set, the GM-and-Executive cost test, the lists' plans and the documents of step 9 (SECURITY §3.4 and §7, API §6, the design's "Built (B1)") remain for steps 6 to 9. The service has no idempotency key yet; the route will decide it.

### Final, 14 and 15-11-2026 (the lead's cloud VM, worktree `b1-ask`, Postgres 54335)
Steps 6 to 9 on `feat/b1-ask`, after the lead accepted the early check with its decisions. Skills loaded: `add-table`, `add-command`, `claude-api`. Two usage-limit stops; the lead committed what was on disk each time (135f56d5, b288075a), and I checked both before going on.

**Built:**
- **Route** `POST /api/v1/ask` (`apps/web/src/ask/route.ts`, `route-deps.ts`, `app/api/v1/ask/route.ts`; contract `AskInput`, `AskStreamEvent` in `packages/contracts/src/ask.ts`; `API_ENDPOINTS.ask` with its fixture; API §3.1 row).
  - Checked before the stream starts:
    - the caller: a session from the BOS's own origin, or a bearer token through the typed seam `AskRouteDeps.bearer`, which V2 fills (refused until then);
    - `knowledge.ask`;
    - a body of at most 4 KiB;
    - a well-formed `Idempotency-Key`;
    - six questions a minute per person;
    - a model key (`ask_unavailable`);
    - the day's spend caps (`askCapReached()`: `429` with `Retry-After` until midnight in India, `ask_person_cap_reached`, `ask_cap_reached`).
  - The stream is NDJSON: a `lookup` line as each lookup starts, then the `answer` line only once the grounding filter has passed the whole answer (nothing is streamed before the filter runs), with the cited records' words read as the person; or an `error` line.
  - A repeated key is answered from its record with no model call (`recordedTurn`, and a race on the key falls back to the record).
- **Screen** `/ask` (menu Ask the Business, `knowledge.ask:team`; `components/ask/ask-screen.tsx`, `screens/ask.ts`, `actions/ask.ts`):
  - the person's conversations, last used first, with Show older;
  - the open conversation: each answer's citations as numbered links to their records, rupee amounts and percentages as figure cards, and the sources by kind and name as the person may read them now;
  - the `[unsourced]` mark is rendered as the catalogue's "a figure not found in the records", with a note under the answer, and never as raw text on screen or in the stream's display;
  - the running lookup is announced, follow-ups go to the open conversation, Delete asks for a confirmation, and the day's limit is shown as the catalogue's sentence;
  - copy is in `en.json` (`ask.*`, `nav.ask`, five error sentences, the button keys in `copy-lint.config.json`), with the client message scope `/ask` and `/ask` in `BOS_PREFIXES`.
- **Domain additions:**
  - a tenth lookup, `find_items`, which adds an item's cost side (moving average cost and last purchase rate) only with `finance.cost.read`, read through my narrow `itemCostsFor()` under `cost_gate`;
  - amounts are given to the model after ₹, because the masking turns a bare run of nine digits or more (`31250.5000`, any total of ₹10 lakh and up) into `[number]`;
  - the Playbook lookup now reads every approved rule (up to 2,000, through `approvedPlaybook()`) and gives the 50 sharing most words with the model's topic, saying when more were left out (`AGENT_DEFAULTS.ask.directivesScanned`, `directivesRead`);
  - the reads `listAskConversations`, `readAskConversation` and `askSourceLabels` (in reader parity);
  - the recorded-answer transport `recordedAskTransport`, with `STAND_IN_ASK` for `AI_TRANSPORT=fake` (`integrations/ai.ts`), so the journeys run the real lookups, filter and records.
- **Documents:**
  - SECURITY §3.2 (Ask's rules), §3.4 (the voice seam), §6 (eval and injection sets), §11 item 11;
  - API §3.1;
  - DATABASE (§4.4, §6.9, §7, the definer exceptions);
  - the design's "Built (B1)";
  - workshop pack FIN-2 (`askDays`, the caps);
  - JS budget `/ask` 204 kB (measured 194.2);
  - `pnpm db:docs` and `machines:docs` regenerated, no change.

**Tests added since the early check:**
- **The acceptance test** (`packages/domain/tests/security/ask-cost.test.ts`, 2 tests):
  - Seeded data (`tests/fixtures/ask-data.ts`): an item's cost and last purchase rate, and an Executive-only vault file stating a supplier rate, a job cost and a margin.
  - The model is the worst case: it asks for every lookup that could touch those figures and writes back every figure it read.
  - The Executive gets `₹31250.50`, `₹29875.00`, `₹27,640` and `23.5 percent`.
  - The General Manager's lookups, answers, stored messages and log lines hold none of them, nor the passage or dealer credit, while showing the item and the management rule the GM may read.
- `tests/commands/ask-evals.test.ts` (9): the eval set on recorded answers (prompt `ask-1`), seven business questions, two of which are a model that adds a figure of its own or sums figures itself and loses the figure. Two injection cases:
  - a staff vault passage that gives orders, closes its label early, names a record and a figure of its own: it reaches the model only inside its data label, and nothing it ordered survives the filter;
  - a lookup the GM lacks: it is never offered and answers as an error.
- `apps/web/tests/ask-route.test.ts` (7): refusals before the stream, caps before any model call (the transport sees no call), no key, stream lines, a repeat answered from its record, an error line, and the per-minute cap.
- `screens/ask.test.ts` (6): the mark never reaches text, citations and paragraphs, links per kind, figure cards.
- `e2e/ask.spec.ts` (3 journeys × 3 projects): the GM asks, sees the answer and its sources with no raw marks, follows up and deletes, with axe; a tele-caller has no screen; the snapshot company's Executive gives the snapshot `ask` with the conversation list masked.
- `ask.test.ts` grew to 16 tests: the item lookup and the Playbook topic.

**Checks:**
- **Journeys** `pnpm --filter web e2e:seed && pnpm --filter web exec playwright test e2e/ask.spec.ts` after `pnpm build`, through the lock: `23 passed (33.2s)`.
  - The first run failed axe colour contrast on the selected conversation's time; that is fixed.
  - The `ask` screenshots the host run wrote under `e2e/__screenshots__` were deleted, not committed: the Linux baselines are yours to make on a fresh database (`e2e:snap`).
- **`pnpm test:security`** (last full run, after the Playbook topic change):
  - db: 49 files, 1338 passed;
  - domain: 86 files, 1145 passed;
  - web: 29 files, 363 passed and 1 failed (`demo-data.test.ts`: `PUMP-3HP` price not found). It failed again when run alone. It passed in the runs of the 14th before the many suite and seed runs since. It reads the live retail list's first 200 prices (`listPrices` with `limit: 200`), and this database now holds 294 items, so the demo items fall past that page. I read the counts and changed no rows. The fix is a fresh database (your step); the test's reliance on 200 rows is not mine to change in this slice.
- **Unit tests:**
  - contracts 186 passed;
  - db 151 passed;
  - domain 2411 passed;
  - web 1067 passed, 1 skipped;
  - `pnpm copy-lint` clean.
- **`pnpm --filter web js-budget`**: `/ask 194.2 kB, budget 204, ok`.
- **The whole-repository `pnpm lint`** (the final check, through the lock): exit 0. It first found three JSX literals and an unused variable, which are fixed. Typecheck of web, db, contracts and domain is clean.

**`EXPLAIN (ANALYZE, BUFFERS)`** (`pnpm --filter @shakti/domain exec tsx tests/spike/ask-explain.ts`, local Postgres, under the policies as the person). The data: 200 people with 100 conversations each, one with 2,000, four messages each (820,000 messages). Everything is removed at the end.
- **Conversation list, first page:** Bitmap Index Scan on `ask_conversations_user_updated_idx` (`user_id = …`, 2,000 rows, 16 buffers) → Bitmap Heap Scan (filter `entity_ids <@ app.entity_ids()`) → top-N heapsort of 31; execution 2.19 ms, 100 buffers.
- **Second page:** the same index with the keyset row comparison in the index condition, 1,970 rows; execution 1.49 ms, 47 buffers.
  - The list is bounded by one person's conversations of the last 90 days, so the top-N sort stays small. An index-ordered scan would need the policy's `user_id` from a subselect, which the planner does not fold.
- **One conversation's messages:** Index Scan Backward on `ask_messages_conversation_idx`, 4 rows, 0.057 ms.
- **The sweep** (as the owner, rolled back): Index Scan on `ask_messages_created_idx` and on `ask_conversations_updated_idx`, under 0.1 ms each.

**Decisions the brief did not settle:**
1. The answer is not streamed token by token. The transport calls the model whole, and the filter must see the complete answer before any figure is shown, so the stream carries the lookups as they run and then the filtered answer. V2 reads the same lines.
2. The item lookup was added so the acceptance test is meaningful: without it no lookup ever returns a cost.
   - Job costs and margins have no table yet (Phase 3), so they are seeded as an Executive-only vault file, the way such a document would arrive today.
   - The last purchase rate is a supplier rate held under `finance.cost.read` (`item_costs`).
3. The source kinds include `item`, and the stored answer keeps the typed marks `[ref:<id>]` and `[unsourced]`; the screen turns both into words or links.
4. The route allows six questions a minute per person.
5. `maxDuration` is 300 seconds.
6. The key is optional on the route, as on the files routes. The screen sends a new key per question.
7. The brief's "API §6" is documented in API §3.1, where the endpoint catalogue and its test live; §6 is the outbound messaging contract. SECURITY §7 is telecom compliance, which Ask does not touch; the Ask rules went to §3.2, §3.4, §6 and §11.

**Uncertain or unfinished:**
- The `ask` screenshot baselines (your `e2e:snap` on a fresh database).
- This database needs recreating for `demo-data.test.ts`, as above.
- `0170_ask_companies_check` may be folded into `0168` at the renumbering.
- The live model has not been run on the eval questions (by hand only, never in CI; it needs a key).
- `js-budget.json` and `copy-lint.config.json` changed, so the pull request needs the owner's `checks-ok`.
