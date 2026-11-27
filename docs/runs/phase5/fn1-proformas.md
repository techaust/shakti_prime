# FN1 Proformas and payment milestones (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/fn1-proformas` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money, document numbering, tax snapshots |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

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

## Review

## Integration
