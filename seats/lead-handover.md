# Lead handover (the lead writes this; seats ignore it)

Updated 28-11-2026 05:10 UTC by the lead of day 1. Read this with `docs/10-status.md` (on `main` after #301) before acting.

## Pull requests and hosted environments
- **#300 J2 customer loans:** merged 28-11 04:45 UTC (`5f5ea1e7`). CI on `main` green; dev and staging migrated through 0246, `db:verify` passed, health 200 on both.
- **#302 X1 demo-data test:** merged.
- **#303 TC1 Tally connector:** `checks-ok` on. The merge workflow took `main` in; its two `pull_request` runs were held (`action_required`) and re-run at 05:05 UTC; a background task starts the look when they pass. No migration.
- **`fix/axe-title-wait`** (079b20b3, pushed, no pull request yet): `e2e/support/axe.ts` waits for a non-empty `<title>` before axe (Next 16 streams metadata after the body; `document-title` failed the phone stock card about 1 run in 36 and held #300 twice; 56 of 56 passed with the wait). Open its pull request after #303 merges; not a checks file.

## Integration queue, in order
1. **The calling-hours fix** (`fix/calling-hours-clock`, slot 5: 54335, 3035): `main` after J2 taken in (pushed); `integrate.sh` in parts, then the whole Linux journey set per project (update, then verify), running in the lead's VM from 05:00 UTC (logs in the lead's scratchpad `ch-logs/`). Then commit any baselines, the run file's integration entry, and the pull request (no checks files, no migration).
2. **F1:** second prep after J2 on seat 4 (lane 101, done when `report: f1-field-foundation prepped after j2`). Then the lead's journeys and baselines and the pull request. Needs `checks-ok`: `ci.yml` (native Android build job), `turbo.json`, `pnpm-workspace.yaml`. Read the first native build: if WatermelonDB 0.28.0 fails on React Native 0.88, that is the owner's decision (ADR 0012).
3. **J1:** second prep after J2 on seat 3 (lane 102, done when `report: j1-projects prepped after j2`). Check its redefinitions yourself as well (watch list below).
4. **H2:** prepped before J2: take `main` again (no migration clash expected beyond renumbering). `app.stock_move()` is X4's 0240 body plus H2's one rule.
5. **U2:** prepped before J2 (security db 1,903, domain 1,574, web 475; `label_sheet` kept). Take `main` again.
6. **FN1:** re-check passed. At integration, after J2 (now merged):
   - redefine `app.order_loan_gate()` from J2's latest (0243 to 0246 on `main`), with `finance.milestones.process:all` answering;
   - add finding 4's three worker-registry lines for J2's loan events;
   - add a loan-held test on J2's real definer.
7. **R3:** fix round done, re-check passed (lane 82). Needs a prep.
8. **TC2:** fix round running (seat 2, lane 96). The lead reads the diff. M4 (snapshots in parts) is TC4's.
9. **J3:** built (`report: j3-documents done` 28-11 ~04:50); review on seat 1 (lane 99). When J1 merges, J3 takes `main` and adds the foreign key to projects and `app.project_missing_documents()` over its definer.
10. **H3:** building (seat 2, lane 91); review lane 98 on seat 1 waits for it.
11. **HR1:** moved to seat 3 (lane 100) at 04:45 UTC after two hours with no commit on seat 2; review lane 97 on seat 1 waits for it. If seat 3 has not committed on `feat/hr1-people` by 05:45 UTC, seat 3 is stopped: ask the owner to restart it.

## The watch list at every merge (shared definers and checks)
Each later slice carries every earlier line of `main`'s latest:
- `notifications_type_check` and `notification_preferences_type_check` (J1, H2, J2 merged, F1?);
- `notifications_subject_type_check` (J1);
- `app.next_document_no()` and `document_sequences_doc_type_check` (R3, U2, J1, FN1, H3?);
- `app.platform_only_permissions()` (H2, U2, J1, FN1, TC2);
- `app.file_purpose_grant()` and `files_purpose_check` (Q1 merged, J3, U2);
- `roles_key_check` (TC2);
- `app.status_summary()` (J1);
- `app.order_loan_gate()` (J2 merged; FN1 adds `finance.milestones.process`);
- `app.stock_move()` (X4 merged; H2).

## Lessons from day 1
- Builders run `pnpm format:check` before reporting (the seats' readme). Two preps stopped on Prettier alone.
- The Linux image's whole journey set per project, before a pull request, whenever a slice adds seed rows or a menu entry.
- `copy-lint.config.json` is not a checks file; `js-budget.json` is.
- `wait.sh`'s `has_subject` had a pipefail bug (fixed).
- Seats must never end their turn (readme).
- Seat 3 hit its 5-hour limit at five agents, so it runs at three.

## Usage pacing (weekly resets, UTC)
Lead Thu 07:00 · seat 1 Thu 10:00 · seat 2 Mon 15:00 · seat 3 Tue 16:00 · seat 4 Fri 05:00. Weekly line = 100 % × hours since reset ÷ 168, plus 5; above it drop an agent, more than 10 under it allows up to 5.
Last reading 28-11 03:48 UTC: lead 5h 6 wk 8 · seat 1 5h 4 wk 28 · seat 2 5h 31 wk 25 · seat 3 5h 1 wk 34 · seat 4 5h 2 wk 16. Lines then: lead 17, seat 1 16 (above: seat 1 runs reviews only, at 3), seat 2 70, seat 3 55, seat 4 19. `max_agents` now: seat 1 3, seat 2 5, seat 3 5, seat 4 2. Seat 1's weekly use is the tightest: keep its lanes to reviews and lower it to 2 if the next reading is still above its line.

## Follow-ups to record in STATUS at end-session
H1 hub pairing (MAX_PARAMETERS past ~60 hubs); H1 stock card cursor drops microseconds; catalogueFixture vs demo data price lists on a fresh database; the outbox backlog on aged local databases; TC4 sends snapshots in parts; F1's key pair required in productionConfigProblems before F5; F1's Sentry React Native package needs the owner's yes; J5 writes unavailability on hr.leave.approved; U2 tax on a purchase from an unregistered vendor (CA's golden set); who records customer loans (Phase 4 §12); the TC1 Windows job's first run; the axe title wait (`fix/axe-title-wait`).
