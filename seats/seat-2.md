seat: 2
max_agents: 5
updated: 2026-11-27T22:25Z
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 4
role: build
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders early check
note: Tier A; stop at the early check.

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

lane: 35
role: review
branch: feat/x4-stock-reasons
run_file: docs/runs/phase3/x4-stock-reasons.md
wait_for: report: x4-stock-reasons done
done_when: review: x4-stock-reasons done
note: Tier A. Confirm the redefinition of app.stock_move() differs from migration 0231 only in the brief's points (the grant mapping, the serial moves, the line's customer fields, and addendum 2's reversible flag; mark addendum 2 a finding if missing); run H1's ledger suite.

lane: 37
role: review
branch: feat/h3-stock-counts
run_file: docs/runs/phase3/h3-stock-counts.md
wait_for: report: h3-stock-counts done
done_when: review: h3-stock-counts done
note: Tier A. Attack blind counting: the expected quantity by any path.

lane: 38
role: review
branch: feat/r3-warranty
run_file: docs/runs/phase3/r3-warranty.md
wait_for: report: r3-warranty done
done_when: review: r3-warranty done
note: Tier A. Attack cost columns per role, serial state and bin in step, IST warranty dates.

lane: 39
role: review
branch: feat/j3-documents
run_file: docs/runs/phase4/j3-documents.md
wait_for: report: j3-documents done
done_when: review: j3-documents done
note: Tier A. Attack identity digits surviving anywhere (storage, rows, audit, logs, Sentry, model payloads), sensitive rows by grant, filing against another customer.

lane: 45
role: build
branch: feat/j2-loans
run_file: docs/runs/phase4/j2-loans.md
wait_for: none
done_when: report: j2-loans done
note: continue. The lead read the early check (27-11 15:45 UTC): accepted, decisions 1 to 7 included. The journey uses a General Manager (Accounts holds no crm.account.write; who records loans is a question for the client, the lead records it). Build notify_owner on rejection in this lane (notice type, worker, sentence). Then the screens, the module documents and EXPLAIN on seeded volume.

lane: 46
role: build
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders done
note: continue. The lead read the early check (27-11 15:50 UTC): accepted, the seven-table design and the decisions included. Receipt reversal: X4 gains a reversible flag per reason (its addendum 2); your opening migration also sets receipt's reversible true. Build the screens, the PDF and the scan field now; take main in and add the opening once X4 has merged; if X4 has not merged when only that remains, report done with it named, and the lead adds it at integration.

lane: 47
role: build
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: none
done_when: report: tc1-tally-connector done
note: continue. The lead read the early check (27-11 16:10 UTC): accepted, assumptions 1 to 13 and 16 included; the spike script may import the reader by path. Now (a) add an optional ledgerBalances list (party ledger GUID, name, closing balance, as of) to the snapshot contract in packages/contracts/src/api/connector.ts and send the Sundry Debtors closing balances with each daily snapshot (dealer outstanding, your point 3); (b) the lead added esbuild as a dev dependency: drop the eslint-disable and import it normally (point 14); (c) add the fence block for apps/tally-connector to eslint.config.mjs like apps/voice-agent's (point 15, a checks change the owner labels). Then the final checks and report done.

lane: 54
role: review
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: report: f1-field-foundation fixes
done_when: review: f1-field-foundation re-check done
note: re-check of the fix diff only (the review found a critical): confirm findings 1, 2, 3, 5 to 8 fixed with tests, and the packages wired with no token, phone or identity number reaching Sentry. Commit the result as review: f1-field-foundation re-check done.

lane: 59
role: review
branch: feat/h2-reservations
run_file: docs/runs/phase3/h2-reservations.md
wait_for: report: h2-reservations fixes
done_when: review: h2-reservations re-check done
note: re-check of the fix diff only (the review found a high): confirm the nine fixes with their tests, especially the lock order (1) and the lapse (2); commit review: h2-reservations re-check done.

lane: 62
role: fix
branch: feat/j2-loans
run_file: docs/runs/phase4/j2-loans.md
wait_for: none
done_when: report: j2-loans fixes
note: the one fix round: M1, L1, L2, L3, L5, L6, L7 as the lead's triage at the end of the Review section says.

lane: 63
role: fix
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders fixes
note: the one fix round, as the lead's triage at the end of the Review section says. X4 merged (#298, main bdf82df4): take main in first (a merge commit; your migrations move after 0240 with journal times after main's; node tools/integration/renumber-migrations.mjs origin/main <your pre-merge sha> after pnpm install), then the receipt opening per addendum 2 and X4's final comment block.

lane: 65
role: fix
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: none
done_when: report: tc1-tally-connector fixes
note: the one fix round: all ten findings as the lead's triage at the end of the Review section says. Finding 1 (high) first.

lane: 73
role: fix
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: none
done_when: report: tc1-tally-connector fixes 2
note: a short second round for the re-check's findings 11 and 12, as the lead's triage at the end of the Review section says; report as report: tc1-tally-connector fixes 2.

lane: 75
role: prep
branch: feat/tc1-tally-connector
run_file: docs/runs/phase5/tc1-tally-connector.md
wait_for: none
done_when: report: tc1-tally-connector prepped
note: prep for the lead's integration (owner, 27-11-2026): readme's prep prompt. TC1 has no migration; take main in, run every integrate.sh part but e2e, and the connector workspace's own tests.

lane: 76
role: prep
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects prepped
note: prep for the lead's integration: readme's prep prompt (one prep at a time on this seat: it starts after TC1's). Diff against main's latest: app.platform_only_permissions(), app.next_document_no(), notifications_type_check and notification_preferences_type_check, app.status_summary(), document_sequences_doc_type_check.

lane: 83
role: fix
branch: feat/u2-purchase-orders
run_file: docs/runs/phase3/u2-purchase-orders.md
wait_for: none
done_when: report: u2-purchase-orders fixes 2
note: a second round for the re-check's R1, R2, R3, R4, R5, R7, R8 as the lead's triage at the end of the Review section says (R2: the PDF through the render worker). Report as report: u2-purchase-orders fixes 2.
