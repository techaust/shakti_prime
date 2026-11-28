# J6 QC and labour cost lines (Phase 4, wave 2)

| | |
|---|---|
| Branch | `feat/j6-qc-costs` on GitHub, from `main` after J1 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): cost data behind finance.cost.read, and the QC sign-off |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase4 §7.3](../../03-roadmap-appendix/phase4.md#73-j6-qc-and-labour-cost-lines) as written, with question 10 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:**
   - `checklists`: a template per company, business line and step, with its items (`yes_no`, `number` with bounds, `text`, `photo_required`), versioned like J1's flow templates; a running inspection keeps its version.
   - `qc_inspections`: a project's filled checklist for a step, with its answers, photo file ids (a file purpose `qc_photo`, through `app.file_purpose_grant()` written from `main`'s latest with every purpose kept), the submitter, the signer and the state (`submitted`, `signed_off`, `rejected` with a reason).
   - `project_cost_lines`: `kind` `labour`, `contractor` or `other_direct`, `vendor_id` for a contractor, quantity, rate and amount `numeric(14,2)`, a note, and `reverses_id`. Append-only (DATABASE §5's trigger); a correction is a reversal line.
2. **Contractors** become a vendor `kind` in U1's master (`vendors.kind` with `supplier` the default and `contractor`), with the check widened and `enum-sync` paired.
3. **Cost isolation (PRJ-05):** `project_cost_lines` is read only with `finance.cost.read`, by RLS on the table and by a whitelisted DTO. Its values never appear in an event payload, an audit value (audit names the line's id and kind, never its rate or amount), a notification, an export or an agent's input. No agent principal holds `finance.cost.read`. Test every one of these paths, including the reader pool.
4. **Commands:** `projects.qc.submit`, `.signoff` (`projects.qc.signoff`; never the submitter), `.reject` (a reason); `projects.cost.add`, `.reverse` (`finance.cost.read` plus `projects.write`); `projects.checklist.publish` (Executive). The QC step of J1's flow completes only through a signed-off inspection when the step has a checklist (J1's guard reads `app.project_qc_signed_off()`, a definer you add).
5. **Screens:** the project page's QC tab (fill, submit, sign off or reject, with photos) and Costs tab (only with `finance.cost.read`: lines, reversals and the total), and Settings › Checklists. Journeys: a Project Manager submits a QC checklist and another signs it off; Accounts adds and reverses a labour line; a Field Engineer sees no Costs tab and gets not-found on its route. With axe and snapshots.

**Early check (Tier A):** once the tables, the policies, the commands and the cost-isolation tests are committed, write a short report and push `report: j6-qc-costs early check`, then stop.

Files owned: the three tables and their migrations; the vendor kind; `packages/domain/src/commands/projects/qc*.ts` and `cost*.ts` and their queries; the QC and Costs tabs; Settings › Checklists.

Do not touch: job costing roll-up and project profit (FN6); the field app's QC screens (F3).

Review checklist: no cost value on any path without `finance.cost.read` (RLS, DTO, events, audit, exports, agents, the reader pool); cost lines append-only; the signer is never the submitter; `app.file_purpose_grant()` keeps every purpose of `main`'s latest.

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
  - `pnpm format:check` (Prettier);
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: j6-qc-costs <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: j6-qc-costs blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0259 on 28-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 4 wave 2, from 28-11-2026):**
- `j5-scheduling`: crews, schedule slots, unavailability, the board;
- `j6-qc-costs`: checklists, QC inspections, project cost lines, the contractor vendor kind;
- `f2-sync`: the sync routes, the collections registry, the app's sync loop and Conflicts screen.

On `main` already: J1 (projects), J2 (loans), F1 (the field app and mobile sign-in). Being integrated beside you: J3, H2, U2, H3, R3, HR1, FN1, TC2.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
