# J2 Customer loans (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j2-loans` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money and gates on dispatch and payments |
| Usage | briefed 27-11-2026; built on Opus 5.5 at high (early check and lane 45, 27-11-2026); fix round on Opus 5.5 at high (27-11-2026) |
| State | built, reviewed, fix round done |
| Next step | integration (fresh database, Linux baselines, `checks-ok` for `js-budget.json`) |

## Brief
Build [phase4 §6.2](../../03-roadmap-appendix/phase4.md#62-j2-customer-loans) as written. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Table `customer_loans`:** `entity_id`, `account_id`, `sales_order_id`, `lender_id` or `lender_name`, `amount` `numeric(14,2)`, `state`, `sanctioned_amount`, `sanctioned_at`, `disbursed_at`, `reference`, `rejected_reason`, and `gates_json` (contract-validated: `{ dispatch: 'disbursed' | 'sanctioned' | 'none', milestones?: … }`, default dispatch on disbursal).
   - One active loan per order: a second is refused while one is applied, sanctioned or disbursed.
   - Row security follows the order's company and `crm.account.read` and `.write` scopes.
2. **Table `lenders`:** per company, a name and whether it is active, edited in Settings by holders of `admin.entities.write`. A loan names a lender from the list, or a name typed once when the list is empty.
3. **The machine `customer-loan`** comes into use, with one command per event: `crm.loan.create`, `.sanction`, `.disburse` and `.reject`. Each is audited and its amounts are plain (no cost grant); the events carry ids and the state. The guard `loan_amount_missing` and the effect `release_gates` are as the machine says. `release_gates` raises `crm.loan.gates_released`, which J8 and Phase 5 read.
4. **The gate answer:** `app.order_loan_gate(order_id)` is a definer answering, per gate kind, `none`, `pending` or `met`. J8's dispatch guard and Phase 5's milestones call it; nothing else decides a loan gate.
5. **Screens:** the Loan tab on the order page (and the project page once J1 has merged; add the tab with one line, or name it for the lead), Account 360's loans, and Settings › Lenders. Journey: an Accounts person records a loan through sanction and disbursal, and the gate answer changes. With axe and snapshots.

**Early check (Tier A):** once the tables, the machine's commands, `app.order_loan_gate()` and their tests are committed, write a short report and push `report: j2-loans early check`, then stop.

Files owned: `customer_loans` and `lenders` and their migrations; `packages/domain/src/commands/crm/loans*.ts` and their queries; the Loan tab; Settings › Lenders.

Do not touch: dispatch (D2, J8); the project page frame beyond one tab line (J1).

Review checklist: one active loan per order under concurrency; the gate answer from one definer only; amounts validated; events without personal data.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 4 design](../../03-roadmap-appendix/phase4.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: j2-loans <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: j2-loans blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 4 wave 1, from 27-11-2026):**
- `j1-projects`: projects, the standard flow, templates and the project page frame;
- `j2-loans`: customer loans;
- `j3-documents`: customer documents, requirements and masking;
- `f1-field-foundation`: `apps/field`, mobile sign-in, `/me` and feature flags.

Phase 3's wave 2 runs at the same time: X4, H2, U2, H3, Q1 and R3.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

### 27-11-2026, early check (cloud worktree `/home/user/shakti-wt/j2-loans`, Postgres on 54333)
Skills loaded: `add-table`, `add-command`. Commits: `3d1b90d5` (wip), `878fa02e`, `0201738e`.

**Built**
- Schema `packages/db/src/schema/loans.ts`: `lenders` (company, name unique by case per company, `is_active`) and `customer_loans` (the brief's columns: `lender_id` or `lender_name`, `amount`, `state`, `state_changed_at`, `sanctioned_amount`, `sanctioned_at`, `disbursed_at`, `reference`, `rejected_reason`, `gates_json` defaulting to `{"dispatch":"disbursed"}`). Checks hold each state's shape (a sanction keeps amount and time, only a disbursed loan has `disbursed_at`, only a rejected one a reason, amounts above zero, the dispatch gate's three values). One active loan per order: the partial unique index `customer_loans_active_unique` (applied, sanctioned, disbursed).
- The loan names its order by `(sales_order_id, entity_id, account_id)` with ON UPDATE CASCADE, so it keeps the order's company and customer and follows the order through a customer merge with no change to `app.merge_customers()`. This needed one unique key on `sales_orders` (`sales_orders_id_entity_account_unique`, in `sales-orders.ts` and the generated migration, placed before the foreign key).
- Migrations `0240_j2_customer_loans.sql` (generated) and `0241_j2_customer_loans_rls.sql` (custom): RLS enabled and forced on both; lenders read by every principal acting in the company and written with `admin.entities.write:all`; loans read with the customer's relationship in the loan's company (the `dealer_terms` pattern, `exists` on `account_entities`), inserted and moved with `crm.account.write` over that relationship (`scope_ok`), on a visible order that is not cancelled, naming an active lender of the company or a typed name only while the company has no active lender; column grants for the moving columns only; `app.guard_customer_loan()` holds the machine's moves in the table too (applied to sanctioned or rejected, sanctioned to disbursed or rejected; a sanction never changes; a disbursed or rejected loan changes only its customer by a merge).
- `app.order_loan_gate(order_id)` (definer, `search_path = ''`, revoked from public and reporting, granted to `app_user` and `app_reader`): `{ loanId, loanState, dispatch, milestones }` with `none`, `pending` or `met` per gate. It answers a holder of `inventory.dispatch.write` or `finance.payment.write`, or a reader of the customer's relationship (`crm.account.read` in scope); null for an order outside the request or the relationship; refuses anyone else.
- Contracts `packages/contracts/src/crm/loans.ts`: states, `LoanGatesSchema` (`dispatch` default `disbursed`, `milestones` as key to `sanctioned`/`disbursed`, at most 20), `OrderLoanGateDto`, the four loan inputs, two lender inputs, `CustomerLoanDto`, `LenderDto`. Five events in the catalogue: `crm.loan.created`, `.sanctioned`, `.disbursed`, `.rejected` (ids and the state; `rejected` adds the order's lead and the state it left) and `crm.loan.gates_released` (order id, state, `dispatch` flag, released milestone keys).
- Machine `customer-loan` in use (`stored`, `emits`, `MACHINES_IN_USE`); its states now come from the contracts.
- Commands, each audited, people only, in `packages/domain/src/commands/crm/`: `loans-create.ts` (`crm.loan.create`), `loans-sanction.ts`, `loans-disburse.ts`, `loans-reject.ts`, `loans-lenders.ts` (`crm.lender.create`, `crm.lender.update`, `admin.entities.write` at `all`), helpers `loans-shared.ts`. `release_gates` diffs `app.order_loan_gate()` before and after the move (`releasedGates()` in `queries/crm/loans.ts`), so the definer stays the one place a gate is decided; no release, no event. Reads `readCustomerLoan()` and `orderLoanGate()` in `packages/domain/src/queries/crm/loans.ts`.
- Registration lines (each under a J2 comment): the command registry and domain index, the event catalogue, `MACHINES_IN_USE`, the testing lists (`ENTITY_TABLES`), the matrix fixture and rules, `NARROWER`, `enum-sync`, the app_reader definer list, the agent sweep inputs, the unmasked-field examples, the reader parity test, `audit.ts` (actions, events, fields, code groups `loanState` and `loanDispatchGate`), `activity-details.tsx`, `contract-values.ts`, the `/admin` client namespaces, and `en.json` (seven `errors.*` sentences, Activity log labels, a new `loans` namespace with the states and dispatch-gate choices). `docs/data/*` and `docs/state-machines/*` regenerated.

**Tests added**
- `packages/db/tests/security/customer-loans.test.ts`: 19 cases (lenders read and kept by the Executive only; loans read by relationship on both pools; insert refused outside the relationship, without the grant, in another state, on a cancelled order, with an inactive or another company's lender, or a typed name while the list has one; two concurrent inserts on one order, one refused by `customer_loans_active_unique`, and a rejected loan freeing the order; column grants and the guard's moves; the merge cascade; the gate answer per state for dispatch and milestones, on sanction, `none`, after rejection, to the dispatching and Accounts roles, null or refused to others; the definer's grants).
- `packages/domain/tests/commands/loans.test.ts`: 13 cases, 15 tests (denied, another company and happy path for all six commands; `loan_active_exists` under two concurrent creates; cancelled order; lender off the list; typed name only while the list is empty; `loan_amount_missing`; illegal moves; events and audit row contents; `gates_released` on disbursal and on sanction with milestones; rejection freeing the order).
- Matrix rows for both tables in every company, the agent refusal sweep (people only, admin and customer writes), enum-sync pairs for five constraints, reader parity for both reads.

**Checks**
- `pnpm test:security` (through the lock, on 54333): db 63 files, 1812 passed; domain 111 files, 1534 passed; web 39 files, 461 passed; `Tasks: 4 successful, 4 total`.
- `pnpm --filter @shakti/domain exec vitest run src`: 110 files, 2810 passed. `pnpm --filter web exec vitest run`: 167 files, 1240 passed, 1 skipped, 1 failed (`/admin` client namespaces lacked `loans`); after the fix `src/i18n`, `errors-catalogue` and `audit` were rerun alone (5 files, 59 passed), and the whole web suite was not run again.
- `typecheck` of `@shakti/contracts`, `@shakti/db`, `@shakti/domain` and `web`: clean. `eslint --max-warnings 0` on `packages/db`, `packages/contracts`, `packages/domain/src` and the touched test files, `apps/web/src/screens`, `apps/web/src/components/activity`, `apps/web/src/i18n`: clean. `pnpm copy-lint`: clean. `pnpm db:docs` and `machines:docs`: regenerated.
- Not run yet (screens lane): the whole-repository `pnpm lint`, `pnpm build`, `js-budget`, journeys. `EXPLAIN (ANALYZE)`: the suites leave both tables empty, so plans now show only empty seq scans and the definer at 1.5 ms; the list queries come with the screens, and their plans will be taken on seeded volume then.

**Decisions the brief did not settle**
1. The loan's customer comes from its order through a composite foreign key with ON UPDATE CASCADE (a new unique key on `sales_orders`), rather than a change to the merge definers.
2. Loans are read with the customer's relationship (`account_entities`), so a person who reads the customer through one of its leads reads its loans, and the Concierge only for the thread it is bound to (in `THREAD_BOUND_FOR_AGENTS`). Amounts are not cost data, so no cost grant applies.
3. The disbursal records no amount of its own: the guard's "amount recorded" is the sanctioned amount. `disbursed_at` and `sanctioned_at` are the command's time, not a typed date.
4. The lender's reference is a code (letters, digits and `/ - _ .`, no spaces, at most 60) so it can be exempt from the Aadhaar masking (`unmaskedFields`), as a loan account number may be twelve digits.
5. Lender commands are named `crm.lender.create` and `crm.lender.update` (switch off and on; never deleted).
6. The gate definer answers holders of `inventory.dispatch.write` (J8) and `finance.payment.write` (Phase 5) in the order's company, and readers of the customer; `crm.loan.gates_released` is raised only when something was released.
7. Loan commands write no customer timeline row (it would widen `activities_type_check`, a shared constraint other slices may also redefine).

**Open points for the lead**
- **The journey's actor:** the brief's journey has an Accounts person record a loan through sanction and disbursal, but SECURITY §3.2 gives Accounts no `crm.account.write`, and the design (§6.2) and the machine put every loan command on `crm.account.write`. Without a matrix change, Accounts can read loans and gate answers but not record them. Either the owner adds `crm.account.write` (or a new loan permission) for Accounts, or the journey uses a General Manager or Project Manager. I will write the journey with a General Manager unless the lead says otherwise.
- **`notify_owner` on rejection:** `crm.loan.rejected` carries the order's lead, but no worker tells the lead's owner yet. Wiring it means a notice type (the `notifications_type_check` list), the notify command and worker registry, and its sentence. I plan it for the screens lane unless the lead wants it elsewhere.
- Module documents (DATABASE §6 line, SECURITY §3.2 notes, API, the design's Built record) are written with the screens.

### 27-11-2026, done (lane 45, cloud worktree `/home/user/shakti-wt/j2-loans`, Postgres on 54333, app on 3033)
Built on the early check the lead accepted (decisions 1 to 7). Commits `3cf4d1bc` to `fdc10594`.

**Built**
- **`notify_owner`:** `crm.loan.rejected` now carries `rejectedBy` and is subscribed; the notify worker (`notify-event.ts`, `events/registry.ts`, `qstash.ts`) runs `notifications.event.notify`, which asks the new definer `app.notice_loan_owner(entity, loan)` (`notifications.send`, `search_path = ''`) for the owner of the order's live lead, else the owner of the customer's relationship in the company, and writes one `loan_rejected` notice per loan (subject the order, link to the order page), never to the person who recorded the turn-down. The notice type widens `notifications_type_check` and `notification_preferences_type_check` (generated migration, both `NOT VALID`); copy in `notifications.types` and `pushAlerts`. Migrations `0242_j2_loan_rejected_notice.sql`, `0243_j2_loan_rejected_notice_owner.sql`.
- **Reads** (`packages/domain/src/queries/crm/loans.ts`): `getOrderLoans()` (the order's loans newest first, the gate answer, the company's active lenders, `canWrite` as the policies decide it), `listAccountLoans()` (at most 50, newest first, with the order's number when the caller reads the order), `listLenders()`; contracts `OrderLoansInput/Dto`, `AccountLoansInput`, `AccountLoanRowDto`, `ListLendersInput`.
- **Actions** `apps/web/src/actions/loans.ts`: the three reads through `executeQuery()` and the six commands through `executeCommand()`, each in a request narrowed to the record's company.
- **Screens:**
  - The Loan tab below the order page's lines (`components/loans/order-loan-panel.tsx`, dialogs in `loan-dialogs.tsx`, loaded on first use): the dispatch gate's answer as a badge, the active loan (lender, amounts, dispatch gate, dates, reference, status), Record a loan / Record sanction / Record payout / Record turn-down for a person who may write the customer, and the earlier turned-down loans with their reasons. The order page passes the tab as children of `OrderScreen` (one prop).
  - Account 360's Loans (`components/loans/account-loans.tsx`), one block in `account-screen.tsx`.
  - Settings › Lenders (`/settings/lenders`, menu item `settings-lenders`, `admin.entities.write:all`): one company at a time, add, rename, switch off and on (`lenders-screen.tsx`, `lender-dialog.tsx` loaded on first use).
  - **The project page's Loan tab** (J1 has not merged): one line for J1's frame, `<OrderLoanPanel initial={…} />` fed by `getOrderLoans({ entityId, orderId })` for the project's order.
- **Journeys** `apps/web/e2e/loans.spec.ts` with the seed `e2e/setup/loans.ts` (per project a dealer of the journeys' company and a fresh draft order each run, so company 3's lists stay as other pictures hold them) and a new signed-in role `journeyManager` (General Manager of company 2, with an authenticator): the GM records a typed-name loan, its sanction and its payout, and the gate badge goes from none to waiting to released; Account 360 lists it; the Executive adds a lender in Settings › Lenders and switches it off. Axe on every step; pictures `order-loan-paid-out` (the Loan tab alone, after the toasts leave) and `lenders-add` (the dialog alone).
- **Documents:** DATABASE §6.2 (`customer_loans` Built, `lenders`), the two definers in the definer table and `loan_rejected` in `notifications`; SECURITY (customer loans paragraph); the design's Built record under §6.2; `docs/data/*` and `docs/state-machines/*` regenerated; copy-lint's button keys (`recordLoan`, `recordSanction`, `recordPayout`, `recordTurnDown`, `switchOff`, `switchOn`, `renameLender`); `js-budget.json` (`/settings/lenders` 203 kB; `/catalogue` raised by 1 kB for the shell's new menu entry, measured 245.1 kB).

**Tests added in this lane**
- `packages/domain/tests/commands/notifications.test.ts`: 2 (the owner told once, not when they recorded it; refused to a person and to the worker of another company).
- `packages/domain/tests/commands/loans.test.ts`: 2 more (the Loan tab read for GM, Accounts, the owner, another caller and another company; Account 360's loans and the lenders), 15 cases and 17 tests in the file.
- Reader parity covers `getOrderLoans`, `listAccountLoans`, `listLenders`; the catalogue test lists `crm.loan.rejected` as subscribed; contract values `ACTIVE_LOAN_STATE_VALUES`, `CUSTOMER_LOAN_STATES`, `LOAN_DISPATCH_GATES` equal the contracts.
- Journeys: 2 per project (6).

**Checks**
- `pnpm typecheck` and `pnpm lint` (whole repository, through the lock): `Tasks: 10 successful`, eslint clean.
- Unit: domain 110 files, 2810 passed; contracts 25 files, 340 passed; web 167 files, 1241 passed, 1 skipped. `pnpm copy-lint`: clean. `pnpm db:docs`, `machines:docs`: regenerated and committed.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within its budget (66 pages); `/orders/[entityId]/[orderId]` 214.8 kB of 223, `/customers/[accountId]` 201.3 of 205, `/settings/lenders` 193.1.
- Journeys (through the lock, on this slot's database, native Chromium, not the Playwright image): `loans.spec.ts` 6 of 6 passed. With `orders`, `customers`, `notifications` and `access`: 89 passed, 18 failed, 2 skipped, and every failure is `toHaveScreenshot` (36 of 36 errors), `access.spec` included, which this slice does not touch: this VM is not the Linux Playwright image. No picture was committed.
- `pnpm test:security` before the journeys (early check): all green. After the journeys' seed had run on this database: db 1811 of 1812 (`alert-counts.test.ts` hit `agent_configs_scope_unique` on a Co-pilot setting of company 3 the e2e seed wrote), domain 111 files 1538 passed, web 460 of 461 (`demo-data.test.ts` read a retail price the seed's price lists changed). Both are the aged database CLAUDE.md warns of, in files this slice does not touch; a clean run needs a fresh database, which I did not make (no `docker`, no `fresh-db.sh`).
- `EXPLAIN (ANALYZE)` on the reader pool with 5,000 orders and loans over 500 customers of company 4 (removed afterwards): the Loan tab `Index Scan Backward using customer_loans_order_idx`, 0.45 ms; Account 360's loans `Index Scan Backward using customer_loans_account_idx` with the policy's `account_entities_account_entity_key` probe, 0.61 ms as the owner at own scope and 0.35 ms as a GM with the order join on `sales_orders_pkey`; `app.order_loan_gate()` 4.6 ms; the lenders list a seq scan over the company's few rows, 0.09 ms.

**For the lead at integration**
- `apps/web/js-budget.json` changed (a new page and the 1 kB raise): the pull request waits for the owner's `checks-ok`.
- New Linux baselines: `loans.spec.ts` (`order-loan-paid-out`, `lenders-add`), and remade ones for `orders.spec.ts` `order-page` (the snapshot order now shows its empty Loan tab) and `customers.spec.ts` `customer-account` (Account 360 now shows Loans).
- Migrations 0240 to 0243 to renumber after `main`'s last. 0242 redefines `notifications_type_check` and `notification_preferences_type_check` with `loan_rejected`: if another slice merged first and widened them, keep both values. 0240 adds `sales_orders_id_entity_account_unique` before the loan's foreign key, and the order matters.
- The run file is reported as an orphan by `check-doc-links.py` (no `docs/runs/phase4` index on the branch yet).
- The project page's Loan tab: the one line above, for J1's frame.

**Assumptions**
- "The Loan tab" on the order page is a titled section below the lines, as the order page has no tabs; it is the same component J1's project page takes as its tab.
- The new journey role `journeyManager` (GM of company 2) keeps the loan journey off the snapshot company's lists; Accounts records no loan (lead's decision); who does in the client's team is a client question.
- On Account 360 a loan shows its sanctioned amount once sanctioned, else the amount applied for.

### 27-11-2026, fixes (cloud worktree `/home/user/shakti-wt/j2-loans`, Postgres on 54331, app on 3031)
The one fix round: M1, L1, L2, L3, L5, L6 and L7 as the lead's triage says. Skill loaded: `add-command`. Commits `cb0afb07` to `b4dec24b`, and this report.

**Fixed**
- **M1 (a turn-down keeps the dispatch held):** `app.order_loan_gate()` now reads the order's loan as its active loan, else its newest turned-down one. A turned-down loan whose dispatch gate was not `none` answers `pending` with `reason: 'loan_rejected'` until a new loan replaces it or a person waives it. A waived loan answers `none` with `waived: true`. New command `crm.loan.gates.waive` (`loans-waive.ts`): `crm.account.write` at `entity` scope, people only, a reason of 1 to 300 characters, audited (`waiverReason`). It locks the loan and refuses with `loan_gates_not_held` unless the gate answer is `pending` for this very loan, so a second waiver, a replaced loan, a loan under way or one that held nothing back are refused. It raises `crm.loan.gates_released` (state `rejected`). The waiver is stored on the loan in `gates_waived_at`, `gates_waived_by` and `gates_waived_reason` (`customer_loans_waiver_check`: all three set together, only on a rejected loan). It is column-granted, and `app.guard_customer_loan()` allows it once, only on a rejected loan and only with `crm.account.write:entity`, and never changes it afterwards. Screen: while a turned-down loan holds the dispatch, the Loan tab shows "Dispatch waits: the loan was turned down" with a help line. A person with company scope (`canWaive` in `OrderLoansDto`) sees "Stop waiting for a loan", which opens a dialog with the reason (`waiveLoanGates` action, loaded with the other dialogs). The earlier loans list shows the waiver's reason. Copy: `loans.gate.turnedDownNote`, `loans.tab.stopWaiting` (button key added to copy-lint), `loans.tab.turnedDownHelp`, `loans.tab.waivedBecause`, `loans.waive.*`, `errors.loan_gates_not_held`, `errors.loan_rejected` (for J8's refusal), and the Activity log labels `loanGatesWaive` and `waiverReason`. `loans.reject.intro` and `errors.loan_order_cancelled` were reworded for the new behaviour.
- **L6 (milestones out of the loan):** `gates_json` holds only `dispatch` (`LoanGatesSchema` strict, `{ dispatch }`). `LOAN_MILESTONE_GATES*` and `LoanMilestoneKeySchema` are removed. The answer is `{ loanId, loanState, dispatch, waived, reason }` (`OrderLoanGateDto`). `crm.loan.gates_released` carries `{ salesOrderId, state, dispatch }` with `state` in `sanctioned`, `disbursed` or `rejected`. `releasedGates()` returns whether the dispatch went from `pending` to anything else. The machine's text and the Built record say that a Phase 5 milestone keeps its own `loan_gate` and compares it with `loanState` and `waived`.
- **L1 (fail-closed checks):** `customer_loans_gates_check` is `jsonb_typeof(gates_json) = 'object' and gates_json - 'dispatch' = '{}'`, and `customer_loans_gates_dispatch_check` uses `coalesce(gates_json ->> 'dispatch', '') in (…)`, so `{}`, an extra key and an unknown value are refused. The definer also answers `pending` (never `none`) for a gate value it does not know.
- **L2 (the definer's reader rule):** the reader branch now repeats `account_entities_read` (0213) exactly: `crm.account.read` at company scope, at the relationship's team, or own (a person's own relationship, or an agent's bound thread); or, for a person, a live lead of the customer in the company that they read under `opportunities_read`'s scopes. This is the same pattern as `app.order_search_ids()`. The entry check also admits `crm.lead.read` holders, who may read through a lead. `getOrderLoans()` is unchanged: it can no longer meet a null answer for a loan its caller reads.
- **L3 (the merge test):** a new security case puts a paid-out loan on a lead's order (with an order made from a quote), runs `app.merge_customers()` as the Executive (the lead, its order and the loan all move to the kept customer, and the loan stays `disbursed`), then `app.unmerge_customers()` (all back).
- **L5:** the journeys' General Manager is now "Dinesh Gurjar".
- **L7 (cancelled orders):** `crm.loan.sanction` and `.disburse` refuse an order that is cancelled (`loan_order_cancelled`) or that the caller cannot read (`order_missing`), using the helper `requireOpenOrder()` in `loans-shared.ts`. The `customer_loans_update` policy holds the same rule: a row moving to or staying `sanctioned` or `disbursed` needs an order the caller reads that is not cancelled. A turn-down and a waiver may still close a loan on a cancelled order. The Built record, DATABASE and SECURITY say so.

**Migrations:** the changes are folded into the branch's own `0240` (columns and checks) and `0241` (guard, update policy, grants, definer). None of them is on `main`. Snapshots 0240 to 0243 carry the new `customer_loans` entry, and `pnpm db:generate` then reports "No schema changes".

**Tests (counts)**
- `packages/db/tests/security/customer-loans.test.ts`: 25 (was 19). New cases: a sanction refused on a cancelled order while a turn-down passes; the waiver only on a rejected loan, at company scope, whole, once, and nothing else changing afterwards; the gates refusing `{}`, an extra key or an unknown value; the merge and undo through the definers; pending after a turn-down until a new loan and then a waiver; and the reader through their own lead on both pools (null once the lead is archived). The gate cases were rewritten for the new answer.
- `packages/domain/tests/commands/loans.test.ts`: 20 cases, 22 tests (was 15 and 17). New or changed: the sanction releasing a dispatch that waits for it, with the milestones input refused; sanction and payout refused on a cancelled order while a turn-down passes; the turn-down keeping the gate `pending` until a new loan; `crm.loan.gates.waive` happy path (gate, event, audit, once), its refusals (a newer loan, a loan under way, a loan holding nothing), denied (own scope, Accounts), wrong company, empty reason, and two waivers at once; and `canWaive` on the Loan tab read.
- `agent-refusals.test.ts`: `crm.loan.gates.waive` in `J2_LOAN_INPUTS`. `enum-sync.test.ts`: `customer_loans_waiver_check: ['rejected']`. `packages/db/src/docs/data-docs.test.ts`: the "planned table points at a built one" example moved from `customer_loans` (now built) to `warranty_claims`.

**Checks**
- `pnpm test:security` on this slot's fresh database (migrated and seeded first), through the lock: db 63 files, 1818 passed; domain 111 files, 1543 passed; web 39 files, 461 passed; `Tasks: 4 successful, 4 total`.
- Unit: contracts 25 files, 340 passed; domain `src` 110 files, 2810 passed; db `src` 12 files, 161 passed; web 167 files, 1240 passed, 1 skipped, 1 failed (`errors-catalogue`: `loan_rejected` had no sentence). After the fix, `errors-catalogue`, `src/i18n` and `src/screens` were rerun: 34 files, 281 passed.
- `pnpm exec turbo run typecheck --force`: `Tasks: 10 successful, 10 total`. `pnpm lint` (whole repository): exit 0, no problems. `pnpm copy-lint`: clean. `pnpm db:docs` and `machines:docs`: regenerated and committed.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within its budget (66 pages): `/orders/[entityId]/[orderId]` 214.9 kB of 223, `/customers/[accountId]` 201.3 of 205, `/settings/lenders` 193.1 of 203.
- Journeys (through the lock, native Chromium, after `e2e:seed`): `loans.spec.ts` 6 of 6 passed (22 with the setup projects). The pictures the run wrote were deleted, not committed; the Loan tab picture is unchanged in layout.
- `EXPLAIN (ANALYZE)` of the definer's two new queries, as the migrator (the definer runs as its owner), in a rolled-back transaction with 5,000 orders and 12,500 loans (two turned down per order, an active loan on half of them) over 500 customers of company 4:
  - the order's loan: `Index Scan using customer_loans_order_idx` (2 rows), then a sort for `limit 1`, 0.040 ms;
  - the reader rule: `Index Scan using account_entities_account_entity_key`, with the lead probe on `opportunities_entity_owner_idx`, 0.031 ms.

**Decisions the triage did not settle**
1. The waiver is stored on the turned-down loan (three columns), not in a table of its own. It is waived by loan id, and only the loan the gate answer holds (`loan_gates_not_held` otherwise).
2. The answer's `reason` has one value, `loan_rejected` (`LOAN_GATE_REASONS`). A loan still under way answers `pending` with no reason. A turned-down loan whose dispatch gate was `none` holds nothing and needs no waiver.
3. A waiver raises `crm.loan.gates_released` with state `rejected`, and no event of its own. `dispatch` stays a boolean in the payload (always true), because the data-documents generator cannot show a `true` literal.
4. A turn-down and a waiver are allowed on a cancelled order; only a sanction and a payout are refused there.
5. **L4 brought forward:** DATABASE's two table rows say `Built (0240)`, and the two definer rows name `0241` and `0243`, because `data-docs.test.ts` fails on `Built (J2)` (it failed at `d3c644b2` too). The numbers move with the renumbering at the merge.

**For the lead at integration**
- The migration notes of the done report stand. 0240 and 0241 now hold the waiver columns, the stricter checks, the new guard, the update policy and the definer.
- The remade Linux baselines are as before. The Loan tab shows the new turned-down state only after a turn-down, which no journey reaches.
- `js-budget.json` is unchanged in this round. It changed in the build lane, so `checks-ok` is still needed.

## Review

### 27-11-2026, slice reviewer (seat, cloud worktree `/home/user/shakti-wt/j2-loans`, Postgres on 54332), reviewed at `d3c644b2`
Tier A. No critical or high finding: nothing blocks the merge. One medium point needs the lead's decision before J8 reads the gate. The low findings can be follow-ups, but L1 and L4 are one-line fixes.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| M1 | medium | `packages/db/migrations/0241_j2_customer_loans_rls.sql`, `app.order_loan_gate()` (the "order's one active loan" select); `loans-reject.ts` | A turn-down lifts the dispatch hold. The definer counts only an applied, sanctioned or disbursed loan, so once a loan is rejected it answers `dispatch: 'none'`, not `pending`. No `gates_released` event is raised and no decision records this. PRD CRM-08 says "a gated dispatch or milestone cannot be released until the loan reaches the configured state". The run file's decisions and the design's Built record do not say that a rejection releases the hold. | An order of ₹3 lakh waits on disbursal. The lender turns the loan down, or a store manager with `crm.account.write:own` records a turn-down with any reason. J8's guard then reads `none` and lets the material leave with no loan and no payment. The security test asserts this behaviour ("none once rejected"). | The lead or owner decides. Either the order's newest rejected loan keeps the gate `pending` until a new loan or an explicit release by a General Manager (say, a new loan with dispatch `none`), or a turn-down releases the hold by design. In the second case, record it as a decision, in the design's Built record and in DATABASE, so J8 knows to pair the gate with its payment check. | confirmed |
| L1 | low | `packages/db/migrations/0240_j2_customer_loans.sql`, `customer_loans_gates_dispatch_check` and `customer_loans_gates_check` | The table check on the gates fails open. `gates_json ->> 'dispatch' in (…)` is null when the key is missing, so `{}` passes (checked on this database: `('{}'::jsonb ->> 'dispatch') in (…)` is null). Milestone values are not checked at all. The definer then answers `none` for a missing dispatch key and for an unknown milestone value. | Today only `crm.loan.create` inserts, and the contract always fills `dispatch`, so no live path exists. A later import, definer or data fix that writes `{}` would silently drop the hold. | `coalesce(gates_json ->> 'dispatch', '') in ('disbursed', 'sanctioned', 'none')`, plus a check that every milestone value is `sanctioned` or `disbursed` (or make the definer answer `pending` for anything it does not know). | confirmed |
| L2 | low | `packages/domain/src/queries/crm/loans.ts`, `getOrderLoans()` → `orderLoanGate()`; the definer's reader branch | The definer's reader rule is narrower than the loan read policy. The definer uses `scope_ok('crm.account.read', owner, team)`. `customer_loans_read` goes through `account_entities_read`, which also lets a person read the customer through their own lead. The definer returns null, `orderLoanGate()` throws `order_missing`, and the order page drops the whole Loan tab without a word. | A Lead Converter's lead is handed over while another person holds the customer's relationship (`held_by_other`). The converter opens their order and sees no Loan tab. Account 360 lists the same loan for them. | Let `getOrderLoans()` return the loans with no gate (a nullable `gate`) when the definer answers null, or align the definer's reader branch with `account_entities_read`. | confirmed (code path read; not reproduced) |
| L3 | low | `packages/db/tests/security/customer-loans.test.ts:383` | The merge test proves less than the Built record claims. It moves an applied loan with a direct `update sales_orders` as the migrator. The guard's merge exception for a disbursed or rejected loan (`to_jsonb(new) - array['account_id', …]`) is not exercised, and neither is the real chained cascade through `app.merge_customers()` (lead → order → loan). | A later change to the guard or to the merge definer could refuse every merge of a customer with a paid-out loan, and no test would fail. | Add a case: a disbursed loan on a lead's order, moved by `app.merge_customers()` and back by `app.unmerge_customers()`. | confirmed |
| L4 | low | `docs/05-database.md:243-244, 539-540` | The two definer rows cite `J2` in the Migration column, and the two table rows say "Built (J2)". Every other row gives the migration number. | The rows stay unnumbered after the merge. | At the renumbering, write the final numbers (the RLS migration, and the notice-owner one). | confirmed |
| L5 | low | `apps/web/e2e/support/users.ts:110` | The new `journeyManager` takes the display name "Mahesh Kumawat", which `storeManager` already has (company 1). | A team lead acting in companies 1 and 2, or the Executive's Team members list, shows two people with the same name. Any later `getByText('Mahesh Kumawat')` matches two. | Give the journeys' General Manager a name of their own. | confirmed |
| L6 | low | `app.order_loan_gate()` milestones vs the Phase 5 design (`main`, phase5.md, lines 103, 176 and 207) | The two slices disagree on where a milestone's loan gate lives. Phase 5 puts it on the milestone (`payment_milestones.loan_gate`) and waits until the definer "answers met". J2 keeps it in the loan's `gates_json.milestones` by key, and no screen or command sets it. A milestone whose key the loan does not name gets no answer at all, so it would wait forever. | Phase 5 builds a loan-gated milestone, the loan names no milestones, and the milestone never becomes due. | Note it for the Phase 5 slice: either the definer takes the milestone's own gate as an argument, or Phase 5 writes its keys into the loan. Nothing to change in J2 now. | confirmed (interface note) |
| L7 | low | `customer_loans_update` policy; `loans-sanction.ts`, `loans-disburse.ts`, `loans-reject.ts` | The Built record says a loan is "written … on an order the person reads that is not cancelled", but only the insert checks this. A sanction, payout or turn-down still goes through on a cancelled order. The tab hides the buttons (`canWrite`), but a direct call to the server action is not refused. | Someone records a payout on a cancelled order through the action, and it raises `gates_released` for an order that will never be dispatched. | Refuse a sanction or payout on a cancelled order (a `loan_order_cancelled` check in the commands), or change the Built record and DATABASE to say the check applies when a loan is recorded. | confirmed |

**Checked and sound**
- **Data isolation**
  - Both tables are in `ENTITY_TABLES` with a matrix fixture row per company and rules: `lenders` CONTEXT; `customer_loans` ACCOUNT_READ through the lead, and thread-bound for agents.
  - Row security is enabled and forced on both. Every policy reads `app.entity_ids()` and `app.user_id()`, which are null without settings, so they deny.
  - `app_reader` is on both select policies and on the definer. The loan is scoped through `account_entities`, and its company and customer are pinned to the order by the composite key.
  - No delete grant. The column grants match the moves, and `gates_json`, `amount`, the lender and the customer cannot be updated (security test).
- **Definers**
  - `app.order_loan_gate()` and `app.notice_loan_owner()` each check their permission in the body, set `search_path = ''` and revoke execute from `public` and `readonly_reporter`.
  - The gate answers ids and states only, never an amount or a lender.
  - The trigger function `app.guard_customer_loan()` is revoked as well.
- **Commands**
  - All six commands are `peopleOnly`, each with `auditFields` labelled in `activity.fields` and one `ctx.audit()`.
  - Their events come from the catalogue and carry ids and states only; the turn-down reason, amounts and lender stay out of them.
  - Denied, wrong-company and happy-path tests exist for each.
  - Lender inputs are in `INPUTS`, loan inputs in `CUSTOMER_INPUTS`, and all are in `PEOPLE_ONLY_INPUTS`.
  - `unmaskedFields` covers only the reference, and the reference is restricted to a code.
  - No cost permission is touched.
- **Races and money**
  - One active loan per order: the check, then the partial unique index with `constraintReasons`, tested twice under concurrency (database and domain).
  - Moves lock the loan `for update`, and the guard trigger holds the machine in the table.
  - Amounts are `MoneySchema` strings, above zero, compared in paise by the guard, and stored as `numeric(14,2)`.
  - No price, discount or tax is involved.
- **Gate answer from one definer:** `releasedGates()` diffs two answers of `app.order_loan_gate()`, the tab's badge shows its answer, and nothing else decides a gate.
- **Web layer**
  - Reads go through `executeQuery()` with a name and writes through `executeCommand()`, each narrowed to the record's company.
  - `screenAccess(navRequires('settings-lenders'))` guards the new page.
  - Browser code imports only types from the contracts; values come from `contract-values.ts`.
  - The dialogs load on first use.
  - The idempotency key is per form (`useCommand`).
  - Nothing runs at import time.
- **Copy:** every string is in `en.json`, plain, with the button keys added to copy-lint and the error reasons mapped.
- **Notice**
  - `loan_rejected` widens both type checks, `NOT VALID` as before. It is deduplicated once per loan, never told to the person who recorded the turn-down, and links to the order.
  - Merge note: 0242 redefines the two notice checks, so keep any value another slice adds.
- **Documents:** SECURITY's paragraph, DATABASE's rows (apart from L4), the design's Built record (apart from L7), and the regenerated `docs/data` and `docs/state-machines` (the staleness tests pass).
- **Suites (this review):** on this slot's fresh database, through the lock, after `pnpm db:migrate` and `pnpm db:seed`, `pnpm test:security` gave:
  - db: 63 files, 1812 passed;
  - domain: 111 files, 1538 passed;
  - web: 39 files, 461 passed;
  - `Tasks: 4 successful, 4 total`.

  This clears the two aged-database failures the builder reported.

**Not checked**
- **Journeys:** `apps/web/e2e/loans.spec.ts` was not run, because a seat cannot sign in. I read both tests: the General Manager records loan, sanction and payout with axe at each step and the picture `order-loan-paid-out`; the Executive adds and switches off a lender with the picture `lenders-add`. I also did not run the remade `orders.spec.ts` `order-page` and `customers.spec.ts` `customer-account` pictures.
- **Layout:** no Linux baselines exist yet, so I looked at no screenshot. The lead looks at the four pictures at integration (light, dark, phone).
- **Not re-run:** `pnpm build`, `js-budget`, the whole-repository lint and typecheck, and the unit suites; the builder's results are in the report. `js-budget.json` changed, so the pull request needs the owner's `checks-ok`.
- **EXPLAIN:** I did not repeat the builder's plans on seeded volume. They are recorded in the report and the indexes match the queries.
- **Company 2 pictures:** I did not check whether the new General Manager of company 2 changes any existing picture of company 2 (people pickers in the UAT or dealer-credit journeys).

**The lead's triage (27-11-2026):** fix M1, L1, L2, L3, L5, L6 and L7 in the one fix round. L4 is the lead's at the merge.
- **M1:** a rejected loan keeps its gates pending, with the reason `loan_rejected`, until a person decides.
  - Either a new loan replaces it, or `crm.loan.gates.waive` (`crm.account.write` at entity scope, a reason, audited) records that the order no longer waits on a loan.
  - The definer answers `pending` for a rejected loan with no waiver, and `none` after a waiver.
  - Tests for both paths.
- **L6:** the Phase 5 design governs. A milestone's loan gate lives on the milestone (FN1's `loan_gate` kind, `sanctioned` or `disbursed`).
  - Drop `milestones` from `gates_json` and from the definer's answer. `gates_json` holds only `dispatch`.
  - The answer carries `loanState` (and whether the gates are waived), so FN1 compares its milestone's kind with it.
  - `crm.loan.gates_released` names the dispatch gate and the loan's new state only.
- **L1, L2, L3, L5 and L7:** as the review says. For L2, the definer's reader rule follows `customer_loans_read`'s policy exactly.
- **No re-check:** the lead reads the diff.

## Integration

### The lead, 27-11-2026, cloud session (slot 7: Postgres 54337)
- **The fix diff, read by the lead.**
  - M1: a rejected loan holds dispatch until a person records a waiver (`crm.loan.gates.waive`), with a reason, once, only on a rejected loan, enforced by the guard.
  - L6: `gates_json` holds only `dispatch`, and the answer carries `loanState` for FN1.
  - L1, L2, L3, L5 and L7: fixed, with tests.
- **Main taken in** (X4 #298, Q1 #299) by a merge commit.
  - The shared lists were resolved with `merge-json.py`, `merge-copylint.py` and `merge-union.py`, each hunk read. The files differ from `main` only by J2's additions.
  - The migrations move to 0243 to 0246 (`renumber-migrations.mjs`), and `pnpm db:generate` reports no changes.
  - `notifications_type_check` and `notification_preferences_type_check` are 0228's lists plus `loan_rejected`.
  - DATABASE cites 0243, 0244 and 0246 (finding L4).
- **`integrate.sh`** ran in three parts on a fresh Postgres on 54340:
  - install, lint, format, copy lint, generated and typecheck: pass;
  - unit: pass;
  - security: pass (db 1,893; domain 1,559; web 466), and `db:verify` passed;
  - audit, build with `.env` aside, js-budget and gitleaks: pass.
- **The whole journey set in the Linux image,** each project on its own fresh database, first with `--update-snapshots=changed`, then verifying.
  - Desktop-light: 235 passed. Desktop-dark: 222 passed, 13 skipped. Phone: 222 passed, 13 skipped. Both runs.
  - 23 baselines changed:
    - The loan's own: Account 360, the order page, notification settings, the Executive's home.
    - Every desktop baseline that shows the menu (design, admin agents, integration health, pipeline settings): Settings › Lenders lengthens the masked menu. The lead compared old and new: the same 34 rows in the menu column turn from white to the mask, and nothing else.
- **No checks files are changed.**
