# FN1 Proformas and payment milestones (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/fn1-proformas` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money, document numbering, tax snapshots |
| Usage | briefed 27-11-2026; built by Opus 5.5 at high on the seat's own account (start and early check, 27-11-2026) |
| State | early check |
| Next step | the lead reads the early-check diff, then the builder continues with the screens |

## Brief
Build [phase5 §5](../../03-roadmap-appendix/phase5.md#5-the-money-model) (its proformas and milestones) and [§6.1](../../03-roadmap-appendix/phase5.md#61-fn1-proformas-and-payment-milestones) as written, with questions 3 (a) and 6 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:** `proformas` and `proforma_lines` (snapshot the order's lines, prices, HSN, tax-rate version and the tax split exactly as the order holds them; never recompute from the Price Master or the tax tables), `payment_milestone_templates` (company, segment, version, steps: label, percent or amount, due rule `on_confirmation`, `before_dispatch`, `on_installation`, `days_after_invoice:n`, loan gate kind), and `payment_milestones`. Money in `numeric(14,2)`; the percentages of a template sum to 100, and the milestone amounts of an order sum to its grand total with the rupee rounding of the tax engine (the last milestone takes the remainder).
2. **Numbering:** the `proforma` series (code `PI`, existing) per company and financial year, with no gaps under concurrency, through the document-sequence helper. A cancelled proforma keeps its number.
3. **Commands:** `finance.proforma.issue` (`finance.proforma.write`), `.cancel` (with a reason); `finance.milestone.plan` (from the current template on `sales.order.confirmed` through a worker as `system:workers`, or by hand), `.waive` (Executive, with a reason). Read access through the new `finance.read` (phase5 §4: seed, SECURITY §3.2 row, oracle).
4. **The loan gate:** a milestone with a loan gate reads `app.order_loan_gate()` (J2). If J2 has not merged when you reach it, read a stub definer answering `none`, and say so; the lead swaps it at integration.
5. **The dispatch guard:** an unpaid `before_dispatch` milestone refuses D2's `depart` with `payment_milestone_open`. D2 is not built yet (Phase 3 wave 3): expose `app.order_dispatch_payment_gate(order_id)` and its tests, and name in the report the one guard D2 or J8 adds.
6. **The PDF:** the proforma template in the print registry (`print/documents.ts`, type `proforma` already in `PDF_DOCUMENT_TYPES`): the company's letterhead, lines, HSN, the tax split, the total in words, the bank details from `app.entity_bank_envelope()` and the UPI ID; light, A4.
7. **Screens:** the order page's Payments tab (milestones with state, proformas, Issue proforma, Waive), Settings › Payment terms (Executive: templates by company and segment, versioned). Journey: Accounts issues a proforma and sees the milestones planned on confirmation; a Lead Converter sees their own order's milestones and no Waive. With axe and snapshots.

**Early check (Tier A):** once the tables, numbering, the commands and their tests are committed (gapless numbering under 20 concurrent issues, snapshots unchanged after a price or rate change, the amounts summing to the total), report `report: fn1-proformas early check` and stop.

Files owned: the four tables and their migrations; `packages/domain/src/commands/finance/` (new) and queries; the proforma template; the Payments tab; Settings › Payment terms; `finance.read`.

Do not touch: dispatch (D2), loans (J2), Tally (TC2, TC3).

Review checklist: no recomputed price or tax; gapless numbers; milestone sums exact to the rupee; `finance.read` scopes; the bank envelope read only through its definer.

### Brief addendum (the lead, 27-11-2026 19:00 UTC): the loan gate on a milestone
From J2's review: a milestone's loan gate lives on the milestone (`loan_gate`: `none`, `sanctioned`, `disbursed`), as phase5 §5 says.
- `app.order_loan_gate()` answers the order's `loanState` and whether its gates are waived. J2 no longer keeps milestone gates in `gates_json`.
- A milestone with a `sanctioned` gate is met once the loan is sanctioned or disbursed. A `disbursed` gate is met once the loan is disbursed. With no loan, or with the gates waived, there is no gate.
- A rejected loan without a waiver keeps the milestone pending.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: fn1-proformas <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: fn1-proformas blocked` with the question and stop.
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

### 27-11-2026, seat (worktree `fn1-proformas`, Postgres 54331): early check
**Skills loaded:** `add-table`, `add-command`.

**What is built (schema, numbering, commands and their tests; no screen yet):**
- Contracts: `packages/contracts/src/finance/` (`milestones.ts`, `proformas.ts`, `index.ts`, `milestones.test.ts`); `finance.read` and the platform-only `finance.milestones.process` in `permissions.ts`; the worker's grant in `system-principal.ts`; five events in `events/catalogue.ts` (`finance.proforma.issued`, `.cancelled`, `finance.milestones.planned`, `finance.milestone.waived`, `finance.terms.published`).
- Schema `packages/db/src/schema/finance.ts`: `proformas`, `proforma_lines`, `payment_milestone_templates`, `payment_milestones`; migrations `0240_fn1_proformas.sql` (generated) and `0241_fn1_proformas_rls.sql` (row security, guards, grants, `app.platform_only_permissions()` with the new key, `app.order_finance_readable()`, `app.order_milestone_facts()`, `app.record_order_milestones()`, `app.order_dispatch_payment_gate()` and the `app.order_loan_gate()` stand-in).
- Seeds: the permission descriptions and the `STAFF_MATRIX` row of `finance.read` (Executive all, GM entity, Sales Lead team, LC own, Accounts entity); `finance.milestones.process` held by `system:workers` only.
- Domain: `commands/finance/` (`proformas.ts`: `finance.proforma.issue`, `.cancel`; `milestones.ts`: `finance.milestone.plan`, `.plan_confirmed`, `.waive`; `terms.ts`: `finance.terms.publish`), registered; `finance/plan-milestones.ts` (the split, the due rule, the loan answer); `queries/finance/finance-dto.ts`; machines `proforma` and `payment_milestone` (in `MACHINES_IN_USE`, documents generated); `WORKSHOP_DEFAULTS.finance.milestoneSteps` (question 6 (a): advance 50 % on confirmation, balance 50 % before dispatch).
- Web: `workers/finance/plan-milestones.ts`, run from the `sales.order.confirmed` worker beside the customer's WhatsApp milestone; the audit names, field labels and error sentences in `screens/audit.ts` and `en.json`; the role editor's names of the two permissions.
- Documents: SECURITY §3.2 row and §3.3 grant, DATABASE §4.1 definers and §6.7 rows, `docs/data/` and `docs/state-machines/` regenerated.

**Tests added:**
- `packages/domain/tests/commands/finance.test.ts`, 16 on real Postgres: denied, wrong-company and happy path of every command; **20 issues at once (16 orders, 4 of them asked twice) give 16 consecutive numbers and the sequence ends exactly 16 on, the 4 refused returning theirs**; **a rate change after the order leaves a reissued proforma equal to the order's lines, value for value**; **the default and a 3-step template (fixed ₹5,000, 60 %, 40 %) sum to the order's ₹68,209 exactly**; the platform's planning once, idempotent, reading nothing; the waiver opening the dispatch gate; who reads by `finance.read` (LC own, Sales Lead team, Accounts, GM, Executive; another LC and a CC none).
- `packages/db/tests/security/finance.test.ts`, 14: the insert policies refuse a proforma of a draft order, by a Lead Converter or with totals unlike the order's, and a line whose price is not the order line's or added in a later transaction; one live proforma per order; only the cancel changes a proforma, once, in the canceller's name; never removed; payment terms the Executive's and append-only; no direct milestone write; the definer's sum, terms, company, state and caller checks; the waiver only as the Executive in their own name; the gates' callers; the platform-only key.
- `packages/domain/src/finance/plan-milestones.test.ts`, 10 (the exact sum over 6,860 awkward totals and shares, rounding, fixed amounts, due rules, each loan gate against each loan state); `packages/contracts/src/finance/milestones.test.ts`, 3.
- Updated: `ENTITY_TABLES` and a fixture row per company for the four tables with their matrix rules, `NARROWER`, the reader definer list, `enum-sync` (12 pairs), the agent refusal sweep's five people-only inputs, the machine fixtures, the workshop defaults test.

**Checks run (this worktree, through the lock):**
- `pnpm test:security`: db 63 files, 1815 passed; domain 111 files, 1535 passed; web 39 files, 461 passed.
- Unit: `@shakti/domain` 2866 passed; `@shakti/contracts` 343 passed; `@shakti/db` 163 passed; `web` 1241 passed, 1 skipped.
- Typecheck of `@shakti/contracts`, `@shakti/db`, `@shakti/domain` and `web`: clean. ESLint `--max-warnings 0` on `packages/contracts`, `packages/db`, `packages/domain`, `apps/web/src/workers`, `apps/web/src/screens`: clean. `pnpm copy-lint`: clean. `pnpm db:docs` and `machines:docs`: regenerated, their tests pass.
- Not yet run: the whole-repository `pnpm lint`, `pnpm build`, `js-budget`, journeys (the screens stage). `EXPLAIN (ANALYZE)` evidence comes with the screens' lists (the reads here are by order id on `proformas_order_idx` and `payment_milestones_order_seq_unique`).

**For integration:**
- **J2's `app.order_loan_gate()` must answer the platform planning milestones:** its first check and `v_operations` need `or app.has_perm('finance.milestones.process:all')`, or the platform's planning of an order whose terms have a loan-gated step is refused (42501). My stand-in is created only where J2's function is absent (`to_regprocedure`), so it never replaces J2's whichever merges first; it answers J2's new shape (`loanState`, `waived`). `grants.test.ts` lists `app.order_loan_gate(uuid)` in both slices.
- **The one guard D2 or J8 adds:** in the dispatch machine's `depart`, a guard reading `app.order_dispatch_payment_gate(order_id)` (preloaded by the command) that refuses `open` with `{ code: 'conflict', reason: 'payment_milestone_open' }`; the sentence is in `en.json`.
- `app.platform_only_permissions()` is redefined with `finance.milestones.process` added to 0222's list: check it against `main`'s latest at the merge.

**Decisions the brief did not settle (assumptions):**
1. A proforma is of the whole order (its lines and totals); one live proforma per order, a cancelled one kept beside the next. It stores no `account_id`: it is read through its order, which a customer merge moves.
2. Permissions: issue and cancel `finance.proforma.write` (entity); plan by hand `finance.payment.write` (entity); waive and publish terms `finance.payment.write` at `all` (the Executive alone); terms read with `finance.read`.
3. The worker needs a grant of its own (ADR 0020): the platform-only `finance.milestones.process`, not in phase5 §4's list; its command is `finance.milestone.plan_confirmed`. The terms command is `finance.terms.publish`.
4. A template's steps: fixed amounts come off the total first; the percentages (summing to 100) share the rest; the last step is a percentage. Shares round half-up to the rupee as they add up, never past the whole rupees left, and the last takes the remainder, so every split is exact and none is negative. A share may be ₹0 on a tiny order.
5. A company with no terms for the segment plans from `WORKSHOP_DEFAULTS.finance.milestoneSteps` (`template_id` null); a dealer's order without a lead is of `dealer_wholesale`.
6. Due: an on-confirmation step falls due as it is planned (unless its loan holds it); the other rules wait for moments other slices bring (D2's ready dispatch, the installation, TC3's invoice), through the machine's `fall_due`; no command moves them yet.
7. Planning is once per order (`milestones_already_planned`); a waiver is the only change after it.
8. `pdf_file_id` exists with no update grant yet; the PDF's path comes with the screens stage.

## Review

## Integration
