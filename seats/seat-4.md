seat: 4
max_agents: 2
updated: 28-11-2026 05:00 UTC
note: protocol v2 (seats/readme.md); the seven-day push, 27-11 to 03-12-2026. Start lanes in the order listed.

lane: 8
role: build
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: none
done_when: report: q1-labels early check
note: Tier B; stop at the early check.

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

lane: 44
role: build
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: none
done_when: report: q1-labels done
note: continue. The lead read the early check (27-11 15:30 UTC): accepted as built, assumptions 1 to 6 included. Go on to the Print labels actions, the reprint dialog and the journey; wire the receipt only if U2 has merged. Keep app.file_purpose_grant() as one redefinition carrying main's latest lines.

lane: 48
role: build
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation done
note: continue. The lead read the early check (27-11 16:20 UTC): accepted, every decision except one. A lost answer to a refresh must not sign the phone out (an offline field app on weak networks): keep the previous hash and its rotation time on the row; the same previous token presented within 120 seconds of its rotation answers the pair that rotation issued (store it encrypted or re-issue an equivalent pair tied to the same new hash, your call, stated in the report); after 120 seconds it is reuse as now. Test it (a lost answer, then the retry; the retry after 121 s ends the family). Then apps/field, the native build CI job, the phones screen and its journey. Name the Sentry React Native package and its version in your report; do not add it.

lane: 49
role: build
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects done
note: continue. The lead read the early check (27-11 16:25 UTC): accepted, decisions 1 to 8 included. Go on to status_summary, the screens, the template editor and the journeys. Take EXPLAIN of the projects list as a Field Engineer at volume (app.project_is_mine per row) and record it.

lane: 53
role: fix
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation fixes
note: the one fix round, as the lead's triage under the Review table says (findings 1, 2, 3, 5, 6, 7, 8 and the six packages the lead installed). Finding 1 is critical: first.

lane: 60
role: fix
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation fixes 2
note: a short second round for the re-check's findings 9 and 11, as the lead's triage at the end of the Review section says; report as report: f1-field-foundation fixes 2.

lane: 61
role: fix
branch: feat/q1-labels
run_file: docs/runs/phase3/q1-labels.md
wait_for: none
done_when: report: q1-labels fixes
note: the one fix round: M1, M2, L1 to L4 as the lead's triage at the end of the Review section says.

lane: 67
role: fix
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects fixes
note: the one fix round: all nine findings as the lead's triage at the end of the Review section says.

lane: 74
role: prep
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation prepped
note: prep for the lead's integration (owner, 27-11-2026): readme's prep prompt. main has X4 (0240) and may have Q1 (0241, 0242) by the time you start: take the latest. Watch the shared definers and checks the lead lists: app.platform_only_permissions(), notifications_type_check, app.file_purpose_grant(); diff each against main's latest.

lane: 90
role: prep
branch: feat/j1-projects
run_file: docs/runs/phase4/j1-projects.md
wait_for: none
done_when: report: j1-projects prepped
note: prep for the lead's integration: readme's prep prompt (moved from seat 2: no commit for three hours after the lead's Prettier fix at 21:43). Diff against main's latest: app.platform_only_permissions(), app.next_document_no(), notifications_type_check and notification_preferences_type_check, app.status_summary(), document_sequences_doc_type_check.

lane: 101
role: prep
branch: feat/f1-field-foundation
run_file: docs/runs/phase4/f1-field-foundation.md
wait_for: none
done_when: report: f1-field-foundation prepped after j2
note: a second prep: main moved (J2 #300 merged with migrations 0243 to 0246, then possibly TC1 #303 and the calling-hours fix). Take main in again as the prep prompt says; F1's migrations move after main's last one with journal times after main's. Diff app.platform_only_permissions(), the notification checks and anything else F1 redefines against main's latest. Add a second "Integration prep" entry, and commit with the subject "report: f1-field-foundation prepped after j2" (not "prepped").
