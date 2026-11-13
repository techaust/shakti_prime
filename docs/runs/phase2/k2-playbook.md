# K2 Playbook directives (wave 1)

| | |
|---|---|
| Branch | `feat/k2-playbook` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | brief |
| Next step | build to the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §5.4](../../03-roadmap-appendix/phase2.md#54-k2-playbook-directives), §2 (question 1: Haiku 5.5 labels and Sonnet 5.5 drafts; question 11: `knowledge.playbook.draft` for the Executive and the General Manager, approval the Executive's alone), §4, §11 and §14.
- BLUEPRINT §9.1 and §9.3; PRD AI-01 (directive review); SECURITY §3.2 and §7 (the AI threat model); DATABASE §6.9 (the planned `playbook_directives`); ADR 0011 (Voyage embeddings, HNSW).
- What exists: the Knowledge Vault from K1 (`knowledge_files`, `knowledge_chunks`, `searchKnowledge()`, `/knowledge`, masking before any model call); the built `playbook-directive` state machine; `knowledge.playbook.approve` in the catalogue and seed; the provider wrapper with spend names and caps, `embed` and the fake transport (`AI_TRANSPORT=fake`); `AGENT_DEFAULTS`; the Redis client.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **`playbook_directives` and `playbook_conflict_checks`** as §5.4 says, with RLS by company and audience (`customer` and `staff` by every staff role of the company, `management` with `knowledge.vault.read.management`), the testing lists, fixture rows and the role × company matrix (AGENTS §6).
2. **`knowledge.playbook.draft`** permission (Executive and GM, all; no agent) with its SECURITY §3.2 row, seed and oracle case.
3. **Commands** `knowledge.playbook.draft`, `.edit`, `.approve` (refused with `playbook_conflict_open` while a conflict is open), `.retire`, `.resolve_conflict`; each audited, each emitting `knowledge.playbook.changed`, which bumps a Redis version key; denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.
4. **The conflict check:** candidates by type, overlapping companies and cosine distance within `AGENT_DEFAULTS.playbook.conflictDistance` (0.20), labelled by Haiku 5.5 through the provider wrapper (`knowledge:playbook` spend name) with a reason; the model only labels. Tests on the fake transport.
5. **Drafting from a vault file:** at most 10 typed drafts from its masked passages by Sonnet 5.5, each citing its passage, landing in `draft`.
6. **`/knowledge/playbook`** (menu Playbook under Knowledge): directives by state, type and company; the review sheet with the source passage and the conflicting directive side by side, Approve, Edit, Retire, Not a conflict; keys J, K and A. Copy in `en.json`; journeys with axe; the JavaScript budget.
7. **Tests:** every acceptance line of §5.4 (a draft never steers an agent; an open conflict blocks approval; approving or retiring changes what the next run reads); the security suite proving each audience per role; `EXPLAIN (ANALYZE)` for the list and the candidate search under RLS.
8. **Documents:** DATABASE, SECURITY §3.2, the knowledge document, design §5.4 "Built (K2)", `pnpm db:docs`, `machines:docs` if the machine changes.

Files owned: everything above. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, `AGENT_DEFAULTS`, the event catalogue. P5, E1 and V1 build beside you: never touch `webhook_inbox`, the webhook routes, `entity_channels`, the telecom rules or `apps/web/src/integrations/voice`.

**Early check (Tier B):** once the tables, the permission and the commands are committed with their tests, write a short report in this file, commit it with the subject `report: k2-playbook early check`, push and stop. The lead reads that diff and starts you again for the conflict check, drafting and the screen.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §5.4 pass; `pnpm test:security` passes on the local Postgres.

Not in K2: Teach by voice (V2); Ask the Business (B1); any directive's wording (the client's first Playbook is a final-phase item; tests use clearly synthetic text).

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; if K2 redefines `app.platform_only_permissions()`, keep every key P5 or E1 adds.
