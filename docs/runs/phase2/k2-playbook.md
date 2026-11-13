# K2 Playbook directives (wave 1)

| | |
|---|---|
| Branch | `feat/k2-playbook` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | early check |
| Next step | the lead reads the early check; then the conflict check, drafting and the screen |

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

### Early check, 13-11-2026, cloud session
Skills loaded: `add-table`, `add-command`.

**Built**
- Tables (`packages/db/src/schema/knowledge.ts`; migrations `0160_playbook` generated, `0161_playbook_rls` custom; numbers move at the merge): `playbook_directives` and `playbook_conflict_checks` as §5.4 says, plus `source_position` (the cited passage), `retired_at` and `checked_at` (when the conflict check last ran on the current wording); `source_voice_session_id` is left for V2, which creates `voice_sessions`.
- RLS (0161): a directive is read in a company of the request, or for the group in any request with a company, by audience (`customer` and `staff` with `knowledge.vault.read.staff:all`, `management` with `knowledge.vault.read.management:all`), and **only once approved**; a draft or retired directive, and every conflict pair, only by holders of `knowledge.playbook.draft:all` or `.approve:all`. No agent holds either, so "a draft never steers an agent" is a database fact. Writes: insert only as a draft by a drafter; the guard trigger `app.playbook_directives_guard()` keeps updates on the machine (rewording only a draft, and it clears `embedding`, `checked_at`, `conflicts_with`; `embedding`/`checked_at` only to null; `conflicts_with` only shrinks; approval only by an approver, as themselves, of a checked draft with `conflicts_with` empty; retiring an approved directive only by an approver; nothing after retired). Pairs: no request inserts; an approver sets only the resolution of an open pair, as themselves.
- Permission `knowledge.playbook.draft` (Executive and GM, all; agent-forbidden): catalogue, scopes, seed, label, SECURITY §3.2 row (the permission-matrix oracle reads it), SECURITY §3.3 agent line.
- Machine `playbook_directive` now built (`stored`, `MACHINES_IN_USE`): create and edit take `knowledge.playbook.draft`; approve takes `.approve` with guards `playbook_check_pending` then `playbook_conflict_open`; retire from draft takes `.draft`, from approved `.approve`; every move emits `knowledge.playbook.changed`. `docs/state-machines/` regenerated.
- Commands (`packages/domain/src/commands/knowledge/playbook.ts`, `playbook-shared.ts`), all people only and audited: `knowledge.playbook.draft`, `.edit`, `.approve`, `.retire`, `.resolve_conflict` (`not_a_conflict` with a note, or `other_retired`, which retires the other directive with the note as its reason). Retiring an approved directive settles every open pair naming it as `other_retired` and drops it from drafts' `conflicts_with`. Approval recomputes the open conflicts from the pairs (a pair whose other directive the approver cannot see counts as open) and requires the check to be newer than the last approval of the same type for an overlapping company.
- Event `knowledge.playbook.changed` (ids, `change`, `state`, `recheck`), subscribed; its worker writes a new version id to Redis (`knowledge:playbook:version`, `bumpPlaybookVersion()`), so the agents and Ask reread the approved set.
- Copy: eight `errors.*` sentences (`directive_conflict` renamed to the brief's `playbook_conflict_open`), Activity log names for the five commands and the event, nine field labels, `playbook.{type,audience,state,resolution}` values; `/admin` sends the `playbook` namespace.
- Registrations: `ENTITY_TABLES`, the matrix fixture (two approved staff directives and a pair per company and for the group) and its rules, `NARROWER`, `enum-sync` (five lists), agent refusal sweep inputs (restricted and people-only), audit labels, contract values.
- Documents: DATABASE §4.4 and §6.9, SECURITY §3.2, §3.3 and the Playbook rules, `pnpm db:docs`, `machines:docs`.

**Tests added**
- `packages/domain/tests/commands/playbook.test.ts`: 16 (denied, wrong company and happy path for each command; check pending, stale check, open conflict, the guard in the database, settling on retire, both resolutions).
- `packages/db/tests/security/playbook.test.ts`: 7 (each audience and the draft per role for every role key; no agent sees a draft; group and company scope, nothing without context; insert and update rules; the pairs' read and resolve rules).
- Unit: machine cases updated (+1), `playbook-version.test.ts` (1), `apps/web/src/workers/events/playbook-version.test.ts` (1).

**Checks**
- `pnpm test:security` on the local Postgres, on 2dd5ae45: db 1287 passed, domain 1063 passed, web 342 passed.
- After the version-bump commit: unit tests contracts 182, domain 2358, web 923 (1 skipped), db 147, all passed; typecheck of contracts, db, domain and web clean; `eslint --max-warnings 0` on every folder touched clean; `pnpm copy-lint` clean.
- The whole-repository lint, the build and the journeys are not run yet (no screen yet).

**Decisions the brief did not settle (for the lead)**
1. The conflict check runs in the event's worker, not in the command's transaction (an embedding and a model call per candidate would hold the transaction). I plan a platform-only `knowledge.playbook.check` for `system:workers` with two definers (candidates and record), which redefines `app.platform_only_permissions()`; the integration note on P5 and E1 keys applies. Say if you prefer another shape.
2. `checked_at` and the reason `playbook_check_pending`: approval waits until the check has run on the current wording, and again after any approval of the same type for an overlapping company (that directive was never compared). The worker rechecks those drafts on an `approved` event.
3. `.retire` declares `knowledge.playbook.draft` as its guard permission, and the machine asks `.approve` for an approved directive; a custom role holding only `.approve` could not retire. Both seeded holders are fine.
4. On screen a directive is a "rule" and a conflict a "clash", as the existing catalogue sentence already said.
5. Haiku 5.5 and Sonnet 5.5 are needed in `AGENT_DEFAULTS.modelPrices` for the next part; V1 adds them too, so the lead may see the same lines from both.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; if K2 redefines `app.platform_only_permissions()`, keep every key P5 or E1 adds.
