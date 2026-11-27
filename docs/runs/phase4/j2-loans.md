# J2 Customer loans (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j2-loans` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money and gates on dispatch and payments |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

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

## Review

## Integration
