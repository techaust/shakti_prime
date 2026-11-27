# J1 Projects and the standard flow (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j1-projects` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): row security with a new `own` scope, a platform-only drafting worker |
| Usage | briefed 27-11-2026; built from 27-11-2026 on Opus 5.5 at high effort, on the seat's own account |
| State | early check |
| Next step | the lead reads the early check; the builder continues with the screens on `continue` |

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

### 27-11-2026, seat (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332): early check
Skills loaded: `add-table`, `add-command`. Opus 5.5 at high effort.

**Built (the layers below the screens):**
- **Schema** (`packages/db/src/schema/projects.ts`; migrations `0240_j1_projects.sql` generated, `0241_j1_projects_rls.sql` custom): `projects`, `project_assignments`, `project_flow_templates`, `project_milestones` with the columns of phase4 §5 and §6.1; the `project` series kind (`DocTypeSchema`, `document_sequences_doc_type_check` widened `NOT VALID`, `WORKSHOP_DEFAULTS.numbering.docCodes.project = 'PRJ'`).
- **Row security, grants and definers** (0241): the policies below; `app.project_is_mine()`; `app.project_order_facts()` and `app.create_project()` (the only way a project and its steps are made); `app.projects_guard()`; `app.project_missing_documents()` as a stub; `app.platform_only_permissions()` redefined with all nineteen keys of 0222 plus `projects.draft`; `app.next_document_no()` redefined with 0201's body plus `project`.
- **Permission** `projects.draft`: `PERMISSION_KEYS`, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, the seed's description and empty role map, SECURITY §3.1 list, §3.2 row and §3.3 grant table (count now twenty).
- **Machine** `project_standard` in `MACHINES_IN_USE`, `stored` on `projects.state`/`state_changed_at`, each transition's `emits`; `handover_kit` and `register_warranty` marked proposed (a new `Effect.proposed`, printed by the renderer); `docs/state-machines/` regenerated.
- **Commands** (`packages/domain/src/commands/projects/`): `projects.project.draft` (platform), `projects.project.create`, `projects.milestone.complete`, `projects.project.hold`, `.resume`, `.complete`, `.cancel`, plus `projects.project.assign` and `projects.template.publish`; the read `readProject()` (`queries/projects/project-dto.ts`); the pure `draftDecision()` (`src/projects/draft-decision.ts`).
- **Events** `projects.project.drafted`, `.milestone_completed`, `.held`, `.completed`, `.cancelled` (ids only, `subscribed: false`).
- **Drafting worker**: `apps/web/src/workers/projects/draft-event.ts`, run first in the `sales.order.confirmed` worker (`workers/events/registry.ts`), before the existing milestone message. `confirm-order.ts` untouched.
- **Activity log and copy**: action, event, field and value names in `screens/audit.ts`, `activity-details.tsx`, `contract-values.ts`; `en.json` `activity.*`, `adminRoles.permissions.projects_draft` and eight `errors.*` sentences.
- **Retention**: `WORKSHOP_DEFAULTS.retention.projectYears = 8`, a named default pending the CA (DATABASE §7 gives no period for projects; BLUEPRINT §7.9's 8 years for financial records and sales orders, which a project follows). DATABASE §7 line added; no job yet.
- **Documents**: DATABASE §4.1 definer rows, §6.6 rows Built, §7 retention; SECURITY §3.1, §3.2 (a Projects paragraph), §3.3; `pnpm db:docs` regenerated.

**The policies (0241):**
```sql
create policy projects_read on projects for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('projects.read:entity'))
       or ((select app.has_perm('projects.read:own')) and app.project_is_mine(id))));
create policy projects_update on projects for update to app_user
  using / with check (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('projects.write:entity'))
              or ((select app.has_perm('projects.write:own')) and app.project_is_mine(id))));
-- no insert policy and no insert grant: app.create_project() makes projects
create policy project_assignments_read on project_assignments for select to app_user, app_reader using (
  exists (select 1 from projects p where p.id = project_assignments.project_id));
create policy project_assignments_insert on project_assignments for insert to app_user with check (
  (select app.has_perm('projects.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from projects p where p.id = project_assignments.project_id
                                         and p.entity_id = project_assignments.entity_id));
create policy project_assignments_delete on project_assignments for delete to app_user using (
  (select app.has_perm('projects.write:entity')) and entity_id = any ((select app.entity_ids())::int[]));
create policy project_milestones_read on project_milestones for select to app_user, app_reader using (
  exists (select 1 from projects p where p.id = project_milestones.project_id));
create policy project_milestones_update on project_milestones for update to app_user
  using / with check (exists (select 1 from projects p where p.id = project_milestones.project_id
    and ((select app.has_perm('projects.write:entity'))
         or ((select app.has_perm('projects.write:own')) and app.project_is_mine(p.id)))));
create policy project_flow_templates_read on project_flow_templates for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[]) and (select app.has_perm('projects.read:own')));
create policy project_flow_templates_insert on project_flow_templates for insert to app_user with check (
  (select app.has_perm('projects.write:all'))
  and entity_id = any ((select app.entity_ids())::int[]) and published_by = (select app.user_id()));
-- project_flow_templates: app.raise_append_only() on update or delete, and no update or delete grant
```
Grants: `projects` select, and update only of `state, state_changed_at, owner_id, hold_reason, cancel_reason, updated_at, updated_by`; `project_milestones` select, and update only of `state, done_at, done_by, skip_reason`; `project_assignments` select, insert, delete; `project_flow_templates` select, insert. `app_reader` selects all four.

`app.project_is_mine(p_project)` (`language sql stable security definer set search_path = ''`, executable by `app_user` and `app_reader`): true when `app.user_id()` is the project's `owner_id` or has a `project_assignments` row on it, and the project is in `app.entity_ids()`. It checks no permission, since it answers only about the caller; the policies that call it check theirs (listed as such in DATABASE §4.1). It must be a definer: the assignments are read with the project and `projects_read` asks the assignments.

**Tests added:**
- `packages/db/tests/security/projects.test.ts`, 88 cases: every role (12 staff, 6 agents, the workers) acting in each of the four companies reads exactly its rows of the four tables on both pools, `app_user` and `app_reader` (76); none without a context; a Field Engineer reads only the project they are on and its steps; a Lead Converter the one they own; `app.project_is_mine()` per caller and company; no request role inserts a project or a step; an engineer moves only their project and its steps; only `projects.write:entity` names the owner (guard, 42501) or changes the people; only the Executive publishes a checklist and a published one never changes; the definers refuse every role but the workers and a person with `projects.write:entity` (an agent with it too); `projects.draft` platform-only in the database; the stub answers none.
- The role × company matrix (`role-entity-matrix.test.ts`) covers the four tables through new fixture rows and rules; `grants.test.ts` (`NARROWER`, the reader's definers), `enum-sync.test.ts` (eleven pairs).
- `packages/domain/tests/commands/projects.test.ts`, 16 cases: drafting per segment (farmer pumps and commercial EPC drafted with the default steps; dealer, an order without a lead, without a site, unconfirmed and cancelled orders skipped), once per order (two deliveries side by side, a replay, and a replay after the project was cancelled draft one project, one event), PM Surya Ghar recorded with no steps and refused by the standard commands, refused to people, agents and the platform of another company; templates versioned (a new project copies the newest, a running project keeps its copy), publish for the Executive only; hand creation (segment named for a dealer's order, `project_exists`, `project_order_not_confirmed`, a new project after a cancel); assignment, then an engineer reads only their project; steps in order (`milestone_out_of_order`, an unassigned engineer's `project_missing`, `milestone_missing`); hold with a reason and resume by a manager only; complete only with every step done; events in order; another company's project; and one case refusing each of the nine commands to a role without its grant and for another company.
- `packages/domain/src/projects/draft-decision.test.ts`, 4 unit cases; `agent-refusals.test.ts` gains the eight people-only inputs and the drafting command in the platform's work.

**Checks**, all on this seat's Postgres (54332), through `tools/integration/heavy.sh`:
- `pnpm test:security`: db 63 files, 1885 tests passed; domain 111 files, 1535 passed; web 39 files, 461 passed (exit 0).
- `pnpm typecheck`: 10 of 10 tasks successful.
- Unit tests: contracts 340 passed; db 162 passed; domain 2811 passed; web 1241 passed, 1 skipped.
- `pnpm exec eslint --max-warnings 0` on `packages/contracts/src`, `packages/db`, `packages/domain`, `apps/web/src/screens`, `apps/web/src/workers`, `apps/web/src/components/activity`: clean. Prettier clean on the slice's files.
- `pnpm copy-lint`: clean.
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs`: regenerated and committed.
- `pnpm build`: successful. `pnpm --filter web js-budget`: every page within budget; `/catalogue` sits exactly at its 245 kB (it went 0.05 kB over with the activity sheet's first version of the project values, so those read their words through `t.has()` rather than four new value lists in the browser).
- 0241 was edited after it first ran here (the person check of the two definers); the new bodies were applied to this database by hand and its recorded hash updated, so the suites ran on the file as committed. A fresh database at integration will apply it as written.

**Decisions the brief left open:**
1. **Hand creation and drafting share one definer** (`app.create_project()`), since a Project Manager does not read orders under the order policies and the workers must not (ADR 0020). The `projects.write` path asks `app.request_is_person()`, so `agent:orchestrator` (which declares `projects.write:entity`) makes no project even past the command's `peopleOnly`.
2. **The number is drawn inside a savepoint** with the make: a delivery that finds the order already has its project rolls its number back, so the series stays gapless under concurrent deliveries.
3. **Once per order**: drafting skips an order that ever had a project, cancelled ones included; a Project Manager can still make a new one by hand after a cancel (one project not cancelled per order, a partial unique index).
4. **Default steps when no checklist is published**: the five keys of `STANDARD_MILESTONES` (now `WORKSHOP_DEFAULTS.projects.standardSteps`) are copied with `title` null; the screens will name them from `en.json` (`projects.defaultSteps.*`), so no English sits in the database. `template_version_id` is null for them.
5. **Templates are publish-only**: each publish is a new immutable version (append-only trigger), current from then on; no drafts. Steps hold `key`, `title`, `requires` (document requirement keys for J3).
6. **`projects.project.assign`** (not in the brief's list, which names the machine's events): names the owner and replaces the people on the project, each a person with a role in the company; without it nobody could be assigned, so `own` would be empty. Crews join with J5 (no `crew_id` yet).
7. **Scopes on the machine**: `create`, `hold`, `resume`, `complete` and `cancel` need `projects.write` for the company; only `milestone.complete` is open at `own` (the engineer on the project). These transitions were already marked proposed.
8. **`documents_missing`** reads the stub `app.project_missing_documents(project_id, step_key) returns setof text` (J3 has not merged; J3's brief names the same signature). The command passes what is missing in the error's details.
9. **PM Surya Ghar** projects are drafted with `flow = surya_ghar`, state `active` and no steps; every standard command refuses them (`project_subsidy_flow`). J4 moves them into its machine's first state; the project page will say the steps come with the subsidy flow.
10. **The scheme** is the order's quote's (`quotes.scheme`, chosen with the sizing); an order without a quote is `none`.
11. **Retention**: 8 years after the project ended, a named default pending the CA (above).
12. **Skip reasons** are answered as `{ outcome: 'skipped', because }`, not `reason`, since every `reason:` literal is read as a user-facing error.

**Not done yet (after `continue`):** `app.status_summary()` with projects (item 6), the list and page queries with `EXPLAIN (ANALYZE)`, the screens, Account 360 and the order page, `nav.ts`, Settings › Project steps, the journeys, the design's Built record, a web-level test of the drafting worker, `pnpm build` and the JavaScript budget.

**For the lead:** 0241 redefines `app.platform_only_permissions()` (0222's nineteen keys plus `projects.draft`) and `app.next_document_no()` (0201's body plus `project`); check both against any slice of this wave that redefines them (U2, H2, Q1, R3) at the merge. `sales.order.confirmed`'s worker entry in `workers/events/registry.ts` and its catalogue meaning now include the drafting.

## Review

## Integration
