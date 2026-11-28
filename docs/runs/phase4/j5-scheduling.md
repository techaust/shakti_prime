# J5 Scheduling board (Phase 4, wave 2)

| | |
|---|---|
| Branch | `feat/j5-scheduling` on GitHub, from `main` after J1 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): schedules, conflicts and a drag-and-drop board |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase4 §7.2](../../03-roadmap-appendix/phase4.md#72-j5-scheduling-board) as written, with questions 6 (a) and 12 (the approved packages: `@dnd-kit/core` and `maplibre-gl` are in the lockfile; use only those). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:**
   - `crews` and `crew_members` (per company; a crew has a name, a lead and members who are staff principals).
   - `schedule_slots` with the columns of §7.2.
   - `unavailability` (a person, a start and an end, a reason kind, and who recorded it).
   - Row security: `projects.schedule.write` and `projects.read` per their scopes. A Field Engineer reads the slots they are on (`app.project_is_mine()` for the slot's project, or the slot's engineer or crew). Unavailability is read by the schedulers of the company and by the person themselves.
   - HR1's `hr.leave.approved` writes unavailability rows when HR1 merges; until then, record that hook as a named follow-up (HR1 assumption 10) and do not subscribe to an event that is not on `main`.
2. **Pure functions in `packages/domain/src/projects/schedule.ts`:**
   - `findScheduleConflicts(slot, existing, unavailability, travel)` names each conflict: double booking, unavailability, and too little travel time between consecutive visits. Travel is straight-line distance × the road factor ÷ the average speed (workshop PROJ-4, named defaults in `WORKSHOP_DEFAULTS.projects`). It never calls a routing API.
   - `suggestSlots(project, window, engineers, existing)` ranks free slots per engineer by travel from their previous visit, deterministic for equal scores.
   - Unit tests at every edge: back-to-back visits, a visit crossing midnight IST, an engineer with no previous visit, and equal scores.
3. **Commands:** `projects.slot.propose`, `.confirm`, `.move`, `.cancel` and `.done`; `projects.crew.save`; `projects.unavailability.record` and `.remove`.
   - Saving over a conflict needs a reason, which is audited with the conflicts named.
   - An agent may only propose (`proposed_by` an agent principal); confirming is people-only.
   - `projects.slot.done` is the person's record of the visit, not a milestone completion (J1's command stays the only one).
4. **Screens:** `/projects/schedule` as §7.2 says:
   - the day and week views per engineer or crew, with drag and drop through `@dnd-kit/core` and a keyboard path for every move;
   - the unassigned queue (milestones waiting for a visit);
   - the map of the day behind the `schedule_map` feature flag (F1's `feature_flags`), off by default. The tile URL comes from an environment variable listed in `turbo.json` and `.env.example`, with no key in the repository;
   - Unavailability.
   
   Journey: a Project Manager proposes and confirms a visit from the queue, sees a conflict named and saves over it with a reason, and marks a person unavailable. With axe and snapshots.
5. **Performance:** the board renders 30 engineers × 7 days within its JavaScript budget (lazy-load the map and the drag layer). The week query has `EXPLAIN (ANALYZE)` evidence at 30 engineers × 7 days × 6 slots.

**Early check (Tier B):** once the tables, the pure functions, the commands and their tests are committed, write a short report and push `report: j5-scheduling early check`, then stop.

Files owned: the four tables and their migrations; `packages/domain/src/projects/schedule.ts`; `packages/domain/src/commands/projects/schedule*.ts` and their queries; `/projects/schedule`.

Do not touch: the project page beyond one tab or link line (J1); visit booking and messages (J9); the field app (F3).

Review checklist: conflicts computed by the pure function only, before every save; saving over a conflict audited with a reason; an agent can only propose; the map off unless flagged, with no key in the repository; the board's keyboard path.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: j5-scheduling <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: j5-scheduling blocked` with the question and stop.
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
