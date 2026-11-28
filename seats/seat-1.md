seat: 1
max_agents: 3
updated: 2026-11-28T03:49Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 51
role: fix
branch: feat/x4-stock-reasons
run_file: docs/runs/phase3/x4-stock-reasons.md
wait_for: none
done_when: report: x4-stock-reasons fixes
note: the one fix round: findings 1, 2 and 3 as the lead's triage under the Review table says. First priority on this seat: U2 and R3 wait on X4.

lane: 58
role: fix
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: none
done_when: report: h2-reservations fixes
note: the one fix round: all nine findings as the lead's triage under the Review table says. Finding 1 (high) first.

lane: 13
role: review
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: report: q1-labels done
done_when: review: q1-labels done
note: Tier B

lane: 55
role: review
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: report: u2-purchase-orders done
done_when: review: u2-purchase-orders done
note: Tier A. Attack rate isolation on every table, DTO, PDF, event and audit value; approval limits and self-approval; serial completeness at receipt; the moving average. (moved from seat 3)

lane: 56
role: review
branch: feat/j2-loans
run_file: docs/runs/phase4/j2-loans.md
wait_for: report: j2-loans done
done_when: review: j2-loans done
note: Tier A (moved from seat 3)

lane: 57
role: review
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: report: tc1-tally-connector done
done_when: review: tc1-tally-connector done
note: Tier A. Attack key handling, read-only requests to Tally, idempotent resend, the outbox across a kill. (moved from seat 3)

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

lane: 64
role: review
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: report: u2-purchase-orders fixes
done_when: review: u2-purchase-orders re-check done
note: re-check of the fix diff only (the review found a high): the receipt opening against X4's registry with the receipt and reversal tests on the real definer, and fixes 2 to 7, 9, 10 with tests.

lane: 66
role: review
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: report: tc1-tally-connector fixes
done_when: review: tc1-tally-connector re-check done
note: re-check of the fix diff only (the review found a high): findings 1 to 10 fixed with tests, especially the drain under a bad answer and the attempt limit.

lane: 70
role: build
branch: feat/fn1-proformas
run_file: docs/runs/phase5/fn1-proformas.md
wait_for: none
done_when: report: fn1-proformas done
note: continue. The lead read the early check (27-11 20:20 UTC): accepted, decisions 1 to 8 included. J2 merges first (tonight): when it has, take main in and redefine app.order_loan_gate() from J2's latest with finance.milestones.process:all answering (your integration note), and drop the stub. Then the screens, the PDF and the journeys.

lane: 71
role: fix
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: none
done_when: report: h2-reservations fixes 2
note: a short second round for the re-check's findings 10, 11 and 12, as the lead's triage at the end of the Review section says; report as report: h2-reservations fixes 2.

lane: 78
role: fix
branch: fix/demo-data-ist-day
run_file: docs/runs/phase3/demo-data-ist-day.md
wait_for: none
done_when: report: demo-data-ist-day fixes
note: the one fix round: the review's finding 1 (the same single-page read in packages/domain/tests/queries/catalogue-queries.test.ts:173; page through with the cursor as your fix does). Also take main in (a merge commit). Small.

lane: 80
role: prep
branch: fix/demo-data-ist-day
run_file: docs/runs/phase3/demo-data-ist-day.md
wait_for: none
done_when: report: demo-data-ist-day prepped
note: prep for the lead's integration: readme's prep prompt. A test-only slice with no migration: take main in and run every integrate.sh part but e2e.

lane: 82
role: review
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: report: r3-warranty fixes
done_when: review: r3-warranty re-check done
note: re-check of the fix diff only (the review found a high): findings 1 to 9 and 12 fixed with tests; the db unit tests pass.

lane: 84
role: review
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: report: u2-purchase-orders fixes 2
done_when: review: u2-purchase-orders re-check 2 done
note: re-check of the second round only: R1 (CI's unit job passes), R2 (no Chromium in a request route; the PDF and mail through the render worker; rates by grant), R3, R4, R5, R7, R8.

lane: 86
role: fix
branch: feat/fn1-proformas
run_file: docs/runs/phase5/fn1-proformas.md
wait_for: none
done_when: report: fn1-proformas fixes
note: the one fix round, as the lead's triage at the end of the Review section says: take main in first, then 1 and 2 (high), then 3 to 11.

lane: 88
role: prep
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: none
done_when: report: h2-reservations prepped
note: prep for the lead's integration: readme's prep prompt. Critical: H2's app.stock_move() redefinition must be X4's 0240 body (on main) plus H2's one rule; diff it against 0240 line by line and say so. Also diff app.platform_only_permissions() and the notification checks against main's latest.

lane: 89
role: prep
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders prepped
note: prep for the lead's integration: readme's prep prompt (after H2's: one prep at a time). Diff app.next_document_no(), document_sequences_doc_type_check, app.platform_only_permissions(), app.file_purpose_grant() and files_purpose_check against main's latest (Q1's label_sheet must stay).

lane: 97
role: review
branch: feat/hr1-people
run_file: docs/runs/phase5/hr1-people.md
wait_for: report: hr1-people done
done_when: review: hr1-people done
note: Tier B (moved from seat 3: no commit for two hours)

lane: 98
role: review
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: report: h3-stock-counts done
done_when: review: h3-stock-counts done
note: Tier A. Attack blind counting: the expected quantity by any path. (moved from seat 3: no commit for two hours)

lane: 99
role: review
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: report: j3-documents done
done_when: review: j3-documents done
note: Tier A. Attack identity digits surviving anywhere (storage, rows, audit, logs, Sentry, model payloads), sensitive rows by grant, filing against another customer. (moved from seat 3: no commit for two hours)
