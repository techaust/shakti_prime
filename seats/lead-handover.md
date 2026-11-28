# Lead handover (the lead writes this; seats ignore it)

Updated 28-11-2026 12:20 UTC by the lead of day 1 (the conversation was replaced here). Read this with `docs/10-status.md` and `docs/11-decisions.md` on `main` before acting. Everything below is pushed; nothing runs in the lead's VM.

## Merged on 28-11 (all CI-green on `main`; hosted steps done)
- **#300 J2 customer loans:** migrations 0243 to 0246.
- **#303 TC1 Tally connector, #304 the axe title wait, #305 the calling-hours fix:** no migrations.
- **#306 F1 field app foundation:** migrations 0247 to 0252. The first native Android build failed on AGP 9 (`BuildConfig` in WatermelonDB). It was fixed by the config plugin `apps/field/plugins/with-watermelondb-build-config.js`, after which the Android job passed.
- **#307 J1 projects:** migrations 0253 to 0259.
- **Dev and staging:** migrated through 0259, `db:verify` passed, `/api/v1/health` and `/health/ready` 200 on both (12:10 UTC).
- No pull request is open.

## Owner decisions today (record in DECISIONS at end-session, with the documents PR)
- H3's question A (b): a counting-only permission `inventory.count.record` for the Store Manager, the Inventory Manager and the Executive. Question B (a): restrictive policies hide a live count's bins from holders of `inventory.count.record` without `inventory.stock.adjust`; nobody else is affected.
- "seats baselines: yes": seats' preps also run the whole journey set and make the Linux baselines. This amends the approved plan's §6 "seats do no browser work". The readme on `ops/seats` carries the prompt.
- Lead (engineering): the waiting-for-integration limit rises from 6 to 10 while seats run full preps.

## Seats now (`seats/seat-<n>.md`; check each branch's tip)
- **Seat 1** (max 2, weekly above its line): reviews only. Nothing active; give it the early-check reviews of J5, J6 and F2 (it built none of them).
- **Seat 2** (max 5): lane 119, the full prep of FN1 after J1; lane 120, the J5 build.
- **Seat 3** (max 5): lane 115, the full prep of HR1 after J1; lane 116, the J6 build.
- **Seat 4** (max 2): lane 117, the full prep of H2 after J1; lane 118, the F2 build. F2 had not started by 12:20, probably held by max 2 while the prep runs. If seat 4 has not committed on `feat/f2-sync` by 13:15 UTC, move F2 to seat 3 (a new lane id).
- The next lane id is **121**.
- A full prep ends with `report: <slug> prepped after j1`, the journeys run and the baselines committed. The lead then takes `main` again if it moved, renumbers, reruns what the change touches, and opens the pull request. When `js-budget.json` or another checks file changes, the owner adds `checks-ok`; a push that changes a checks file again takes the label off, so ask for it again.

## Integration queue, in order (each built, reviewed, fixed; all migrations renumber after 0259)
1. **HR1:** full prep running (lane 115). Needs `checks-ok` (`js-budget.json`).
2. **H2:** full prep running (lane 117). C1 from H3's re-check: whichever of H2 and H3 merges second makes H2's `app.line_availability()` blind for a holder of `inventory.count.record` without adjust while a live count covers the item, with one test.
3. **FN1:** full prep running (lane 119). It carries J2's three items: `app.order_loan_gate()` with `finance.milestones.process:all`, the loan events' worker lines, and the loan-held test.
4. **R3:** prepped before J1. Needs a full prep. R3's audit field is `claimRejectedReason`.
5. **TC2:** prepped before J1 (lane 104) after the lead's fix (`connector_refused` is a typed review reason). Needs a full prep.
6. **U2:** prepped before J1 (lane 111). Needs a full prep.
7. **J3:** fix round accepted. Its prep must add the foreign key to `projects` and `app.project_missing_documents()` over J3's definer (J1's stub on `main`), and write `app.file_purpose_grant()` from `main`'s latest (0242 `label_sheet`) plus `customer_document`.
8. **H3:** owner answers built and re-checked sound, addendum fixes done (lane 114). Needs a full prep, plus C1 if H2 merged first.
- **Wave 2, briefed and building:** J5 (`feat/j5-scheduling`), J6 (`feat/j6-qc-costs`), F2 (`feat/f2-sync`). Each stops at its early check: read it, write "continue" lanes, then reviews on another seat.
- **Briefs ready in the lead's scratchpad, to branch when their needs merge:** J4 (needs J3), TC3 (needs TC2 and FN1), FN3 (needs FN1), FN4 (needs TC2). The texts are in the previous lead's scratchpad, which a new conversation cannot read. Rewrite them from phase4 §7.1 and phase5 §7.1 to §7.3, settling the same points: J4 with questions 3 and 5; FN3 as platform-only `finance.reminders.process`, once a day, no reminder for a loan-held milestone, UPI link and QR; FN4 as `stock_valuation_checks` behind `finance.cost.read`; TC3 as the matcher by question 5, payments append-only, tombstones reversing, dealer outstanding by question 11.

## How a merge goes (the lessons of today)
- After a slice's PR is green and labelled, start a look: `gh api -X POST repos/techaust/shakti_prime/actions/workflows/automerge.yml/dispatches -f ref=main -f 'inputs[pull_request]=N'`. A held `pull_request` run (`action_required`) after the workflow took `main` in: `POST /actions/runs/{id}/rerun`, then a look again.
- After a merge, the merge workflow starts CI on `main` itself. When it is green, migrate dev and staging (`migrate.yml` with `environment` and `seed=true`) and curl both health routes.
- **Two open PRs with migrations from the same number:** put `hold` on the second until the first merges. Then take `main` in, renumber, regenerate `docs/data` after any citation edit, rerun the parts, take `hold` off, and ask for `checks-ok` again if a checks file changed.
- Use no `| tail -1` after a check in an `&&` chain (it hides failures; it let two bad commits through today).
- After a container restart, remove `~/.shakti-heavy.lock` (the stopped run cannot), restart stopped Postgres containers, and resume the interrupted run.

## The watch list at every merge (shared definers and checks; carry every line of `main`'s latest)
`notifications_type_check` and `notification_preferences_type_check` (J2 `loan_rejected`, J1 `project_order_cancelled` on `main`; H2 adds one); `notifications_subject_type_check` (J1 `project`); `app.next_document_no()` and `document_sequences_doc_type_check` (J1 `project` on `main`; R3, U2, FN1, H3 add); `app.platform_only_permissions()` (J1 `projects.draft` on `main`; H2, U2, FN1, TC2 add); `app.file_purpose_grant()` and `files_purpose_check` (Q1 on `main`; J3, U2, J6 add); `roles_key_check` (TC2); `app.status_summary()` (J1 on `main`); `app.order_loan_gate()` (J2 on `main`; FN1 adds); `app.stock_move()` (X4 on `main`; H2 adds one rule).

## Usage pacing (weekly resets, UTC)
Lead Thu 07:00 · seat 1 Thu 10:00 · seat 2 Mon 15:00 · seat 3 Tue 16:00 · seat 4 Fri 05:00. The weekly line is 100 % × hours since reset ÷ 168, plus 5. Above the line, drop an agent; more than 10 under, up to 5.
Last reading 28-11 09:00 UTC: lead 5h 5 wk 9 · seat 1 5h 4 wk 29 · seat 2 5h 10 wk 30 · seat 3 5h 0 wk 37 · seat 4 5h 9 wk 17. A reading over 5 hours old allows at most 2 agents per account: ask the owner for one.

## Follow-ups to record in STATUS at end-session
- **Inventory:** H1 hub pairing (MAX_PARAMETERS past ~60 hubs); H1 stock card cursor drops microseconds.
- **Test data:** catalogueFixture against demo data price lists on a fresh database; the outbox backlog on aged local databases.
- **Tally:** TC4 sends snapshots in parts; TC2's per-connector cap is counted before the signature (SR1).
- **Field app:** F1's key pair required in productionConfigProblems before F5; F1's Sentry React Native package needs the owner's yes; the F1 phones picture's masks show over the panel (scope snap to the dialog).
- **Projects and documents:** J5 writes unavailability on `hr.leave.approved`; who records customer loans (Phase 4 §12); J3 L5 (unfiled customer uploads) and L6 (tesseract.js traced files); `app.file_is_sensitive` has no company filter; the J1 home cards' missing full stops.
- **Purchasing and HR:** U2 tax on a purchase from an unregistered vendor (CA's golden set); HR1 finding 7 (leave for a person with no sign-in, cancelling approved leave: HR-2).
- **Process:** the JavaScript budget creep from menu entries (each merge raises shared pages; load the menu lazily or budget the shell once).
