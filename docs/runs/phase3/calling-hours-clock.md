# The calling screen outside calling hours (follow-up)

| | |
|---|---|
| Branch | `fix/calling-hours-clock` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): telecom hours rules on the calling screen |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

## Brief
STATUS's open follow-up: the click-to-dial journeys fail in CI before 09:20 IST and after 20:30 IST (#284's runs before 09:20 failed on phone and dark, and passed after). The suspect is the app's clock-shift path outside calling hours, which may also reach real callers. Find the root cause and fix it in code, not only in the journey.

1. **Reproduce first:**
   - Read the click-to-dial journeys and the calling screen's handling of the TRAI calling hours (`apps/web/src/screens/calling.ts`, the dial rules in `packages/domain/src/telecom`, `app.dial_facts()`).
   - Run the logic under the journeys' test clock (`bos-test-clock`, `apps/web/e2e/support/clock.ts`) and in unit tests at 09:10, 09:20, 20:30 and 21:05 IST.
   - Name the failing assertion and the code path in the report.
2. **Fix the cause:** a time read by the UTC date or the browser's zone instead of IST; a window edge off by one; a dial refused and shown wrongly; or the screen choosing a branch by the wall clock. What a caller sees outside calling hours must be plain and correct (copy in `en.json`, the §11 rules).
3. **Make the journey deterministic:** per [slice-integration §10](../../runbooks/slice-integration.md#10-lessons), it sets the server's clock with the test clock and runs both branches (inside and outside calling hours) on every run, never choosing a branch by the wall clock.
4. **Tests:** unit tests at each edge, in the domain or screen helper that holds the rule; the journey's two branches.

Files owned: the calling screen's hours handling and its helpers and tests; the click-to-dial journeys.

Do not touch: Phase 3 slices; `app.dial_facts()`'s consent and number-series rules beyond the hours edge, unless the cause is there, and then say so.

Review checklist: the hours rule is IST on every path; the journey runs both branches whatever the hour; the copy follows §11.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5, §10, §13 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: calling-hours-clock <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: calling-hours-clock blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (wave 2, 27-11-2026):**
- `x4-stock-reasons`: the reason registry of `app.stock_move()`;
- `h2-reservations`: reservations and availability, and the only body change to `app.stock_move()`;
- `u2-purchase-orders`: purchase orders, receipts and the scan field;
- `h3-stock-counts`: stock counts;
- `q1-labels`: labels and `parseLabelPayload()`;
- `r3-warranty`: warranty claims and supplier returns;
- `calling-hours-clock`: the calling screen outside calling hours.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the print document registry, the testing lists, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
