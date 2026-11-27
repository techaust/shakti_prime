seat: 3
max_agents: 5
updated: 2026-11-27T15:13Z
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

lane: 12
role: review
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: report: u2-purchase-orders done
done_when: review: u2-purchase-orders done
note: Tier A. Attack rate isolation on every table, DTO, PDF, event and audit value; approval limits and self-approval; serial completeness at receipt; the moving average.

lane: 20
role: build
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: none
done_when: report: j3-documents early check
note: Tier A; stop at the early check.

lane: 23
role: review
branch: feat/j2-loans
run_file: docs/runs/phase4/j2-loans.md
wait_for: report: j2-loans done
done_when: review: j2-loans done
note: Tier A

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

lane: 41
role: review
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: report: tc1-tally-connector done
done_when: review: tc1-tally-connector done
note: Tier A. Attack key handling, read-only requests to Tally, idempotent resend, the outbox across a kill.

lane: 42
role: build
branch: fix/calling-hours-clock
run_file: docs/runs/phase3/calling-hours-clock.md
wait_for: none
done_when: report: calling-hours-clock done
note: moved from seat 2 (lane 5 made no commit in an hour). A fix: no early check. Commit every 20 minutes even while reproducing; now (after 20:30 IST) is inside the failing window, so reproduce first.
