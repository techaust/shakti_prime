seat: 3
max_agents: 3
updated: 2026-11-27T14:29Z
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

lane: 16
role: review
branch: fix/calling-hours-clock
run_file: docs/runs/phase3/calling-hours-clock.md
wait_for: report: calling-hours-clock done
done_when: review: calling-hours-clock done
note: Tier B

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
