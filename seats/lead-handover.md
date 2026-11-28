# Lead handover (the lead writes this; seats ignore it)

Updated 28-11-2026 08:05 UTC by the lead of day 1. Read this with `docs/10-status.md` (on `main` after #301) before acting.

## Pull requests and hosted environments
- **Merged today (28-11):**
  - #300 J2: migrations 0243 to 0246; dev and staging migrated, `db:verify` passed, health 200.
  - #303 TC1: no migration.
  - #304, the axe title wait: no migration.
  - #305, the calling-hours fix: no migration.
  - CI on `main` was green after each one.
- **#306 F1** (integrated; migrations 0247 to 0252): waits for the owner's `checks-ok` (`ci.yml` Android job, `turbo.json`, `pnpm-workspace.yaml`, `apps/field/package.json`, `js-budget.json`). After the label, start a look by hand (`automerge.yml` dispatch with `inputs[pull_request]=306`). Then read the first "Field app native build" job; a WatermelonDB failure on React Native 0.88 is the owner's decision (ADR 0012). Then migrate dev and staging.
- **#307 J1** (integrated; migrations 0247 to 0253 for now): labelled `hold` by the lead and waiting for `checks-ok` (`js-budget.json`). When F1 merges:
  - take `main` into `feat/j1-projects` (slot worktree `/home/user/shakti-wt/j1-projects`, 54335 and 3035);
  - renumber after 0252 (`renumber-migrations.mjs origin/main <premerge>`), then check `db:generate`, the redefinitions (watch list) and `db:docs`;
  - rerun `security dbverify`, plus `unit` and `jsbudget`;
  - the journeys only if F1 changed a shared picture (F1 changed `roles`);
  - push, take `hold` off, and start a look.

## Integration queue after F1 and J1, in order (each needs the lead's journeys and baselines on `main` after J1, because J1's menu entries change most pictures)
1. **HR1:** prepped (lane 107), migrations 0247 to 0249 for now; `js-budget.json` raised.
2. **H2:** second prep done (lane 108).
3. **FN1:** prepped (lane 109) with the three J2 items (`app.order_loan_gate()` with `finance.milestones.process:all`, the loan events' worker lines, the loan-held test). Budgets `/admin/integrations` 242 and `/calling` 208.
4. **R3:** prepped (lane 110) after a Prettier fix by the lead. R3's audit field is `claimRejectedReason` (it clashed with J2's `rejectedReason`).
5. **TC2:** prep restarted (lane 104) after the lead's fix (`connector_refused` is a typed review reason). The lead read the fix round and accepted it. Low follow-up for SR1: the per-connector cap is counted before the signature.
6. **U2:** prepped before J2; needs a new prep.
7. **J3:** fix round accepted by the lead. Integrate after J1 (foreign key to projects, `app.project_missing_documents()` over its definer) and write `app.file_purpose_grant()` from `main`'s 0242 (H2 at the merge). Needs a prep.
8. **H3:** fix round accepted. Waits for the owner's questions A (who counts: Store Manager with `inventory.stock.move`, or a counting-only permission; recommended the latter) and B (hide balances of bins under a live count from non-adjust holders; recommended). The answer comes as a small change of its own, then the prep.
- **No new builds:** the queue is past the limit of 6 built and waiting. Spare seat time goes to preps.

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
Also from 28-11 morning: J3 L5 (unfiled customer uploads) and L6 (tesseract.js traced files); `app.file_is_sensitive` has no company filter; HR1 finding 7 (leave for a person with no sign-in, cancelling approved leave; HR-2); the F1 phones picture's masks over the panel; the J1 home cards' missing full stops; the JavaScript budget creep from menu entries (each merge raises shared pages); the container restarts (the lead clears `~/.shakti-heavy.lock` after one, because the stopped run cannot).
H1 hub pairing (MAX_PARAMETERS past ~60 hubs); H1 stock card cursor drops microseconds; catalogueFixture vs demo data price lists on a fresh database; the outbox backlog on aged local databases; TC4 sends snapshots in parts; F1's key pair required in productionConfigProblems before F5; F1's Sentry React Native package needs the owner's yes; J5 writes unavailability on hr.leave.approved; U2 tax on a purchase from an unregistered vendor (CA's golden set); who records customer loans (Phase 4 §12); the TC1 Windows job's first run; the axe title wait (`fix/axe-title-wait`).
