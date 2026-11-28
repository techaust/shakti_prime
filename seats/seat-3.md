seat: 3
max_agents: 5
updated: 28-11-2026 11:30 UTC
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 6
role: build
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: none
done_when: report: h3-stock-counts early check
note: Tier A; stop at the early check.

lane: 26
role: build
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: none
done_when: report: r3-warranty early check
note: replaces lane 7: the lead answered your blocked report (option (a)) at the end of the Report section; build what is not affected now, the ledger steps after X4 merges.

lane: 20
role: build
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: none
done_when: report: j3-documents early check
note: Tier A; stop at the early check.

lane: 29
role: build
branch: feat/tc2-tally-ingest
run_file: docs/runs/phase5/tc2-tally-ingest.md
wait_for: none
done_when: report: tc2-tally-ingest early check
note: Tier A; stop at the early check.

lane: 31
role: review
branch: feat/fn1-proformas
run_file: docs/runs/phase5/fn1-proformas.md
wait_for: report: fn1-proformas done
done_when: review: fn1-proformas done
note: Tier A

lane: 36
role: review
branch: fix/demo-data-ist-day
run_file: docs/runs/phase3/demo-data-ist-day.md
wait_for: report: demo-data-ist-day done
done_when: review: demo-data-ist-day done
note: Tier C

lane: 40
role: build
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: none
done_when: report: hr1-people early check
note: Tier B; stop at the early check. Moved from seat 4 (weekly pacing).

lane: 42
role: build
branch: fix/calling-hours-clock
run_file: docs/runs/phase3/calling-hours-clock.md
wait_for: none
done_when: report: calling-hours-clock done
note: moved from seat 2 (lane 5 made no commit in an hour). A fix: no early check. Commit every 20 minutes even while reproducing; now (after 20:30 IST) is inside the failing window, so reproduce first.

lane: 68
role: build
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: none
done_when: report: r3-warranty done
note: continue. The lead read the early check (27-11 20:05 UTC): accepted, its assumptions included. Take main in now (X4 merged, #298; Q1 may merge soon: take main again if it has), renumber after main's last, and open your three reasons with grant and move rows per X4's comment block (and reversal rows keyed by your reasons where a reversal applies). Settlement by a supplier replacement waits for U2's receipt: if U2 has not merged, leave it and name it. Keep app.next_document_no() carrying every kind main has.

lane: 69
role: build
branch: feat/tc2-tally-ingest
run_file: docs/runs/phase5/tc2-tally-ingest.md
wait_for: none
done_when: report: tc2-tally-ingest done
note: continue. The lead read the early check (27-11 20:10 UTC): accepted with two changes. (1) The signing key: store the connector key itself sealed with the app's field encryption (apps/web/src/crypto; KMS on hosted, as bank_json is), never a hash used as the HMAC key; the connector signs with the key as shown (TC1 unchanged); rotation keeps two sealed keys. (2) Snapshots in parts: accept snapshotId plus part n of m (each under the 4.5 MB function limit), keep parts until the last, diff then; an incomplete snapshot older than a day is dropped. The connector side is TC4's (the lead notes it). Then addendum 2 (refused rows, tallyLastAlterId, heldRows), the admin screens, Integration health, the silence alert. finance.read merges with FN1's at integration.

lane: 100
role: build
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: none
done_when: report: hr1-people done
note: continue. The lead read the early check (27-11 20:55 UTC): accepted, assumptions 1 to 12 included. Go on to the screens (/hr/people, the person's page, /hr/leave, the HR settings), the menu and the journeys. (moved from seat 2 at 04:45 UTC on 28-11: no commit for two hours; go on from the branch as pushed, the wip commits included)

lane: 102
role: prep
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects prepped after j2
note: a second prep: main moved (J2 #300 merged with migrations 0243 to 0246 and widened notifications_type_check, notification_preferences_type_check and app.order_loan_gate()). Take main in again as the prep prompt says; J1's migrations move after 0246 with journal times after main's. J1 redefines app.status_summary(), app.next_document_no(), app.platform_only_permissions(), notifications_subject_type_check and the notification checks: each must carry every line of main's latest plus J1's own. Add a second "Integration prep" entry, and commit with the subject "report: j1-projects prepped after j2" (not "prepped").

lane: 105
role: fix
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: docs(runs): hr1-people, the lead's triage of the review
done_when: report: hr1-people fixes
note: the one fix round: findings 1 to 6 as the lead's triage at the end of the Review section says. Do not take main in (the prep does).

lane: 107
role: prep
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: report: hr1-people fixes
done_when: report: hr1-people prepped
note: the lead read the fix round's diff and accepted it. main now holds J2 (0243 to 0246), TC1, the axe title wait and the calling-hours fix. HR1's migrations move after main's last (0246; F1, J1 and TC2 also wait with 0247 onward, and whoever merges later renumbers again). HR1 redefines none of the shared definers: confirm it against main's latest, and grep the shared lists for a key used twice.

lane: 109
role: prep
branch: feat/fn1-proformas
run_file: docs/runs/phase5/fn1-proformas.md
wait_for: none
done_when: report: fn1-proformas prepped
note: the re-check passed. main holds J2 (0243 to 0246: app.order_loan_gate(), customer_loans, the loan events), TC1, the axe title wait and the calling-hours fix. Besides the prep prompt, do the three integration items of the lead's notes in the run file: (1) redefine app.order_loan_gate() from J2's latest on main, with finance.milestones.process:all answering as well, every other line of J2's kept; (2) add review finding 4's three worker-registry lines for J2's loan events; (3) add a test that a milestone is held while J2's real loan gate holds the order. FN1's migrations move after 0246 (F1, J1, TC2, HR1 and H2 also wait with 0247 onward). Check app.platform_only_permissions(), app.next_document_no() and document_sequences_doc_type_check against main's latest.

lane: 115
role: prep
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: none
done_when: report: hr1-people prepped after j1
note: a full prep after J1 (#307, migrations 0253 to 0259) and F1 (#306, 0247 to 0252): take main in again as the prep prompt says, migrations after 0259 (others wait with 0247 onward: whoever merges later renumbers again), every integrate.sh part, then the journeys and the Linux baselines per project (the readme's prep prompt, owner 28-11-2026). HR1 redefines no shared definer; confirm it against main. Commit with the subject "report: hr1-people prepped after j1".

lane: 116
role: build
branch: feat/j6-qc-costs
run_file: docs/runs/phase4/j6-qc-costs.md
wait_for: docs(runs): j6-qc-costs brief
done_when: report: j6-qc-costs early check
note: none
