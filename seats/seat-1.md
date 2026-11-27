seat: 1
max_agents: 3
updated: 2026-11-27T16:15Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 25
role: build
branch: feat/x4-stock-reasons
run_file: docs/runs/phase3/x4-stock-reasons.md
wait_for: none
done_when: report: x4-stock-reasons done
note: replaces lane 1: the brief has an addendum (serial moves as data, points 5 to 9); read the whole run file again. First priority. No early check.

lane: 2
role: build
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: none
done_when: report: h2-reservations early check
note: Tier A; stop at the early check. Includes taking inventory.stock.read off the Lead Converter (owner, 27-11-2026).

lane: 3
role: build
branch: fix/demo-data-ist-day
run_file: docs/runs/phase3/demo-data-ist-day.md
wait_for: none
done_when: report: demo-data-ist-day done
note: read the run file's last report first: the failure shows only after 18:30 UTC (00:00 IST). Prepare before then; run the whole web security suite (pnpm --filter web test:security) inside the window, keep the failing assertion's text, and fix what it names. Tier C, no early check.

lane: 13
role: review
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: report: q1-labels done
done_when: review: q1-labels done
note: Tier B

lane: 21
role: review
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: report: j1-projects done
done_when: review: j1-projects done
note: Tier A. Attack the own scope on every route, drafting idempotency, and status_summary against main's latest.

lane: 27
role: build
branch: feat/fn1-proformas
run_file: docs/runs/phase5/fn1-proformas.md
wait_for: none
done_when: report: fn1-proformas early check
note: Tier A; stop at the early check. Lower priority than the lanes above: start it after them.

lane: 33
role: review
branch: feat/tc2-tally-ingest
run_file: docs/runs/phase5/tc2-tally-ingest.md
wait_for: report: tc2-tally-ingest done
done_when: review: tc2-tally-ingest done
note: Tier A. Attack HMAC and replay, the connector principal's reach, purchase vouchers by grant.

lane: 43
role: review
branch: fix/calling-hours-clock
run_file: docs/runs/phase3/calling-hours-clock.md
wait_for: report: calling-hours-clock done
done_when: review: calling-hours-clock done
note: Tier B

lane: 50
role: build
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: none
done_when: report: h2-reservations done
note: continue. The lead read the early check (27-11 16:30 UTC): accepted, decisions 1 to 11 included (no is_default column; the PIN list then code order stands until the client answers). Build the unfinished list (workers, the cancel freeing stock to the fill, the hub PIN codes, the screens, journeys, EXPLAIN, the Built record). When X4 has merged, take main in and re-apply your one app.stock_move() rule onto X4's latest body (X4 moves the grant mapping and the serial block into tables); diff your redefinition against main's latest and say so in the report.
