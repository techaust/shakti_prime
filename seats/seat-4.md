seat: 4
max_agents: 3
updated: 2026-11-27T14:34Z
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

lane: 17
role: build
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects early check
note: Tier A; stop at the early check.

lane: 18
role: build
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation early check
note: Tier A; stop at the early check. The packages are installed by the lead; install nothing.

lane: 24
role: review
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: report: j3-documents done
done_when: review: j3-documents done
note: Tier A. Attack identity digits surviving anywhere (storage, rows, audit, logs, Sentry, model payloads), sensitive rows by grant, filing against another customer.

lane: 30
role: build
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: none
done_when: report: hr1-people early check
note: Tier B; stop at the early check.

lane: 32
role: review
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: report: tc1-tally-connector done
done_when: review: tc1-tally-connector done
note: Tier A. Attack key handling, read-only requests to Tally, idempotent resend, the outbox across a kill.
