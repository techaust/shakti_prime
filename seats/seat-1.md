seat: 1
max_agents: 3
updated: 2026-11-27T14:13Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 1
role: build
branch: feat/x4-stock-reasons
run_file: docs/runs/phase3/x4-stock-reasons.md
wait_for: none
done_when: report: x4-stock-reasons done
note: first priority: U2 and R3 open their ledger reasons through this registry. Tier A but no early check: the slice is the schema change; report done.

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
