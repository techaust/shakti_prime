seat: 3
max_agents: 3
updated: 2026-11-27T20:15Z
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

lane: 52
role: build
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: none
done_when: report: h3-stock-counts done
note: continue. The lead read the early check (27-11 17:05 UTC): accepted, decisions 1 to 7 included. Go on to the screens (list, the one-hand counting screen, the review), the count sheet and the journeys; a plain input for serials until U2's scan field merges.

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

lane: 72
role: build
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: none
done_when: report: j3-documents done
note: continue. The lead read the early check (27-11 20:35 UTC): accepted, assumptions included. Build the not-done list (actions, the Documents tab, Account 360's section, Settings, the journey, SECURITY and phase4 Built). J1 merges first: when it has, take main in and add the foreign key to projects and app.project_missing_documents() over your definer (your integration note).
