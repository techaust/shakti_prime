# F2 Sync engine and conflict review (Phase 4, wave 2)

| | |
|---|---|
| Branch | `feat/f2-sync` on GitHub, from `main` after F1 and J1 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): offline sync of commands, with conflicts |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase4 §7.4](../../03-roadmap-appendix/phase4.md#74-f2-sync-engine-and-conflict-review) as written, with ADR 0012 (accepted). Read `packages/contracts/src/api/sync.ts` first; it is the protocol. Follow [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Routes:** `GET /api/v1/sync/pull?since=` and `POST /api/v1/sync/push`, on F1's mobile bearer, through `withRequestContext()` as the person, with F1's `X-App-Version` gate.
   - The cursor is opaque (a signed, versioned encoding of per-collection high-water marks, never a raw timestamp the client can forge into another company's rows). An expired or foreign cursor answers a full pull.
   - Pull pages are bounded (named default) and each collection reads under the person's own row security.
   - Push takes 1 to 100 commands in order, each through `executeCommand()` with its idempotency key (F1's Redis front, then `idempotency_keys`), answered `applied`, `replayed`, `conflict` (with the server's record), `rejected` (a domain error's code and reason) or `held` (a later command on a record with an open conflict).
2. **The collections registry** (`packages/domain/src/sync/collections.ts`): each collection names its DTO, its scope rule and its conflict rule. F2 registers `projects`, `project_milestones`, `customer_sites` and `reference` (the person's companies, pipelines' segments and the items a field engineer may pick). Later slices add theirs with one entry.
3. **Conflict rules** as ADR 0012 and §7.4 say, each a pure function with unit tests: `state_changed`, per-field merge by `clientTime` (`field_newer_on_server`), `record_removed`, `stock_short`.
4. **The app** (`apps/field`): the WatermelonDB schema and models for the four collections; the sync loop (pull then push, on start, on regaining a network, every 5 minutes while open); the outbox of commands with client UUIDv7 ids; the Conflicts screen showing both versions and the person's choice; the copy in `apps/field/messages/en.json`. Nothing is discarded unseen.
5. **Tests:**
   - the protocol against the real API and Postgres with WatermelonDB's LokiJS adapter in Node (jest in `apps/field`, the API in the web suite);
   - a device offline for 5 days with 500 commands syncing without loss or duplicate effects (FLD-02);
   - two devices editing one record merging field by field;
   - a cursor of another person or company refused; a pull never returning a row the person cannot read.
   
   The native build job of `ci.yml` builds the app on CI; you cannot run Gradle in the seat.

**Early check (Tier A):** once the routes, the registry, the conflict rules and the protocol tests pass, write a short report and push `report: f2-sync early check`, then stop.

Files owned: `apps/web/src/app/api/v1/sync/**`; `packages/domain/src/sync/**`; the sync parts of `apps/field`.

Do not touch: the field screens of later slices (F3, F4); mobile sign-in (F1's).

Review checklist: the cursor cannot reach another person's or company's rows; every pushed command runs as the person through `executeCommand()` with its key; no duplicate effects after replays; nothing discarded without the person's choice.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 4 design](../../03-roadmap-appendix/phase4.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm format:check` (Prettier);
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: f2-sync <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: f2-sync blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0259 on 28-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 4 wave 2, from 28-11-2026):**
- `j5-scheduling`: crews, schedule slots, unavailability, the board;
- `j6-qc-costs`: checklists, QC inspections, project cost lines, the contractor vendor kind;
- `f2-sync`: the sync routes, the collections registry, the app's sync loop and Conflicts screen.

On `main` already: J1 (projects), J2 (loans), F1 (the field app and mobile sign-in). Being integrated beside you: J3, H2, U2, H3, R3, HR1, FN1, TC2.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
