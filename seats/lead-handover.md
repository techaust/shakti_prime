# Lead handover (the lead writes this; seats ignore it)

Updated 28-11-2026 00:10 UTC by the lead of day 1. Read this with `docs/10-status.md` (on `main` after #301) before acting.

## Pull requests
- **#300 J2 customer loans:** integrated; CI green. Waits for the owner's `checks-ok` (`js-budget.json`: `/settings/lenders` 203 kB, `/catalogue` 245 → 246). After the label, start a merge look by hand: `gh api -X POST repos/techaust/shakti_prime/actions/workflows/automerge.yml/dispatches -f ref=main -f 'inputs[pull_request]=300'`. Migrations 0243 to 0246, then `migrate-hosted`.
- **#302 X1 demo-data test:** merged (held run re-run by hand, then a look started).
- **#303 TC1 Tally connector:** integrated; waits for `checks-ok` (Windows job, ESLint fence, the connector's scripts). No migration. Read the first Windows run.

## Integration queue, in order
1. **F1:** prepped by seat 4 on X4. Take `main` after J2, renumber after J2's 0246, rerun the security, `db:verify` and generated parts, then the whole Linux journey set per project (update, then verify) and the pull request. It needs `checks-ok`: `ci.yml` (native Android build job), `turbo.json`, `pnpm-workspace.yaml`, copy-lint config. Read the first native build: if WatermelonDB 0.28.0 fails on React Native 0.88, that is the owner's decision (ADR 0012).
2. **J1:** seat 2's prep is running after a Prettier fix by the lead. Its migrations collide with J2's: renumber after J2. `status_summary`, `next_document_no`, `platform_only_permissions` and the notification checks need the diff against `main`'s latest.
3. **H2:** second fix round done (the shared pool). Its `app.stock_move()` rule must sit on X4's body: check the branch took `main` with X4 and diff the function against 0240.
4. **U2:** second round running (seat 2); then re-check 2 (seat 1). R2 moves the PDF to the render worker.
5. **R3:** fix round (seat 3), then re-check (seat 1).
6. **The calling-hours fix:** fix round (seat 3); the lead reads the diff.
7. **U2:** re-check 2 passed; seat 1 preps it after H2's prep.
8. **FN1:** re-check passed. At integration, after J2 merges:
   - redefine `app.order_loan_gate()` from J2's latest, with `finance.milestones.process:all` answering;
   - add finding 4's three worker-registry lines for J2's loan events;
   - add a loan-held test on J2's real definer.
9. **TC2:** fix round (seat 3); the lead reads the diff. M4 (snapshots in parts) is TC4's.
10. **H3, J3, HR1:** building (see each run file).

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
- The Linux image's whole journey set per project, before a pull request, whenever a slice adds seed rows or a menu entry.
- `copy-lint.config.json` is not a checks file; `js-budget.json` is.
- `wait.sh`'s `has_subject` had a pipefail bug (fixed).
- Seats must never end their turn (readme).
- Seat 3 hit its 5-hour limit at five agents, so it runs at three.

## Usage pacing (weekly resets, UTC)
Lead Thu 07:00 · seat 1 Thu 10:00 · seat 2 Mon 15:00 · seat 3 Tue 16:00 · seat 4 Fri 05:00. The last reading was at 17:10 UTC. `max_agents`: seat 1 5, seat 2 5, seat 3 3, seat 4 2.
