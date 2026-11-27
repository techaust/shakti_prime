seat: 4
max_agents: 3
updated: 2026-11-27T14:13Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 8
role: build
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: none
done_when: report: q1-labels early check
note: Tier B; stop at the early check.

lane: 9
role: review
branch: feat/x4-stock-reasons
run_file: docs/runs/phase3/x4-stock-reasons.md
wait_for: report: x4-stock-reasons done
done_when: review: x4-stock-reasons done
note: Tier A. Confirm the redefinition of app.stock_move() differs from migration 0231 only in the reason mapping; run H1's ledger suite.

lane: 10
role: review
branch: fix/demo-data-ist-day
run_file: docs/runs/phase3/demo-data-ist-day.md
wait_for: report: demo-data-ist-day done
done_when: review: demo-data-ist-day done
note: Tier C

lane: 14
role: review
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: report: h3-stock-counts done
done_when: review: h3-stock-counts done
note: Tier A. Attack blind counting: the expected quantity by any path.

lane: 15
role: review
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: report: r3-warranty done
done_when: review: r3-warranty done
note: Tier A. Attack cost columns per role, serial state and bin in step, IST warranty dates.
