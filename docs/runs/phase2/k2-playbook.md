# K2 Playbook directives (wave 1)

| | |
|---|---|
| Branch | `feat/k2-playbook` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | built, report written |
| Next step | review (slice-reviewer), then integration; Linux baselines for the snapshot `playbook` and `checks-ok` for `js-budget.json` |

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

### Built, 13-11-2026, cloud session
Skills loaded: `add-table`, `add-command`; the Claude API reference (`claude-api`) for the 5.5 models' prices and effort.

**Built after the early check** (the lead's five points of 13-11-2026 applied):
- **Platform-only `knowledge.playbook.check`** of `system:workers` (catalogue, scopes, `SYSTEM_MATRIX`, seed, label, SECURITY §3.2 and §3.3) and migration `0162_playbook_check`: `app.platform_only_permissions()` keeps every key of `main`'s latest (0142) and adds this one; three definers, each checking the grant: `app.playbook_check_targets()` (what a change asks to check: the unchecked draft, or the drafts a new approval made stale), `app.playbook_check_candidates()` (approved, same type, overlapping company, within the distance, nearest first, at most 20) and `app.record_playbook_check()` (locks the draft, skips it when no longer a draft or its text's SHA-256 changed; new wording drops every earlier pair, a recheck keeps a resolved one; sets `embedding`, `checked_at` and `conflicts_with`).
- **The conflict check** (`packages/domain/src/knowledge/playbook-check.ts`, `checkPlaybook`), run by the worker of `knowledge.playbook.changed` after the version bump: embeds the draft (or reuses its embedding on a recheck), finds the candidates at `AGENT_DEFAULTS.playbook.conflictDistance` 0.20 (nearest 5), labels each pair with Haiku 5.5 at low effort through the provider wrapper (`knowledge:playbook` spend), the two rules labelled as data, and records through `knowledge.playbook.record_check` (platform command, audited with counts only). A pair the model cannot label (no key, refused, unreadable answer) is recorded with a null label and counts as open; a draft stays unchecked while no embedding key is set.
- **Drafting from a vault file**: `playbookSourcePassages` (the file's passages as the drafter reads them, at most 60), `proposeDirectives` (Sonnet 5.5 at medium effort, the drafter's daily share, a 90-second call) and `filterDrafts` (type, audience, length, cited passage, duplicates, at most ten), then `knowledge.playbook.draft_from_file` (people only) writes them in one transaction through `knowledge.playbook.draft`. A directive is read by no more people than its file: none from an Executive-only file, management only from a management file, enforced in the commands, the insert policy and the guard trigger (0161 amended).
- **`AGENT_DEFAULTS.playbook`** and the prices of `claude-haiku-5-5` ($0.10 / $0.50, cache read $0.01, cache write $0.125) and `claude-sonnet-5-5` ($2 / $10, cache read $0.10, cache write $2.50), checked 13-11-2026 against Anthropic's published list as the Claude API reference carries it (cached 03-11-2026; the cache-write prices and Haiku's cache read are the list's usual 1.25 and 0.1 times input, flagged for the owner); `MODEL_CONTEXT_TOKENS` for both; an optional `effort` on `CompleteCall` and `ModelRequest`, sent as `output_config.effort`.
- **Queries and actions**: `listPlaybook` (state, type, company, keyset on `(created_at, id)`), `loadPlaybookReview` (the directive, its source passage, each pair beside the other directive as far as the reader reads it), and the server actions in `apps/web/src/actions/playbook.ts` (with a quiet re-read while a check runs and a cap of three drafting runs a minute per person).
- **The screen** `/knowledge/playbook` (menu Playbook, `knowledge.playbook.draft:all`): filters by status, kind and company; the list with "Being checked" and the count of clashes; the review with the source passage and each approved rule side by side, the label and its reason, how a clash was settled; Approve (disabled until it can be approved), Edit, Retire, Not a clash, Retire the other rule; New rule and Draft from a file dialogs; keys J, K and A; read again every three seconds while the rule waits for its check. Copy in `en.json` ("rule" and "clash"); four new button suffixes in `tools/copy-lint/copy-lint.config.json`.
- **The seed** writes the snapshot company's Playbook once (an approved rule and a draft the stand-in model labels an overlap with it) for the journey's snapshot.
- **Documents**: DATABASE §4.1 (the three definers), §4.4 and §6.9; SECURITY §3.2 (the Playbook rules, including the line on a custom role holding only `.approve`), §3.3; the design's "Built (K2)" in §5.4; PRD AI-01 traceability; the plans pointer in the spikes' readme; `pnpm db:docs` and `machines:docs` regenerated.

**Tests added since the early check** (totals for the slice in brackets)
- `packages/domain/tests/commands/playbook-check.test.ts`: 9 on Postgres with the fake transport (flags a close pair and blocks approval; `none` stays approvable; type and company overlap, the group overlapping every company; an unlabelled pair is open and resolvable; waits without embeddings; an edit drops old pairs; an approval makes drafts stale and the recheck keeps a resolved pair; a stale record is skipped; the platform's alone).
- `packages/domain/tests/commands/playbook-draft.test.ts`: 7 (denied, agent, other company; drafts cite their passage; audience never wider than the file, Executive-only refused, a missing passage refused; group files; the model's answer filtered; no key; the list by filters and refused to a non-drafter).
- Unit: `playbook-check.test.ts` 4 (label filter), `playbook-draft.test.ts` 4 (drafting filter), `apps/web/src/screens/playbook.test.ts` 3 (keys, stepping, what blocks approval).
- Journeys `apps/web/e2e/playbook.spec.ts`: 5 per project, 15 across desktop light, desktop dark and phone (an Executive drafts, approves, settles a clash on a second rule and approves it with A, retires the first; drafting from the snapshot vault file gives no rule while the stand-in model answers nothing; a GM drafts but has no Approve; a tele-caller does not see the screen; the snapshot company's Executive reviews the seeded pair, moves with J and K, axe, the snapshot `playbook`). Axe runs in every journey but the tele-caller's.
- Slice totals on Postgres: domain 32 (16 + 9 + 7), db security 7; agent refusal sweep inputs for all seven playbook commands; reader parity for both queries.

**Checks** (the last run first)
- `pnpm test:security` on the local Postgres, on f4c6426a, the last code commit: db 1287 passed (46 files), domain 1079 passed (81 files), web 342 passed (26 files); 4 of 4 tasks.
- Unit tests: contracts 182, db 148, domain 2367, web 974 (1 skipped), ui 107, tokens 146, copy-lint 17, all passed.
- `pnpm typecheck` 8 of 8 tasks; `prettier --check .` clean; `pnpm copy-lint` clean; `drizzle-kit generate` reports no drift.
- `pnpm build` passed; `pnpm --filter web js-budget`: `/knowledge/playbook` 197.9 kB of 208 kB (new entry in `apps/web/js-budget.json`).
- `pnpm --filter web e2e:seed && playwright test playbook.spec.ts`: 29 passed (15 journeys and the sign-ins). The snapshot pictures were written locally on this VM and removed; the Linux baselines are the lead's (`e2e:snap`).
- `check-doc-links.py`: the three failures are the existing links to `.claude/settings.local.json`, absent in a cloud session.
- Whole-repository `pnpm lint` (`eslint . --max-warnings 0`), the last check: exit 0, no warnings.

**`EXPLAIN (ANALYZE)`** at 6,000 synthetic directives (a third approved with embeddings), committed by the migrator and removed after; the list as a General Manager acting for company 1 on `app_user` under row-level security, the candidates as the definer runs them:
- The list, drafts of one kind: `Bitmap Index Scan on playbook_directives_state_type_idx` (state, type), 2,000 rows, the policy's filter keeps 200, top-N heapsort of 51; execution 3.3 ms.
- The list with no filter: `Seq Scan on playbook_directives` with the policy's filter, 2,400 kept of 6,000, top-N heapsort of 51; execution 4.0 ms. No index serves the unfiltered order; at the Playbook's expected size (hundreds of rules) a scan is cheaper than an index on `(created_at desc, id desc)` would be worth.
- The candidates, approved policies for company 1 or the group: `Bitmap Index Scan on playbook_directives_state_type_idx` (approved, policy), 2,000 rows, the company filter keeps 600, exact cosine order, top-N heapsort of 5; execution 8.6 ms. The planner prefers the exact order on the type's few hundred rows to the HNSW index, which serves a larger Playbook.

**Decisions the brief did not settle**
1. A null label is a pair the model could not label; it counts as open and the Executive may settle it (`playbook_conflict_checks_resolved_check` allows a resolution unless the label is `none`).
2. The three definers reach directives of any company from a request with a company: a conflict is the group's matter (a group directive overlaps every company, and an approval of a group directive makes drafts of every company stale), and the worker acts in the event's one company. They answer wording and ids only. The lead's decision named two definers; the third (targets) serves the recheck of point 2 of the decisions.
3. Without an embedding key a draft stays unchecked and cannot be approved (fail closed), as a vault file stays unavailable.
4. Drafting runs in the server action as the drafter (the passages under their own row security, the drafts in their name), not in a worker; the call is held to 90 seconds and three runs a minute.
5. Spend: the Playbook's own name `knowledge:playbook`, ₹300 a day for the group and ₹100 a day per person for drafting, flagged for the owner in `AGENT_DEFAULTS`.
6. The version key holds a new id per change (`knowledge:playbook:version`, kept a year), never a counter, so an expired key cannot repeat an old value.
7. The menu item needs `knowledge.playbook.draft`, so a custom role holding only `.approve` does not see the screen (as it cannot retire a draft).
8. `/admin` (Activity log) and `/knowledge` send the `playbook` namespace to the browser.
9. The fake transport's empty answer makes the journeys exercise the unlabelled path and the "no rule drafted" path; a labelled pair is shown from the seed's snapshot company.

**Unfinished or uncertain**
- Not yet read by any agent: A3 and B1 consume the approved set (row security already keeps drafts away, and the version key tells them when to reread).
- `source_voice_session_id` is left for V2.
- The prompts of the label and drafting calls have unit tests of their filters, not an eval set; an eval set on recorded answers belongs with the first agent that reads the Playbook, or a follow-up.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; if K2 redefines `app.platform_only_permissions()`, keep every key P5 or E1 adds.
- K2's migrations are 0160 (generated), 0161 and 0162 (custom). 0162 redefines `app.platform_only_permissions()` with `main`'s 0142 keys and `knowledge.playbook.check`; merge P5's and E1's keys into whichever definition comes last. `caller-profiles.test.ts` now counts the list by `PLATFORM_ONLY_PERMISSIONS.length`, so only the arrays need the merge.
- Shared registration points touched: the permission catalogue, scopes, `SYSTEM_MATRIX`, seeds and labels; `en.json`; `nav.ts`; `ENTITY_TABLES` and the matrix fixture; `grants.test.ts` and `enum-sync.test.ts`; the agent refusal sweep; the event catalogue (`knowledge.playbook.changed`, subscribed) and the event workers' registry; `AGENT_DEFAULTS` (the 5.5 model prices, the same lines V1 adds, and `playbook`); `MODEL_CONTEXT_TOKENS`; the provider wrapper's `effort` field (`CompleteCall`, `ModelRequest`, the Anthropic transport), which V1's changes to the wrapper may meet.
- `apps/web/js-budget.json` gains `/knowledge/playbook`: a check file, so the pull request needs the owner's `checks-ok`. `tools/copy-lint/copy-lint.config.json` gains four button suffixes (not a check file under the rule).
- The snapshot `playbook` needs Linux baselines (desktop light, desktop dark, phone) from `e2e:snap`; the seed writes the snapshot company's Playbook once.
