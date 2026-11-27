# J2 Customer loans (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j2-loans` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money and gates on dispatch and payments |
| Usage | briefed 27-11-2026; built on Opus 5.5 at high (start of the build lane, 27-11-2026) |
| State | early check reported |
| Next step | the lead reads the early-check diff, then the builder continues with the screens |

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

## Review

## Integration
