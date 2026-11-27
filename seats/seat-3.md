seat: 3
max_agents: 3
updated: 2026-11-27T14:13Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 6
role: build
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: none
done_when: report: h3-stock-counts early check
note: Tier A; stop at the early check.

lane: 7
role: build
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: none
done_when: report: r3-warranty early check
note: Tier A; stop at the early check.

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
