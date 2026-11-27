seat: 2
max_agents: 3
updated: 2026-11-27T14:13Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 4
role: build
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders early check
note: Tier A; stop at the early check.

lane: 5
role: build
branch: fix/calling-hours-clock
run_file: docs/runs/phase3/calling-hours-clock.md
wait_for: none
done_when: report: calling-hours-clock done
note: a fix: no early check; report done.

lane: 11
role: review
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: report: h2-reservations done
done_when: review: h2-reservations done
note: Tier A. Attack the definers' lock order, oversell under concurrent confirmation, a count leaking to a Lead Converter (DTO, route, event, notification), and the stock_move redefinition against main's latest.
