# HR1 Employees, shifts, holidays and leave (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/hr1-people` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): permissions, approvals, a state machine |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase5 §5](../../03-roadmap-appendix/phase5.md#5-the-money-model) (its HR group, except attendance, incentives and salary sheets) as the employee directory, shifts, holidays and leave of HR-01 and HR-02. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points settled here:

1. **Tables:** `employees` (optional `user_id` for staff with no sign-in, name, phone, company, manager, shift, office, joining date, active; one per person per company), `shifts` (start, end, `grace_min`, `weekly_off_days`, lunch minutes), `holidays` (company, date, name; feeds the existing `business_calendar` where it is read), `leave_types` (company, name, days a year, carry over, paid), `leave_balances` (append-only movements: grant, use, adjust), `leave_requests` with a new machine `leave-request` (`requested`, `approved`, `rejected`, `cancelled`). Row security by `hr.*` scopes; a person reads their own employee row, balances and requests.
2. **Approval:** `hr.leave.approve` per scope (the manager's team, GM entity, HR all); never one's own; an approval deducts the balance once. Approved leave writes `unavailability` rows (J5, Phase 4) when J5 is on `main`; if not, expose the hook and name it for the lead.
3. **Commands:** `hr.employee.create`, `.update`, `.deactivate`; `hr.shift.set`; `hr.holiday.set`; `hr.leave_type.set`; `hr.leave.request`, `.approve`, `.reject`, `.cancel`; `hr.leave.adjust` (HR, with a reason). Each audited with no phone digits in values.
4. **Defaults:** HR-1's answer of 02-11-2026 in `WORKSHOP_DEFAULTS.hr` (09:30 to 18:00, 30 minutes for lunch, 26 working days a month, 10 minutes' grace, half day under 4 hours); leave types and holidays empty until HR-2.
5. **Screens:** `/hr/people` (directory), a person's page (shift, manager, balances), `/hr/leave` (my requests; to approve), Settings › Shifts, Holidays, Leave types (HR). The menu HR for holders of `hr.*`. Journeys: a person requests leave, the manager approves, the balance falls; an HR person sets a holiday. With axe and snapshots.

**Early check (Tier B):** once the tables, the machine, the commands and their tests are committed, report `report: hr1-people early check` and stop.

Files owned: the HR tables above and their migrations; the `leave-request` machine; `packages/domain/src/commands/hr/` (new) and queries; `/hr` pages and the HR settings.

Do not touch: attendance (F4, HR2); incentives (HR3); the salary export (HR4); `unavailability` beyond writing rows (J5).

Review checklist: never approving one's own leave; balances by movements only; scopes per role; no invented leave rules.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 5 design](../../03-roadmap-appendix/phase5.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: hr1-people <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: hr1-people blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 5 wave 1, from 28-11-2026):**
- `fn1-proformas`: proformas and payment milestones;
- `tc1-tally-connector`: `apps/tally-connector`;
- `tc2-tally-ingest`: the connector's routes and the `tally_*` tables;
- `hr1-people`: employees, shifts, holidays and leave.

Phase 3's waves 2 and 3 and Phase 4's waves 1 and 2 run at the same time.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
