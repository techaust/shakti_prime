# HR1 Employees, shifts, holidays and leave (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/hr1-people` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): permissions, approvals, a state machine |
| Usage | briefed 27-11-2026; early check built on Opus 5.5 at high (the lead's cloud VM, moved from seat 4) |
| State | early check |
| Next step | the lead reads the early-check diff, then the builder continues with the screens |

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

### Early check, 27-11-2026, the lead's cloud VM (moved from seat 4)
Opus 5.5 at high. Skills loaded: `add-table`, `add-command`. Stopped at the early check (Tier B): the tables, row security, the `leave-request` machine, the eleven commands and their tests are committed; no query, action, screen or journey yet.

**Built (files):**
- Contracts: `packages/contracts/src/hr/{enums,people,leave}.ts` (inputs and strict DTOs), the event `hr.leave.approved` in `events/catalogue.ts`, the new permission `hr.leave.request` (own) in `permissions.ts`.
- Schema and migrations: `packages/db/src/schema/hr.ts` (`employees`, `shifts`, `holidays`, `leave_types`, `leave_requests`, `leave_balances`); `0240_hr1_people.sql` (generated) and `0241_hr1_people_rls.sql` (row security forced on all six, policies for `app_user` and `app_reader`, column-level update grants, the definer `app.hr_manages()`, the trigger `app.leave_requests_guard()`, the append-only trigger on `leave_balances`, the exclusion constraint `leave_requests_no_overlap`). The numbers follow main's 0239; the lead renumbers them, and `docs/05-database.md` cites 0240/0241 to be renumbered with them.
- Seeds: `hr.leave.request` for every staff role at own scope (`seeds/permissions.ts`, `seeds/role-permissions.ts`), its SECURITY §3.2 row and its role-editor label.
- Domain: `state-machines/machines/leave-request.ts` (registered, in `MACHINES_IN_USE`, `docs/state-machines/leave-request.md`); `hr/leave-days.ts` (pure working-day count), `hr/calendar.ts` (`holidaysBetween()`), `hr/rows.ts` (DTO mappers); `commands/hr/employees.ts` (`hr.employee.create`, `.update`, `.deactivate`), `commands/hr/settings.ts` (`hr.shift.set`, `hr.holiday.set`, `hr.leave_type.set`), `commands/hr/leave.ts` (`hr.leave.request`, `.approve`, `.reject`, `.cancel`, `hr.leave.adjust`); registry and index; `WORKSHOP_DEFAULTS.hr` (HR-1's answer: 09:30 to 18:00, 30 minutes' lunch, 26 working days, 10 minutes' grace, half day under 4 hours; leave types and holidays empty).
- Web (what the commands need now): audit actions, the event name and every audit field's label in `apps/web/src/screens/audit.ts` and `components/activity/activity-details.tsx` (code groups `leaveState`, `leaveMovementKind`, `weekday`), `contract-values.ts` values with their equality test, and every error reason's sentence in `en.json`.
- Documents: `docs/05-database.md` §4.1 (`app.hr_manages()`), §5 (`leave_balances` append-only), §6.1 (`business_calendar` stays planned, with where the days off are read meanwhile) and §6.8 (the six tables); `docs/07-security.md` §3.2 row; `pnpm db:docs` and `machines:docs` regenerated.

**Tests added:** `packages/domain/tests/commands/hr.test.ts` 19 cases (denied, another company and the happy path of all eleven commands; own approval refused; team scope; balance falls once; overlap; no working days; the event; no phone digits in the audit row); `packages/db/tests/security/hr.test.ts` 9 cases (fail closed; reads by person, team lead, GM, HR; a manager who left; writes refused outside `hr.employee.write`; own approval and out-of-scope decisions refused by the trigger; cancel by the asker only; `use` only by the approver, for its days, once; append-only; group settings only covering every company); `packages/domain/src/hr/leave-days.test.ts` 5 cases; the machine's fixture in `machines.test.ts`; six tables in the role × company matrix (fixture rows own, managed and unmanaged per company, plus group rows), `ENTITY_TABLES`, `NARROWER`, the reader-definer list and `enum-sync`; the eleven commands in the people-only refusal sweep.

**Checks run (on the worktree's Postgres, 54335, migrated and seeded fresh after the VM restart):**
- `pnpm test:security`: db 63 files, 1818 passed; domain 111 files, 1538 passed; web 39 files, 461 passed (4 of 4 tasks successful).
- `pnpm typecheck`: 10 of 10 tasks successful.
- `pnpm exec eslint --max-warnings 0` on `packages/contracts/src`, `packages/db/{src,tests,seeds}`, `packages/domain/{src,tests}`, `apps/web/src/screens`, `apps/web/src/components/activity`: clean.
- Unit tests: contracts 340, db 162, domain 2841 passed; web 1158 passed, 1 skipped (run before the last domain-only changes; web untouched since).
- `pnpm copy-lint`: clean.
- Not yet run: `pnpm build`, `js-budget`, the whole-repository `pnpm lint`, journeys and `EXPLAIN (ANALYZE)` (no list or search exists until the screens).

**Assumptions (calls the brief did not settle):**
1. **A new permission `hr.leave.request`** (own, every staff role), as `finance.expense.submit` is: the catalogue had no permission for asking for leave. SECURITY §3.2 has its row.
2. **"The manager's team"** for `hr.leave.approve` at team scope is the people whose `manager_id` is the approver's own employee record, still on the staff (`app.hr_manages()`), not the sales team of `user_entity_roles`.
3. **Who reads an employee:** the person, HR and the Executive (`hr.employee.write`), the GM (`hr.leave.approve` for the company), a team lead for the people they manage. Requests and balance movements are read with their employee. Shifts, holidays and leave types are read by every principal acting in some company.
4. **Leave days** are the working days of the span: every day that is neither one of the person's shift's weekly days off nor a holiday of their company or the group; whole days only (no half-day request). A person with no shift counts every day but holidays. This is the plain count, not a leave rule; HR-2 may change it.
5. **No balance check on approval:** an approval is not refused for want of balance (that would be a leave rule); the approver will see the balance on screen. An approval writes one `use` movement of the request's days.
6. **Cancel** is only from `requested`, by the person who asked or whose leave it is. An approved leave is not cancelled; HR corrects with `hr.leave.adjust` (grant or adjust, always with a reason), so the brief's three movement kinds stay the only ones.
7. **HR may ask for leave for anyone** on the staff (staff with no sign-in need it); a person asks only for themselves.
8. **Office** is a plain name on the employee (`office`, up to 80 characters): no office table exists on main (F4's `attendance_sites` is not merged). F4 or HR2 may link it later.
9. **Shifts, holidays and leave types** may be of one company or of the whole group (DATABASE's `entity_id null`); a group row is changed only in a request acting for every company (`assertConfigScope`, reused from CRM). None is seeded; the Shifts screen will start a new shift from `WORKSHOP_DEFAULTS.hr`.
10. **J5's unavailability is not on main:** the hook is the event `hr.leave.approved` (the request, the employee and the first and last day), emitted by `hr.leave.approve` (`subscribed: false`). When J5 merges, the lead either writes the `unavailability` row in `approveLeave` right after the `use` movement (`packages/domain/src/commands/hr/leave.ts`), or subscribes a worker to the event.
11. **`business_calendar`** stays planned: `holidays` holds the days off, read through `holidaysBetween()`.
12. **A request spans at most 366 days** (`LEAVE_REQUEST_MAX_DAYS`), a bound against a typing slip, not a leave rule.

**Changes to shared tests:** `data-docs.test.ts` named `employees` as an example of a planned table; it now names `salary_sheets`. The people-only sweep compared a `localeCompare` order with a plain sort, which `hr.leave_type.set` breaks; both lists now sort with `localeCompare`.

**Uncertain or for the lead:** the migrations' numbers and the 0240/0241 cited in DATABASE move at the merge. During the first run, four stray agent principals from an earlier version of `hr.test.ts` broke `fail-closed.test.ts` on the old database; the test now uses the seeded agent's id, and the database has since been recreated.

## Review

## Integration
