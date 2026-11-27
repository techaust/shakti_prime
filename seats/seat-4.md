seat: 4
max_agents: 3
updated: 2026-11-27T16:10Z
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
