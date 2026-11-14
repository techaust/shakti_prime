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
