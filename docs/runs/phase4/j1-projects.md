# J1 Projects and the standard flow (Phase 4, wave 1)

| | |
|---|---|
| Branch | `feat/j1-projects` on GitHub, from `main` after the approved design (#295) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): row security with a new `own` scope, a platform-only drafting worker |
| Usage | briefed 27-11-2026; built from 27-11-2026 on Opus 5.5 at high effort, on the seat's own account; the fix round on 27-11-2026, Opus 5.5 at high effort |
| State | integrated |
| Next step | the pull request merges on green (the owner's `checks-ok` is on) |

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


### 27-11-2026, seat (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332): done
The lead accepted the early check, decisions 1 to 8 included (27-11, 16:25 UTC). Opus 5.5 at high effort. Skills loaded: `add-table` and `add-command` (the early check); no others are named by the brief.

**Built after the early check:**
- **STATUS on WhatsApp** (`0242_j1_status_summary.sql`): `app.status_summary()` is dropped and made again, because its result gains `step_key` and `step_title`, with its grants restored. It adds the customer's own projects that are not cancelled (five, newest first) with their first open step. Against 0201 the only changes are the two new columns (null on the quote and order lines) and the third `union all` branch. Every other line is as 0201 wrote it, which `diff` of the two bodies confirms.
  - `readStatusSummary()` and `StatusLine` gain `project` and `step`.
  - The answer (`workers/messaging/answers.ts`) prints "Project <no>: in progress, next step <step>". `whatsappAnswers` gains the project states and the default steps' names, and the heading and the empty sentence now name projects.
- **Reads** (`packages/domain/src/queries/projects/list-projects.ts`):
  - `listProjects` (keyset by `(updated_at, id)`, filtered by state, segment, owner and current step);
  - `ownProjectIds`, `projectListQuery`, `listProjectFilters` and `getProject`;
  - `accountProjects`, `orderProject`, `listProjectTemplates` and `listProjectPeople`.
  - Contracts are in `packages/contracts/src/projects/reads.ts`.
- **`app.project_customers(project_ids)`** (`0243_j1_project_customers.sql`): a Field Engineer reads no customer row, so the project screens read the customer's name and the site's village, district and PIN of the projects the caller reads through this definer. It answers for `projects.read:entity` in a company of the request or `app.project_is_mine()`, and never returns a phone or an address line. It is executable by `app_user` and `app_reader`.
- **List indexes** (`0244_j1_projects_list_order.sql`, generated): `projects(entity_id, updated_at, id)` is new, and `projects(entity_id, state, updated_at, id)` replaces 0240's index of the same name. Both are read backwards.
- **Actions** (`apps/web/src/actions/projects.ts`): seven named queries and eight commands, each in a request narrowed to its company.
- **Screens:**
  - `/projects` (`components/projects/projects-screen.tsx`): filters for company, status, business line, project manager and current step; Load more.
  - The project page `/projects/<company>/<id>`:
    - the header shows the status, customer, village, company, business line, scheme, project manager, people and order;
    - a Project Manager or General Manager gets the moves Put on hold, Resume, Complete, Cancel and Change people (`project-actions.tsx`);
    - the tab frame is `PROJECT_TABS` in `screens/projects.ts` plus `TAB_PANELS` in the page, one line each for later slices;
    - the Steps tab (`milestones-panel.tsx`) shows Mark done on the next step for a manager or the engineer on the project;
    - a PM Surya Ghar project shows that its subsidy steps are tracked apart from the checklist.
  - Settings › Project steps (`steps-screen.tsx`): each business line's current steps for a company, and the Executive's editor (name, add, move, remove, Publish). Kept steps keep their key and requirements; a new step's key comes from its name (`stepKeyFrom()`).
  - Account 360's Projects (`account-projects.tsx`, passed to `AccountScreen` as `projects`).
  - The order page's link to its project, or Start project for a manager on a confirmed order without one (`start-project.tsx`, through `OrderScreen`'s new `project` slot).
  - Menu entries Projects (`projects.read:own`) and Project steps (`projects.write:all`). Also: `BOS_PREFIXES`, `CLIENT_SCOPES`, `en.json` `projects` and `projectSteps`, and the copy-lint button keys.
- **Documents:**
  - the design's Built (J1) line under §6.1;
  - DATABASE §4.1 (`app.project_customers()`), §7 (the list indexes and the own-scope read);
  - SECURITY §3.2 (the customers definer) and the STATUS line in §11;
  - the workshop pack (PROJ-2 today, and FIN-2's 8 years for projects with the CA);
  - `db:docs` and `machines:docs` regenerated.

**`EXPLAIN (ANALYZE, BUFFERS)` of `/projects` at volume** (`packages/domain/tests/spike/projects-explain.ts`, run with `pnpm --filter @shakti/domain exec tsx tests/spike/projects-explain.ts`; it removes what it made):
- **Volume:** 35,000 projects (20,000 in company 1), 175,000 steps, 69,662 assignments. The Field Engineer is on 12 projects of company 1.
- **The problem:** read by the policy alone, the Field Engineer's list calls `app.project_is_mine()` once per project of the company. Every project of company 1 under the policy alone takes 234.9 ms (19,988 rows removed by the filter). The first version of the list query added an own filter of its own, but the row policy runs ahead of a filter that is not leakproof, so the first page took 237.7 ms.
- **The fix:** the list now finds the caller's own projects first (`ownProjectIds()`: the owner index and the assignments index, 0.6 ms) and names them by id. That is an index condition, which runs ahead of the policy.

| Read | Execution time | Plan |
|---|---|---|
| Field Engineer, first page | 1.2 ms | `Index Scan using projects_pkey … Index Cond: (id = ANY ('{…12 ids…}'::uuid[]))`, then a sort of the 12 |
| Field Engineer, active at the install step | 1.1 ms | same |
| Project Manager, first page | 0.9 ms | `Index Scan Backward using projects_entity_updated_idx` (12.1 ms before the index) |
| Project Manager, on hold | 1.0 ms | |
| Project Manager, own projects of a segment | 1.0 ms | |
| Project Manager, current step install | 1.9 ms | 143 ms with a join to `principals`, which the planner looped over the scanned rows; the owner's name is now a scalar subquery per listed row |
| `app.project_customers()` for a page of 50 | 2.0 ms | |

**Tests added since the early check:**
- `packages/domain/tests/commands/projects.test.ts` gains 5 read cases (now 21):
  - the manager's list by state, segment, owner and step, newest first;
  - paging by cursor without a repeat;
  - the engineer's list and page (only their project, with the customer and village through the definer; another company refused);
  - Account 360 and the order link (none for a seller without `projects.read`, none for an order without a project);
  - checklists, filter choices and people (refused to an engineer).
- `reader-parity.test.ts` covers the seven new reads on both pools.
- `packages/db/tests/security/projects.test.ts` gains STATUS with projects (the cancelled project left out, nothing for another company, refused without `messaging.process`), now 89 cases. `grants.test.ts` lists the new definer.
- `apps/web/tests/projects.test.ts` (2 cases): the `sales.order.confirmed` worker drafts a farmer-pumps order's project once over three deliveries, and nothing for a dealer's sale.
- `apps/web/src/screens/projects.test.ts` (3 unit cases); `answers.test.ts` covers project lines; `contract-values.test.ts` covers the four value lists and the default steps.
- **Journeys** (`apps/web/e2e/projects.spec.ts`, seed `e2e/setup/projects.ts`, people `projectManager` and `fieldEngineer` in `support/users.ts`):
  - the Project Manager finds the drafted project, marks the first two steps done in order (only the next step offers Mark done), is refused a hold without a reason, puts it on hold and resumes it;
  - the Field Engineer sees exactly the three projects they are on and none of the manager's, sees Mark done but none of a manager's moves, and gets the not-found screen for a project they are not on;
  - the Executive opens Settings › Project steps for the snapshot company and its editor, without publishing.
  - Each has axe checks and the snapshots `project-page`, `project-hold-dialog`, `projects-engineer`, `project-page-engineer` and `project-steps`.

**Checks:** all on Postgres 54332, through `tools/integration/heavy.sh`:
- `pnpm test:security`: db 63 files, 1886 tests passed; domain 111 files, 1540 passed; web 40 files, 463 passed. Exit 0, after removing the seed's stray row (below).
- `pnpm typecheck`: 10 of 10 tasks successful.
- Unit tests: contracts 340, db 162, domain 2811 and web 1245 passed (1 skipped).
- `pnpm lint`, the whole repository through the lock as the final check: clean, exit 0.
- `pnpm copy-lint`: clean. `pnpm db:docs` and `machines:docs`: regenerated, with no change left over.
- `pnpm build`: successful. `pnpm --filter web js-budget`: every page within its budget (68 pages), with the budget changes below.

**Not run on this seat:**
- **The journeys:** this VM has no Playwright browser (`~/.cache/ms-playwright` is absent, and installing one is a download I may not make). `pnpm --filter web e2e:seed` ran and made the project fixtures (exit 0). The lead runs the journeys and makes the Linux baselines.
- **The pages in a signed-in browser:** they were not opened here. They typecheck, lint, build and pass the page-guard, client-namespace and query-name tests.

**For the lead:**
- **`checks-ok` needed:** `apps/web/js-budget.json` changed. It adds the three new pages at their measured size plus 5 %, and raises `/catalogue` (to 246) and `/admin/integrations` (to 242) by 1 kB each for the shell's two new menu entries. That is a checks file, so this pull request needs the owner's `checks-ok`.
- **`app.status_summary()` is dropped and made again**, because its result type changes. A slice of this wave that also redefines it must carry the two new columns.
- **`OrderScreen` gains an optional `project` prop**, and `order-screen.tsx` and the order page each change in two places. H2 may touch the same files.
- **Shared registration points:** `nav.ts` (two entries), `session-gate.ts` (`/projects`), `client-namespaces.ts`, `en.json`, the copy-lint config and `js-budget.json` each carry the J1 lines.
- **A stray seed row:** running the journeys' seed on this database left the Co-pilot setting of the snapshot company (id `0199e2e0-…a002`), which `alert-counts.test.ts` then refused as a duplicate. That has nothing to do with this slice's code: the suites and the seed share this seat's database. I deleted the row and ran the suite again. A fresh database at integration avoids it.
- **The run file is orphaned:** `tools/integration/check-doc-links.py` reports `docs/runs/phase4/j1-projects.md` as an orphan, since no page links it yet. The run files' index is the lead's.

**Decisions after the early check:**
1. **STATUS leaves out cancelled projects:** the order line already says how the sale stands. The next step is printed only for a project in progress.
2. **The engineer's customer comes through a narrow definer** (`app.project_customers()`, name, village, district and PIN only) rather than widening `crm.account.read` for engineers.
3. **The own-scope list finds the caller's projects first** and names them by id (above). The cap is 1,000 own projects.
4. **The people a manager may name** are everyone with a role in the company (`user_entity_roles`, with names from `principals`). A suspended person is not filtered out: their `users` row is theirs alone to read, and `app.user_is_active()` needs `crm.lead.assign`.
5. **Tabs are links** (`?tab=`), rendered on the server. After each move the page is read again with `router.refresh()`.
6. **The steps editor never shows requirement keys:** J3 will add a picker. A kept step keeps the requirements it had.
7. **Start project lives on the order page** for a confirmed order without a project not cancelled, for `projects.write:entity`. It uses the lead's business line or the one chosen.

### 27-11-2026, seat (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332): fixes
The one fix round: all nine review findings, as the lead's triage says. Opus 5.5 at high effort. No skill is named by the triage; the `add-command` and `add-table` checklists were followed from the early check.

**What changed, by finding:**
1. **The filters' owners at `own` scope.** `listProjectFilters` now reads the owners of the caller's own projects named by id (`ownProjectIds()`), as the list does; the read is `projectOwnersQuery()`, and `ownProjectIdsQuery()` is the own-ids read, both unexecuted so the spike reads their plans. `EXPLAIN (ANALYZE, BUFFERS)` at volume (35,000 projects, 175,000 steps, 69,662 assignments; `tests/spike/projects-explain.ts`):

   | Read | Execution time | Plan |
   |---|---|---|
   | Field Engineer, the filters' owners | 0.9 ms | `Index Scan using projects_pkey … Index Cond: (id = ANY ('{…12 ids…}'::uuid[]))`, hash join to `principals` (was about 235 ms: the policy over every project of the company) |
   | Project Manager, the filters' owners | 7.9 ms | `Index Scan using projects_owner_idx`, merge join to `principals`, 5,000 owned rows |
   | Field Engineer, own ids (finding 8's order) | 1.6 ms | `projects_owner_idx` and `project_assignments_person_idx` merged, then a sort of the 12 by open first and newest change |
   | Field Engineer, first page; active at install | 1.2 ms; 1.7 ms | unchanged from the done report |
   | Project Manager, first page; on hold; own of a segment; step install | 0.8; 1.0; 1.0; 2.4 ms | unchanged |
   | Every project of company 1 under the policy alone (the reference) | 237.8 ms | `app.project_is_mine()` per row |
2. **A cancelled order's project.**
   - `sales.order.cancelled` is now subscribed. Its worker (`apps/web/src/workers/projects/order-cancelled-event.ts`) runs the new platform command `projects.project.cancel_for_order` (`packages/domain/src/commands/projects/cancel-for-order.ts`) as `system:workers` with the platform-only `projects.draft`.
   - A standard project in progress or on hold with no step done is cancelled through the `project_standard` machine's `cancel` (now `system: true`), with the reason `order_cancelled` (`PROJECT_ORDER_CANCELLED_REASON`; the project page shows "Cancelled because its order was cancelled."). It emits `projects.project.cancelled`.
   - Otherwise (a step done, completed, or a PM Surya Ghar project) the project is kept and the new event `projects.project.order_cancelled` (ids only, subscribed, routed to the notify route) gives a new notice kind, `project_order_cancelled`, to the project's owner, or, when it has none who may receive notices, the company's people whose role holds `projects.write` at company scope (Project Managers and General Managers, not the Executive). Once per project. The notice opens the project.
   - Definers (custom migration `0246_j1_review_fixes.sql`): `app.order_cancelled_project()` and `app.cancel_order_project()` (`projects.draft:entity` only), `app.notice_project_people()` (`notifications.send`). Generated migration `0245_j1_order_cancelled_notice.sql` widens the notice type and subject checks (`NOT VALID`, as the migration rules ask).
   - `app.status_summary()` is replaced in place from the branch's latest (0242, which keeps every line of 0201) with one change: the project branch joins its order and leaves out a project of a cancelled order. Diffed against 0242: only that join and its comment differ.
3. **Guards.** `app.projects_guard()` now also refuses a change of `state`, `state_changed_at`, `hold_reason` or `cancel_reason` without `projects.write:entity` or `projects.draft:entity`. The new `app.project_milestones_guard()` lets a caller without `projects.write:entity` change a step only from open to done, marked by themselves (`done_by = app.user_id()`), on a project in progress, with no earlier step open.
4. **The chosen business line is honoured.** `projects.project.create` takes the segment the manager chose, else the lead's; the dialog keeps its "The lead's business line" default.
5. **Surya Ghar rows** in `/projects` and on Account 360 read "Tracked in the PM Surya Ghar steps", not "All steps done".
6. **`projects.milestones.missing` is removed** until J3: a failure reaches the browser without its details, so the list cannot be shown today. J3 adds the sentence with the requirement names.
7. **Step titles in the filter.** `ProjectFiltersDto.steps` is now `{ key, title }`, each key with the newest title published for it (null for a default step never published, which the screen names from the catalogue).
8. **Own ids are ordered:** open projects (in progress or on hold) first, then the newest change, at most 1,000.
9. **Journeys:** `projects.spec.ts` gains "as the Project Manager, an order with no project": Account 360 empty, Start project on the order page (axe, snapshot `project-start-dialog`), the new project's page, the order's link to it, and Account 360's Projects with it (axe, snapshot `account-projects`, its number masked). The seed adds per journey project a confirmed order of a customer of its own, and removes the projects a journey started with the seed's orders.

**Tests added or changed:**
- `packages/db/tests/security/projects.test.ts` (89 → 93): an engineer's direct change of state, hold or cancel reason, or `state_changed_at` refused (42501) and a manager's allowed; an engineer's step done as themselves in order allowed, and done for someone else, out of order, skipped, reopened, or on a held project refused; `app.order_cancelled_project()` and `app.cancel_order_project()` for the platform only (refused to the Project Manager, Executive, Field Engineer, an agent and the platform of another company), cancelling only a project of a cancelled order; `app.notice_project_people()` refused without `notifications.send`; STATUS leaves out project C, whose order is cancelled. The fixture gains project A's second step and, under its own prefix, a cancelled order with project C. The existing engineer write case now touches `updated_at` (its old `state_changed_at` is refused by the guard, as it should be).
- `packages/domain/tests/commands/projects.test.ts` (21 → 27): the chosen business line over the lead's; the own ids open first; the filters' step titles and an engineer's owners; `cancel_for_order` cancels a held project with no step done once (a replay emits nothing), keeps one with a step done and tells its owner once (two notify runs), tells the company's managers and not the Executive or the engineer when it has no owner, keeps a Surya Ghar project, leaves a live order's project, and is refused to people, agents and the platform of another company.
- `apps/web/tests/projects.test.ts` (2 → 4): the `sales.order.cancelled` worker cancels once over three deliveries; it keeps a project with a step done, and the notify worker's notice reaches the company's Project Manager.
- `agent-refusals.test.ts` lists the new command in the platform's work; `catalogue.test.ts` the two new subscribed types; `notices.test.ts` the notice's link.
- The generated `machines.test.ts` case "project_standard refused to the platform: cancel" is gone, since the platform may now fire `cancel` (domain unit 2811 → 2810).

**Checks** (Postgres 54332, every one through `tools/integration/heavy.sh`):
- `pnpm test:security`: db 63 files, 1890 tests passed; domain 111 files, 1546 passed; web 40 files, 465 passed. Exit 0.
- `pnpm typecheck`: 10 of 10 tasks successful.
- Unit tests: contracts 340, db 162, domain 2810 and web 1246 (1 skipped) passed.
- `pnpm exec eslint --max-warnings 0` on every folder touched: clean. Whole-repository `pnpm lint`, the final check: clean, exit 0.
- `pnpm copy-lint`: clean. `pnpm db:docs` and `machines:docs`: regenerated and committed.
- `pnpm build`: successful (web cache miss). `pnpm --filter web js-budget`: every page within its budget (68 pages; `/projects` 239.2 of 251 kB).
- **Journeys:** `pnpm --filter web e2e:seed && pnpm --filter web exec playwright test e2e/projects.spec.ts`: 29 passed (the sign-in setup and four journeys on desktop light, dark and phone), none flaky. There are no baselines yet, so Playwright wrote the pictures, which I looked at and removed; none is committed.
- 0245 was edited after it ran here (`NOT VALID`); it was applied again as on disk and its recorded hash updated, so the seed's check that every migration is applied as written passed. A fresh database applies it as written.

**Decisions the triage left open:**
1. **Finding 4: honour the choice** (not hide it): the dialog already offers "The lead's business line" as its default, so a manager who picks another line means it.
2. **A Surya Ghar project of a cancelled order is kept and its manager told**, since its flow is J4's; a completed project is kept too.
3. **The platform's cancel reason is a code** (`order_cancelled`), shown in words on the project page; it is not written to the activity log's fields, whose action name says it.
4. **Without an owner, the notice goes to the company's Project Managers and General Managers** (`projects.write` at company scope), not the Executives (`all`).
5. **The fixes are two new migrations** rather than edits to 0241 and 0242, so this database needed no rebuild; the lead renumbers them after `main`'s.

**For the lead:**
- `main` now has `0240_x4_stock_reasons`; this branch's migrations move after it at the merge, 0245 and 0246 included.
- 0246 redefines `app.projects_guard()` and `app.status_summary()` (the latter from 0242's body).
- `sales.order.cancelled` and `projects.project.order_cancelled` are now subscribed. The publisher makes their QStash URL groups on first use; `projects.project.order_cancelled` goes to the notify route.
- New shared lines: `notifications.ts` (a notice kind, a subject type, a notice event), `notify.ts`, `notify-event.ts`, `qstash.ts`, `notices.ts`, the worker registry and `en.json` (`notifications.types`, `pushAlerts`, `activity`).
- The run file stays orphaned for the document link check (the index is the lead's).

## Review

### 27-11-2026, slice reviewer (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332), Tier A
Reviewed `git diff origin/main...feat/j1-projects` at `11c3a2fc` (main at `59736c74`; main gained only documents since the branch point, no migration). Opus 5.5 at high effort.

**Verdict:** no critical or high finding; the slice may merge once the lead has weighed the mediums below (each is a small fix).

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| 1 | Medium | `packages/domain/src/queries/projects/list-projects.ts:266` (`listProjectFilters`, the owners read) | The list's own-scope fix (`ownProjectIds()` named by id) was not applied to the filter choices. For a caller at `own` scope the owners read scans every project of the company and the policy calls `app.project_is_mine()` once per row. The `EXPLAIN` covers the list only. | A Field Engineer opens `/projects` in a company with 20,000 projects. The page runs the filters beside the list and pays about 235 ms for the policy-only scan (the builder's own measurement of that path) on every load and every filter change. Plan read here as the engineer: `Index Scan using projects_entity_state_updated_idx … Filter: (… OR ((InitPlan 3).col1 AND app.project_is_mine(id)))`. | For a caller without `projects.read:entity`, restrict the owners read to `ownProjectIds()` (`p.id = any(...)`), or skip the owner filter for own-only callers, who see only their own projects anyway. Add it to `tests/spike/projects-explain.ts`. | confirmed (plan read on this database) |
| 2 | Medium | `packages/db/migrations/0242_j1_status_summary.sql:49`; no worker on `sales.order.cancelled` | A confirmed order can still be cancelled (`sales-order` machine: `cancel` from `confirmed` while nothing is dispatched, `cancel-order.ts`), but its drafted project stays `active`. STATUS filters only `p.state <> 'cancelled'`, never the order's state. | A farmer-pumps order is confirmed, its project is drafted, and the order is cancelled the next day. The customer sends STATUS and reads "Order …: cancelled" and then "Project …: in progress, next step site survey". The project also stays in the Project Manager's active list. | Have STATUS leave out a project whose order is cancelled (join `sales_orders` in the third branch: one line). As a follow-up, cancel or flag the project on `sales.order.cancelled` (a platform step or a notice to its Project Manager). | confirmed (code path read) |
| 3 | Low | `packages/db/migrations/0241_j1_projects_rls.sql:104`, `:114`, `:161` | Row security lets an `own` writer (a Field Engineer on the project) change the project's `state`, `hold_reason` and `cancel_reason`, and any step's `state`, `done_at` and `done_by`. `app.projects_guard()` guards only `owner_id`, so hold, cancel and complete are enforced by the commands alone. SECURITY §3.2's Projects paragraph reads as if the database held that line too. | A future path that writes through the request role outside these commands (a field-app sync handler in F2, say) lets an engineer cancel a project or reopen a done step. No path does so today. | Extend `app.projects_guard()` to refuse a change of `state`, `hold_reason` or `cancel_reason` without `projects.write:entity`. Add a step guard so that, without that grant, a step moves only from `open` to `done` with `done_by = app.user_id()`. Add a test for each. | confirmed (policies and the engineer's `update` in `projects.test.ts` succeed) |
| 4 | Low | `packages/domain/src/commands/projects/create-project.ts:232`; `apps/web/src/components/projects/start-project.tsx` | Start project offers every business line, but the command ignores the one chosen whenever the order's lead has an install segment (`installSegment(facts.segment) ?? input.segment`). | A manager picks Commercial solar projects for a farmer-pumps lead's order. They get a farmer-pumps project with the farmer-pumps steps, and nothing tells them. | Refuse a named segment that differs from the lead's (a new reason with its sentence), or offer the choice only when the order has no install segment. | confirmed (code read) |
| 5 | Low | `apps/web/src/components/projects/projects-screen.tsx:135`, `account-projects.tsx:19` | A row with no open step shows "All steps done". A PM Surya Ghar project has no steps until J4. | Every Surya Ghar project reads "All steps done" in `/projects` and on Account 360 from the day it is drafted. | When `flow` is `surya_ghar`, show the subsidy-flow words (as the project page does). | confirmed |
| 6 | Low | `apps/web/messages/en.json:7015` (`projects.milestones.missing`) | The key is never used. A `documents_missing` refusal shows only the generic `errors.documents_missing` sentence, without the `details.missing` list the command builds. | When J3 replaces the stub, an engineer refused Mark done is not told which documents are missing. | Show `details.missing` through this key, or remove the key until J3. | confirmed |
| 7 | Low | `apps/web/src/components/projects/projects-screen.tsx` (step filter), `use-step-name.ts` | The step filter names a published step by its key in words (`wordsOf(key)`), not by the Executive's title, because `listProjectFilters` returns keys only. | An Executive publishes "Net meter fitted (DISCOM)". The filter shows "net meter fitted discom". | Return each key's newest title with the filter choices. | confirmed |
| 8 | Low | `packages/domain/src/queries/projects/list-projects.ts:206` | `ownProjectIds()` takes `limit(1000)` with no order. | An engineer on more than 1,000 projects over the years (completed ones included) loses arbitrary projects from their list, active ones possibly among them. | Order by the newest change (or prefer projects not completed), or page through the ids. | plausible |
| 9 | Low | `apps/web/e2e/projects.spec.ts` | No journey covers Account 360's Projects section or the order page's Start project dialog and link, so neither has axe checks or snapshots (design §13). The journeys' Project Manager project is seeded straight into the tables, not drafted by the worker; the web test covers the worker. | An accessibility fault in the Start project dialog goes unseen. | Add both to an existing orders or customers journey. | confirmed |

**For the lead at integration (not findings in this slice):**
- `app.status_summary()` is diffed against main's latest (0201), and every line is kept: the quote and order branches only gain `null::text, null::text`, and the revoke and grant are identical. No other branch on GitHub redefines it today.
- Other wave branches redefine the same functions and check:
  - `app.platform_only_permissions()`: `feat/h2-reservations`, `feat/fn1-proformas`, `feat/tc2-tally-ingest` and `feat/u2-purchase-orders`;
  - `app.next_document_no()` and `document_sequences_doc_type_check`: `feat/r3-warranty` and `feat/u2-purchase-orders`.
  
  Whichever merges later must carry `projects.draft` and the `project` doc type.
- 0240 is a generated migration with `NOT VALID` added by hand to the widened doc-type check. That is harmless, but the constraint stays unvalidated.
- `js-budget.json` changed: the pull request needs the owner's `checks-ok`.

**Checked and sound:**
- **Isolation:**
  - The four tables are in `ENTITY_TABLES`, with fixture rows per company and matrix rules on both pools. The `NARROWER` grants are listed, and `enum-sync` covers the new values.
  - The policies fail closed (`app.entity_ids()` null denies). The children are read through the parent, and the reader's definers (`project_is_mine`, `project_customers`, `project_missing_documents`) are granted to `app_reader`.
  - There is no insert path for projects or steps outside `app.create_project()`. The column grants are narrow.
- **Definers:**
  - Every new one sets `search_path = ''` and revokes execute from `public` and `readonly_reporter`.
  - `app.project_is_mine()` is the documented exception (DATABASE §4.1).
  - `app.platform_only_permissions()` holds 0222's nineteen keys plus `projects.draft`.
  - `app.next_document_no()` is 0201's body plus `project`.
- **Commands:**
  - All nine are registered. Each has its denied, wrong-company and happy-path tests.
  - The eight people's commands are `peopleOnly` and in the refusal sweep. The draft command is in the sweep of the platform's work.
  - Every `auditFields` key is labelled. The events carry ids only and come from the catalogue.
  - No agent drafts: `projects.draft` is platform-only in code and in the database, and `app.create_project()` asks `app.request_is_person()` on the `projects.write` path.
  - Cost permissions are untouched.
- **Drafting idempotency:**
  - The order is locked `for update` inside `app.create_project()`, and the existence check runs under the lock, so concurrent deliveries serialise.
  - The number is drawn in the same savepoint and rolled back when nothing is drafted.
  - A hand-made project racing a draft ends in `projects_sales_order_live_unique` (`project_exists`).
  - A replay after a cancellation drafts nothing.
  - The workers' principal takes `projects.draft` from `SYSTEM_MATRIX` in code, so no seed step gates it on a hosted environment.
- **Own scope on every route:**
  - `/projects`, the project page, Account 360 and the order link all read under the row policies.
  - The page refuses a company outside the principal, and `getProject` answers not found for a project the caller is not on.
  - An engineer reaches no customer or order screen (no `crm.account.read`). The customer facts come only through `app.project_customers()` (no phone or address line).
  - `listProjects` and the page decide "own only" by the same `hasGrant(…, 'entity')` rule.
- **Templates:** they are append-only (trigger, no update or delete grant). A publish race ends in `project_template_changed`, and a running project keeps its copied steps (domain test).
- **Web layer:**
  - Reads go through `executeQuery()` with names, and writes through `executeCommand()` with each form's key (`useCommand`).
  - The menu pages use `screenAccess(navRequires())`. Browser code imports only types from the contracts.
- **Copy:** every new string is in `en.json` and the button keys are in the copy-lint config.

**Suites run here** (on this slot's fresh database, 54332, after `pnpm db:migrate` and `pnpm db:seed`, through `tools/integration/heavy.sh`): 0240 to 0244 applied as committed.
- `@shakti/db` `test:security`: 63 files and 1,886 tests passed. Among them `projects.test.ts` (85), `role-entity-matrix.test.ts` (93), `grants.test.ts` and `enum-sync.test.ts`.
- `@shakti/domain` `test:security`: 111 files and 1,540 tests passed. Among them `commands/projects.test.ts` (21), `agent-refusals.test.ts` and `reader-parity.test.ts`.
- `web` `test:security`: 40 files and 463 tests passed (exit 0). It was run on its own: the first combined run was stopped by the session's 30-minute limit for a background task, part-way through the web suite, with no test failed. That stop left this slot's heavy-command lock behind with no process holding it, and it was removed by hand.

**Could not check here:**
- **The journeys** (`apps/web/e2e/projects.spec.ts`: the Project Manager's steps, hold and resume; the Field Engineer's own list and the not-found page; the Executive's Project steps editor): not run, since this session cannot sign in.
- **The Linux baselines** (`project-page`, `project-hold-dialog`, `projects-engineer`, `project-page-engineer` and `project-steps`, each in light, dark and phone): they do not exist yet, so the layout check waits for them at integration.
- **`pnpm build` and `js-budget`:** not re-run.

**The lead's triage (27-11-2026): fix all nine in the one fix round.**
- **1:** the owners read uses `ownProjectIds()`, as the list does. Re-take its `EXPLAIN` at volume.
- **2:** a worker on `sales.order.cancelled`, as `system:workers` with the platform-only `projects.draft`, cancels the order's drafted project when no step is done, with the reason "order cancelled". When a step is done, it leaves the project and notifies its owner.
  - `app.status_summary()` also leaves out a project whose order is cancelled.
  - Tests for both branches. Redefine `status_summary` from `main`'s latest.
- **3:** `app.projects_guard()` refuses a change of `state`, `hold_reason` or `cancel_reason` unless the caller holds `projects.write:entity` (or is the workers principal, for 2). A step's `state`, `done_at` and `done_by` change only through `milestone.complete`'s path: an `own` writer may only mark a step of their own project done, in order. Tests: an engineer's direct update refused.
- **4:** honour the chosen segment, or hide the choice when the lead's segment decides it. Say which.
- **5 to 9:** as the review says.
- **No re-check:** the lead reads the diff.

## Integration

### 27-11-2026, Integration prep (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54331): blocked
- **`main` taken:** `fc42a09f` (#299, Q1 labels; X4 stock reasons before it), by the merge commit `b708ed3e` (slice-integration §5). Conflicts resolved with `merge-union.py` (the e2e seed, `contract-values` and its test, the event catalogue test, `workshop-defaults` and its test, reader parity; each hunk read by hand, and the closing brace of J1's `projects` block put back in both halves of `workshop-defaults.ts`), `merge-json.py` (no key changed on both sides), `merge-copylint.py`, and by hand in `05-database.md` (`main`'s `app.stock_move()` row kept, J1's rows after it). `pnpm install --offline --frozen-lockfile`, then `renumber-migrations.mjs`; `pnpm db:generate`: "No schema changes, nothing to migrate"; `pnpm db:docs` and `machines:docs` regenerated `docs/data/` and `docs/state-machines/` (70 event types, 24 with a worker).
- **Migrations:** 0240 to 0246 move to 0243 to 0249 (`0243_j1_projects`, `0244_j1_projects_rls`, `0245_j1_status_summary`, `0246_j1_project_customers`, `0247_j1_projects_list_order`, `0248_j1_order_cancelled_notice`, `0249_j1_review_fixes`), journal times after `main`'s last (0242) and rising; `main`'s 0240 to 0242 snapshots unchanged. `05-database.md`'s J1 citations moved to the new numbers (`main`'s 0240 to 0242 citations left as they are).
- **Redefinitions, each against `main`'s latest:**
  - `app.platform_only_permissions()` (0244) against 0222: every key kept, plus `projects.draft`. No later `main` migration redefines it.
  - `app.next_document_no()` (0244) against 0201: every line kept, plus the `project` series (`projects.write:entity`, or the platform's `projects.draft`).
  - `app.status_summary()` (0245 drops and creates it, 0249 replaces it) against 0201: every branch kept, plus the project branch and its two columns; grants as 0201's (revoked from `public` and `readonly_reporter`, granted to `app_user` and `app_reader`).
  - `document_sequences_doc_type_check` (0243) against 0007: every type kept, plus `project`.
  - `notifications_type_check` and `notification_preferences_type_check` (0248) against 0228: every type kept, plus `project_order_cancelled`; `notifications_subject_type_check` (0248) against 0184: every type kept, plus `project`.
  - Foreign keys: the slice adds keys only on its own four tables and redefines none of `main`'s.
- **Shared lists:** no key used twice in `en.json`, `copy-lint.config.json`, the journey users, the worker registry or the reader-parity list. The matrix fixture's offset `per(e, 0x90)` is now both Q1's `label_sheet` file and J1's project, in different tables, as `main` already shares 0x19 and 0x82 between a file and another table; left as it is.
- **Typecheck right after the merge** (through the lock): `Tasks: 10 successful, 10 total`.
- **Part 1** (`install lint format copylint generated typecheck`): `=== INTEGRATION FAILED`. install, lint (all four parts), copylint ("catalogues and templates are clean"), generated ("No schema changes, nothing to migrate") and typecheck (10 of 10 tasks) passed; **format failed**:

  ```
  [warn] packages/domain/src/index.ts
  [warn] Code style issues found in the above file. Run Prettier with --write to fix.
  ```

  The line is the slice's own, unchanged by the merge: `export { projectStandardMachine, STANDARD_MILESTONES } from './state-machines/machines/project-standard';` (106 characters) fails `prettier --check` at the slice's pre-merge commit `ba4c39ad` too. `pnpm exec prettier --write packages/domain/src/index.ts` splits it over four lines and changes nothing else; not applied, as the fault is outside the merge.
- **Parts 2 to 4** (`unit`, `security dbverify`, `audit build jsbudget gitleaks`) not run: stopped at part 1's failure, so no unit or security suite counts.

### 28-11-2026, Integration prep (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332): prepped
- **The earlier blocker is gone:** the lead's Prettier fix `0f8c9cf3` splits the `project-standard` export in `packages/domain/src/index.ts`; `prettier --check` on it passes, and part 1's `format` step below passes on the whole repository.
- **`main` taken:** `4338c5e7` (#302 demo-data-ist-day; #301 the 27-11 status documents before it), by the merge commit `fd5a7488` (slice-integration §5). No conflict: `main` changed only documents, `apps/web/tests/demo-data.test.ts` and `packages/domain/tests/queries/catalogue-queries.test.ts` (both now read every page of the price lists), none of them J1's files. `pnpm install --offline --frozen-lockfile` ("Lockfile is up to date"), then `renumber-migrations.mjs origin/main 0f8c9cf3`; `pnpm db:generate`: "No schema changes, nothing to migrate"; `pnpm db:docs` rewrote `docs/data/` with no change.
- **Migrations:** `main` added none since 0242, so the numbers stand at 0243 to 0249 (`0243_j1_projects`, `0244_j1_projects_rls`, `0245_j1_status_summary`, `0246_j1_project_customers`, `0247_j1_projects_list_order`, `0248_j1_order_cancelled_notice`, `0249_j1_review_fixes`), journal unchanged. The script gave the seven snapshots new `id`s with nothing else changed; the branch's own snapshots were kept instead (the same content, the same `prevId` chain from `main`'s 0242), so the merge touches no migration file, and `db:generate` above and part 1's `generated` step ran on them.
- **Redefinitions, each diffed against `main`'s latest (`4338c5e7`):**
  - `app.platform_only_permissions()` (0244) against 0222, the latest on `main`: every key kept; the one difference is `projects.draft` added.
  - `app.next_document_no()` (0244) against 0201, the latest on `main`: every line kept; added only the `project` series (`projects.write:entity`, or the platform's `projects.draft:entity`).
  - `app.status_summary()` (0245 drops and creates it, 0249 replaces it) against 0201, the latest on `main`: the quote and order branches unchanged apart from the two new columns (`step_key`, `step_title`, null for them); the project branch added; grants as 0201's (revoked from `public` and `readonly_reporter`, granted to `app_user` and `app_reader`; 0249 replaces it with the same result, so its grants stand).
  - `notifications_type_check` and `notification_preferences_type_check` (0248) against 0228, the latest on `main`: all 13 of `main`'s types kept, plus `project_order_cancelled`. `notifications_subject_type_check` (0248) against 0184: all seven kept, plus `project`.
  - `document_sequences_doc_type_check` (0243) against 0007, the latest on `main`: all five types kept, plus `project`.
  - Foreign keys: the slice's keys are only on its own four tables (to `accounts`, `customer_sites`, `entities`, `principals`); it redefines none of `main`'s. The slice's ten other definers (`app.project_is_mine()`, `app.create_project()` and the rest) exist nowhere on `main`.
- **Shared lists:** no key used twice in `en.json` or `copy-lint.config.json` (parsed for duplicate keys); none in the journey users, the event catalogue, the worker registry or the matrix fixture beyond what the first prep recorded. `main` changed none of these lists this time.
- **Typecheck right after the merge** (through the lock): `Tasks: 10 successful, 10 total`.
- **Part 1** (`install lint format copylint generated typecheck`): `=== INTEGRATION PARTIAL (install lint format copylint generated typecheck)`. lint (four parts) rc=0; format "All matched files use Prettier code style!"; copylint "catalogues and templates are clean"; generated "No schema changes, nothing to migrate"; typecheck `Tasks: 10 successful, 10 total`.
- **Part 2** (`unit`): `=== INTEGRATION PARTIAL (unit)`; `Tasks: 10 successful, 10 total`. Tests: web 1,265 passed and 1 skipped (169 files), domain 2,815 (112 files), contracts 340 (25), db 162 (12), tokens 146 (3), ui 107 (11), voice 49 (5), voice-agent 23 (5), copy-lint 17 (1).
- **Part 3** (`security dbverify`): `=== INTEGRATION PARTIAL (security dbverify)`. Security suite on a fresh Postgres (54340): db 1,965 passed (65 files), domain 1,562 (112 files), web 470 (41 files). db:verify "every migration is applied as it is on disk".
- **Part 4** (`audit build jsbudget gitleaks`): `=== INTEGRATION PARTIAL (audit build jsbudget gitleaks)`. audit: 3 moderate, all already reviewed and ignored; build with no `.env`: `Tasks: 2 successful, 2 total`; js-budget "Every page is within its budget (68 pages)"; gitleaks over the branch's own 31 commits: "no leaks found".
- **Not run:** the `e2e` step, as the lane says; the journeys and the Linux baselines (`project-start-dialog`, `account-projects`) are the lead's. Nothing was fixed: the merge broke nothing.

### 28-11-2026, Integration prep after J2 (cloud VM, worktree `/home/user/shakti-wt/j1-projects`, Postgres 54332): prepped
- **`main` taken:** `5f5ea1e7` (#300 J2 customer loans, with its migrations 0243 to 0246), by the merge commit `c4643894` (slice-integration §5; pre-merge `b378d6e8`). 40 files conflicted. `merge-json.py` on `en.json` (no key changed on both sides) and `merge-copylint.py` (261 button keys, none twice); `merge-union.py`, each hunk then read, on the testing lists, the matrix fixture, `enum-sync`, `grants`, `role-entity-matrix`, reader parity, agent refusals, the command and machine registries, the audit labels, `contract-values` and its test, the event and QStash worker maps and the notify worker's event map. By hand: the event catalogue and the notify contract (the closing `},` and `}).strict(),` between J1's last entry and J2's first), `notify.ts` (J1's case closed before J2's; its doc comment names both events), the customer page (J2's `Promise.all` of duplicates and loans, then J1's projects), the order page and `OrderScreen` (J1's `project` prop and J2's Loan tab as `children`), `AccountScreen` (both props), `nav.ts` (both admin entries), `/orders`' client groups (`loans` and `projects`), `notices.ts`' doc comment, the `/catalogue` budget reason, the schema's `NOTICE_TYPES` (`main`'s list, then `project_order_cancelled`) and `05-database.md`'s `notifications` row (`main`'s row, plus J1's type, its `project` subject and its migration). `main`'s journal, snapshots and `docs/data/` taken, then `pnpm install --offline --frozen-lockfile` ("Lockfile is up to date"), `renumber-migrations.mjs origin/main b378d6e8`; `pnpm db:generate`: "No schema changes, nothing to migrate"; `pnpm db:docs` and `machines:docs` regenerated `docs/data/` and `docs/state-machines/` (21 files).
- **Migrations:** 0243 to 0249 move to 0247 to 0253 (`0247_j1_projects`, `0248_j1_projects_rls`, `0249_j1_status_summary`, `0250_j1_project_customers`, `0251_j1_projects_list_order`, `0252_j1_order_cancelled_notice`, `0253_j1_review_fixes`), journal times after `main`'s last (0246) and rising; `main`'s 0243 to 0246 files and snapshots unchanged; the last snapshot written by drizzle-kit from the schema. `05-database.md`'s J1 citations moved by four (15 rows); J2's 0243, 0244 and 0246 citations left as they are.
- **Redefinitions, each diffed against `main`'s latest (`5f5ea1e7`):**
  - `notifications_type_check` and `notification_preferences_type_check` (0252) against J2's 0245, now the latest on `main`: **the clash this merge made**: J1's moved SQL listed `main`'s 0228 types plus `project_order_cancelled`, without J2's `loan_rejected`. 0252 edited after the renumbering (slice-integration §10) to `main`'s 14 types plus `project_order_cancelled`, the order the schema and the drizzle snapshot hold; `db:generate` reports no change.
  - `notifications_subject_type_check` (0252) against 0184, still the latest (J2's notice uses `sales_order`): all seven kept, plus `project`.
  - `app.platform_only_permissions()` (0248) against 0222, still the latest: every key kept; the one difference is `projects.draft`.
  - `app.next_document_no()` (0248) against 0201, still the latest: every line kept; added only the `project` series (`projects.write:entity`, or the platform's `projects.draft:entity`).
  - `app.status_summary()` (0249 drops and creates it, 0253 replaces it) against 0201, still the latest: the quote and order branches unchanged apart from the two new null columns; the project branch added; grants as 0201's.
  - `document_sequences_doc_type_check` (0247) against 0007, still the latest: all five kept, plus `project`.
  - `app.order_loan_gate()`: J2's own (0244); J1 does not define or call it. J2's other definers (`app.guard_customer_loan()`, `app.notice_loan_owner()`) and J1's (`app.project_is_mine()`, `app.create_project()`, `app.notice_project_people()` and the rest) share no name.
  - Foreign keys and keys: J2's new `sales_orders_id_entity_account_unique` sits beside J1's `projects_sales_order_fk` on `(id, entity_id)`; J1's keys are only on its own four tables, J2's only on its two; neither redefines one of the other's or of `main`'s.
- **Shared lists:** no key used twice in `en.json`, `copy-lint.config.json` (parsed for duplicates), the audit labels and field kinds, the event catalogue, the command, machine and worker registries, the QStash map, the testing lists, `enum-sync`, `grants`, `role-entity-matrix`, reader parity, the notice types, the menu ids or the journey users, beyond keys `main` itself already has twice in separate maps (`catalogue.pump_curve.set` in `audit.ts`, eleven in `agent-refusals.test.ts`). The matrix fixture's offsets 0x90 and 0x91 are now J1's project and checklist and J2's lender and loan (0x90 also Q1's `label_sheet` file), each in its own table; left as they are, as the security suite below passes.
- **Typecheck right after the merge** (through the lock): `Tasks: 10 successful, 10 total`.
- **Part 1** (`install lint format copylint generated typecheck`): `=== INTEGRATION PARTIAL (install lint format copylint generated typecheck)`. lint rc=0; format "All matched files use Prettier code style!"; copylint "catalogues and templates are clean"; generated "No schema changes, nothing to migrate"; typecheck `Tasks: 10 successful, 10 total`.
- **Part 2** (`unit`): `=== INTEGRATION PARTIAL (unit)`; `Tasks: 10 successful, 10 total`, none cached. Tests: web 1,265 passed and 1 skipped (169 files), domain 2,819 (112), contracts 340 (25), db 162 (12), tokens 146 (3), ui 107 (11), voice 49 (5), voice-agent 23 (5), copy-lint 17 (1).
- **Part 3** (`security dbverify`): `=== INTEGRATION PARTIAL (security dbverify)`. Security suite on a fresh Postgres (54340): db 1,998 passed (66 files), domain 1,586 (113 files), web 470 (41 files). db:verify "every migration is applied as it is on disk".
- **Part 4** (`audit build jsbudget gitleaks`), first run: `=== INTEGRATION FAILED` at jsbudget, which the merge broke: each slice's menu entries passed alone, together `/price-master loads 247.0 kB of JavaScript (gzip), over its budget of 247 kB` and `/calling loads 207.0 kB of JavaScript (gzip), over its budget of 207 kB`. Fixed in `1671f197`: both raised by 1 kB (248 and 208) with the reason. `js-budget.json` is one of the checks files, as J1 and J2 already changed it, so the pull request needs the owner's `checks-ok`. Second run: `=== INTEGRATION PARTIAL (audit build jsbudget gitleaks)`. audit: 3 moderate, all already reviewed and ignored; build with no `.env`: `Tasks: 2 successful, 2 total`, none cached; js-budget "Every page is within its budget (69 pages)"; gitleaks over the branch's own 33 commits: "no leaks found".
- **Not run:** the `e2e` step, as the lane says. The journeys and the Linux baselines are the lead's; J2's Lenders and J1's Projects menu entries together change the menu on the admin screens' pictures, which neither slice's baselines show yet.

### 28-11-2026, the lead's cloud VM: integrated
- **Main taken in** after the second prep: TC1 #303, the axe title wait #304 and the calling-hours fix #305 (`994631ae`), by `f37dd57a`, with no conflict. `main` added no migration, so 0247 to 0253 stand. `db:generate`: no changes.
- **`integrate.sh` on a fresh Postgres on 54340, in four parts through the lock:**
  - `install lint format copylint generated typecheck`: every step rc=0.
  - `unit`: every task.
  - `security dbverify`: db 1,998, domain 1,586 and web 470 passed. `db:verify`: every migration is applied as it is on disk.
  - `audit build jsbudget gitleaks`: every step rc=0.
  - Each part ended `INTEGRATION PARTIAL`.
- **The whole journey set in the Linux Playwright image, one project at a time, each on a fresh database**, update then verify:
  - desktop-light: 241 passed with 1 flaky (the click-to-dial C test on the update run), then 242 passed on verify.
  - desktop-dark: 229 and 229 passed.
  - phone: 229 and 229 passed.
  - The container restarted during the first desktop-light verify. The lock was cleared, and that verify ran again from the start.
- **Baselines:** J1's own (`account-projects`, `project-page`, `project-page-engineer`, `project-steps`, `projects-engineer` and the start and hold dialogs) are new. The home pages, the settings screens and the other screens that show the menu's new Projects and Project steps entries are remade (35 files). Pictures looked at: the project page at phone width and the Executive's home.
  - Copy follow-up: the home cards "Projects" and "Project steps" lack the full stop the other cards' descriptions have.
- **Checks files** (the owner's `checks-ok`): `apps/web/js-budget.json` (`/price-master` 248 and `/calling` 208, the merge's sums).

### 28-11-2026, after F1 merged (the lead's cloud VM)
- **Main taken in:** F1 #306 (`6465a262`), by a merge commit, with conflicts in the lists, the journal and snapshots, `js-budget.json` and the copy-lint config. The lists were joined with `merge-union.py`, each hunk read; one comment opener was put back in `e2e/support/users.ts`. `main`'s journal, snapshots and `docs/data/` were taken.
- **Migrations:** they move after F1's 0252: 0247 to 0253 become **0253 to 0259**, with journal times after F1's. DATABASE's J1 citations are moved by six (15 lines, J1's own lines only). `db:generate`: no changes. `db:docs` and `machines:docs` were rerun.
- **Redefinitions:** F1 redefines none of the shared definers, so J1's checks against `main`'s latest stand as before. The `notifications` checks keep J2's `loan_rejected` with J1's `project_order_cancelled`.
- **`integrate.sh` in four parts on a fresh Postgres:** every step rc=0, each part `INTEGRATION PARTIAL`. Security suites: db 2,015, domain 1,597 and web 500 passed. `db:verify` clean.
  - The first unit run failed on stale data documents, because `db:docs` ran before the citation edit; they were regenerated.
- **The whole journey set in the Linux Playwright image, one project at a time on fresh databases:** desktop-light 244 and 244, desktop-dark 231 and 231, phone 231 and 231. No baseline changed.

