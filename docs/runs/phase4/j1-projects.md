# J1 Projects and the standard flow (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j1-projects` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): row security with a new `own` scope, a platform-only drafting worker |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase4 §5](../../03-roadmap-appendix/phase4.md#5-the-project-model) and [§6.1](../../03-roadmap-appendix/phase4.md#61-j1-projects-and-the-standard-flow) as written, with questions 1 (a) and 2 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:** `projects`, `project_assignments`, `project_flow_templates` and `project_milestones` with the columns of §5 and §6.1.
   - A new series kind `project` (code `PRJ`), per company and financial year, through the existing document-sequence helper.
   - `flow` is `standard` or `surya_ghar`. J1 drives only `standard`, and records the flow J4 will drive for a `pm_surya_ghar` scheme. Until J4 merges, a Surya Ghar project is drafted with its milestones empty and the project page says its steps come with the subsidy flow. Name this in the report.
2. **Row security:**
   - `projects.read` and `projects.write` per their scopes. The `own` scope for a Field Engineer and a Lead Converter means a project they are assigned to (`project_assignments`) or own.
   - Write the `own` predicate as one definer, `app.project_is_mine(project_id)`, that later slices reuse for schedule slots, documents, cost lines and stock.
   - Templates are read by any `projects.read` holder and written only by the Executive (`projects.write:all`).
3. **The machine `project-standard`** comes into use (`MACHINES_IN_USE`), with one command per event: `projects.project.create`, `.milestone.complete`, `.hold`, `.resume`, `.complete` and `.cancel`.
   - The guard `documents_missing` reads `app.project_missing_documents()` when J3 has merged. Until then it reads a stub definer answering none. Say which you used.
   - `complete`'s effects `handover_kit` and `register_warranty` are J11's. Mark them in the machine as proposed.
4. **Drafting:** a worker on `sales.order.confirmed`, running as `system:workers` with the platform-only `projects.draft` (add it to `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX` and SECURITY §3.3; redefine `app.platform_only_permissions()` with every key of `main`'s latest version, ADR 0020), drafts the project:
   - The segment comes from the order's opportunity's pipeline (`pipelines.segment`).
   - The scheme comes from the order's sizing where present.
   - Only `farmer_pumps`, `residential_rooftop` and `commercial_epc` with a site are drafted.
   - The current template version is copied into `project_milestones`.
   - Idempotent per order: a replayed event drafts nothing twice.
   - Never touch `confirm-order.ts` (H2 changes it this wave). The worker listens to the event.
5. **Template editor:** Settings › Project steps (Executive), with a version per company and segment. Publishing a version makes it current for new projects.
6. **STATUS on WhatsApp:** `app.status_summary()` (migration 0201) adds the customer's own projects with their current step. Redefine it with every line of `main`'s latest version, and diff it before you report.
7. **Screens:** `/projects` (keyset list by state, owner, segment and step), the project page (header, Milestones, and a tab frame later slices add tabs to, one line each), Account 360's Projects section, and the order page's link to its project. The menu Projects in `nav.ts` for the roles holding `projects.read`.
   - Journeys: the Project Manager (a drafted project, completing milestones in order, hold and resume), and a Field Engineer (sees only their assigned project). With axe and snapshots.
8. **Events:** `projects.project.drafted`, `.milestone_completed`, `.held`, `.completed` and `.cancelled`, carrying ids only.
9. **Retention:** `projects` and its children join the retention list with the period DATABASE §7 gives, else a named default pending the CA. Say which.

**Early check (Tier A):** once the tables, row security, the `own` definer, the machine, the commands, the drafting worker and their tests are committed, write a short report with the policies' text and push `report: j1-projects early check`, then stop. The tests to commit first: every role × company on every table and pool; an engineer reads only assigned projects; drafting per segment, once per order.

Files owned: the four tables and their migrations; `packages/domain/src/commands/projects/` (new) and `queries/projects/`; the drafting worker; `apps/web/src/app/(bos)/projects/` (list and page frame); Settings › Project steps; the `project` series kind.

Do not touch: `confirm-order.ts` and reservations (H2); documents and requirements (J3); loans (J2); subsidy tables and the Surya Ghar machine (J4).

Review checklist: `own` scope correct on every route and query; drafting idempotent and segment-correct; templates versioned, with running projects untouched by a new version; `status_summary` keeps every earlier line; no agent drafts.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: j1-projects <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: j1-projects blocked` with the question and stop.
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
