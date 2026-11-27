seat: 2
max_agents: 3
updated: 2026-11-27T14:34Z
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

lane: 19
role: build
branch: feat/j2-loans
run_file: docs/runs/phase4/j2-loans.md
wait_for: none
done_when: report: j2-loans early check
note: Tier A; stop at the early check.

lane: 22
role: review
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: report: f1-field-foundation done
done_when: review: f1-field-foundation done
note: Tier A. Attack token rotation and reuse under concurrency, tokens in logs or Sentry, the version gate, and the mobile bearer's request context.

lane: 28
role: build
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: none
done_when: report: tc1-tally-connector early check
note: Tier A; stop at the early check. The owner approved postject and WinSW: see the brief addendum; install nothing yourself.

lane: 34
role: review
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: report: hr1-people done
done_when: review: hr1-people done
note: Tier B
