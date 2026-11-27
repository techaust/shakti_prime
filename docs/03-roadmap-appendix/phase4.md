# Backend and product design: Phase 4 (Projects and field)

Date: 27-11-2026.

**Status:** drafted for the owner's approval. Its questions are put in §2 with a recommended option each. The owner took the recommendations with the push's plan on 27-11-2026, to be confirmed with this document.

**How it is built:** slice by slice, in the order of §3. Each slice records what it built here in the same pull request, as the earlier designs do. Progress is in [STATUS](../10-status.md).

**Governing documents:**
- BLUEPRINT §5, §6.3, §7.2, §7.5, §8.5, §8.6, §8.7, §8.11, §9.3, §12 and §16;
- ROADMAP §6;
- PRD PRJ-01 to PRJ-07, WA-01 to WA-03 and FLD-01 to FLD-03;
- DATABASE §6.6, and the planned rows `mobile_devices`, `customer_loans`, `identity_documents`, `expense_claims`, `expense_lines` and `attendance_events`;
- API §1, §3.1, §3.2 and §3.2a, and the contracts in `packages/contracts/src/api/` (`sync.ts`, `mobile-auth.ts`, `attendance.ts`, `expenses.ts`);
- ARCHITECTURE §10;
- SECURITY §2, §3.2, §3.3, §5 and §11;
- ADR 0012;
- the machines `project-standard`, `project-surya-ghar`, `subsidy-gate`, `customer-loan`, `document-filing`, `expense-claim` and `dispatch` in `docs/state-machines/`;
- the workshop items PROJ-1 to PROJ-4 and HR-1;
- [the Phase 3 design](phase3.md).

**Contents:** [1. Scope](#1-scope) · [2. Decisions for the owner](#2-decisions-for-the-owner) · [3. Slices](#3-slices) · [4. New permissions](#4-new-permissions) · [5. The project model](#5-the-project-model) · [6. Wave 1](#6-wave-1) · [7. Wave 2](#7-wave-2) · [8. Wave 3](#8-wave-3) · [9. Wave 4](#9-wave-4) · [10. Workshop defaults](#10-workshop-defaults) · [11. Final-phase verification](#11-final-phase-verification) · [12. Questions for the client](#12-questions-for-the-client-final-phase) · [13. Tests per slice](#13-tests-per-slice) · [14. Gaps and conflicts in the governing documents](#14-gaps-and-conflicts-in-the-governing-documents)

## 1. Scope
**What earlier phases left for this phase:**
- Seven machines are specified and none is in use: `project-standard`, `project-surya-ghar`, `subsidy-gate`, `customer-loan`, `document-filing`, `expense-claim`, and the dispatch machine's loan and DCR guards.
- The permissions `projects.*`, `documents.*` and `finance.expense.*` are in the catalogue and the seed. `agent:orchestrator` and `agent:concierge` already declare their Phase 4 grants.
- The mobile and sync contracts are written (`sync.ts` names thirteen collections and four conflict reasons). No route exists.
- The WhatsApp milestones `visit_booked`, `visit_reminder`, `installed` and `handover_kit` are in the list with no values. Their subjects are only `quote` and `sales_order`.
- The file purposes `job_photo`, `survey_photo`, `qc_photo`, `receipt`, `signature`, `selfie` and `customer_document` exist with no reader and no writer. OCR masking covers only `knowledge` and `whatsapp_media`.
- `customer_sites` holds the place: village, PIN, state, latitude and longitude. `sales_orders` has a site and no segment. The segment lives on the opportunity's pipeline.
- Phase 3 builds dispatch with the loan and DCR guards passing while no project or loan is linked (phase3 §8.1), and the surplus pool with `project_id` null.

**In Phase 4:**
- **The standard install flow:** a versioned milestone checklist per company and segment that an Executive edits without code. A project is drafted from a confirmed order that needs installation.
- **The PM Surya Ghar flow:** its gates as machines; the sanctioned-load lock; DCR/ALMM serial validation before dispatch; rejection and resubmission.
- **The document vault for customers:**
  - requirement templates and completeness gates;
  - customer documents uploaded on the web, by the app and on WhatsApp;
  - every document masked before storage and before any model call, with only the last four digits of an identity number kept;
  - classification by Claude vision with a person below the threshold;
  - DISCOM packs generated from the project's records.
- **Customer loans** and their gates on dispatch and, in Phase 5, on payment milestones.
- **The field scheduling board:** a day and week calendar by engineer or crew; drag and drop with conflict detection (double booking, unavailability, travel time); the unassigned queue; a map; site-visit booking by the Concierge, confirmed by a person; the customer's confirmation and reminder on WhatsApp.
- **QC checklists and sign-off.** Labour and contractor charges as cost lines behind `finance.cost.read`.
- **Handover:** the handover kit on WhatsApp, warranty per installed serial, and the CMC register with its yearly reminder and status report.
- **The Android field app** (`apps/field`):
  - mobile sign-in with device-bound tokens;
  - offline sync with server-authoritative transitions, field-level survey merge, idempotent stock and expense commands, and a conflict review screen;
  - today's schedule, jobs, surveys, checklists, geo- and time-stamped photos, signatures, material arrival and leftovers, QC, attendance and expense capture;
  - background uploads, push, navigation and the minimum-version gate.
- **The STATUS reply on WhatsApp** gains projects (`app.status_summary()`).

**In later phases:**
- Payment milestones with loan gates, expense approval and reimbursement, the approval of attendance regularisation, leave and job costing are Phase 5. Phase 4 writes the records they read.
- The Project Orchestrator's own suggestions (slots, document chasing, SLA alerts) as an agent are Phase 6. Phase 4 builds the deterministic slot finder and the requests it will call.

**In the final phase** (the owner's decision of 13-11-2026), every step that needs the client's people or live accounts:
- the requirement lists per step (PROJ-1) and the steps themselves (PROJ-2);
- the classification threshold after a trial (PROJ-3);
- the travel times and offline days (PROJ-4);
- each DISCOM's own pack formats;
- real document photos for the masking check;
- the Google Play and Expo accounts, EAS builds and the staged rollout;
- the Firebase project for push;
- the production map tiles;
- the pilot with 2–3 engineers on live jobs for two weeks (the exit gate).

Each slice is built and tested now on seeded data. Its live step is a row of §11.

## 2. Decisions for the owner
The owner took every recommendation with the push's plan on 27-11-2026 (questions P4-1 to P4-12 there); this section records them for confirmation with this document.

1. **When a project is made** (J1). **Recommended: (a).**
   - (a) *Recommended:* a project is drafted on the confirmation of an order whose opportunity's pipeline segment needs installation (`farmer_pumps`, `residential_rooftop` or `commercial_epc`, never `dealer_wholesale`) and which names a site. The segment and the scheme are snapshotted onto the project. A Project Manager or General Manager can also create one by hand for any confirmed order.
   - (b) By hand only.
2. **Changing the steps** (J1). **Recommended: (a).**
   - (a) *Recommended:* templates are per company and segment, edited by an Executive, and versioned. A project copies the version current at its creation and keeps it (the machine's `copy_checklist`).
   - (b) Edits apply to running projects.
3. **Government portals and the DISCOM** (J4). **Recommended: (a).**
   - (a) *Recommended:* portal and DISCOM steps are recorded by hand: application numbers, statuses, dates and the documents received. There is no portal API and no scraping.
4. **DISCOM packs** (J10). **Recommended: (a).**
   - (a) *Recommended:* generic SLD, earthing and structural-declaration templates, filled from the project's records with no field typed again (PRJ-03), until the client sends each DISCOM's format.
   - (b) Wait for the formats.
5. **DCR and ALMM** (J8). **Recommended: (a).**
   - (a) *Recommended:* the item's DCR flag and ALMM reference (C5) say a model qualifies. The serial carries its DCR certificate number, typed or scanned at receipt. A subsidy project's material is refused at dispatch and at `material.delivered` for a serial missing either.
   - (b) Per item only.
6. **Travel time and the map** (J5). **Recommended: (a).**
   - (a) *Recommended:* travel time is the straight-line distance between sites × a road factor ÷ an average speed, plus a buffer (named defaults, PROJ-4), with no routing service. The map is MapLibre behind a flag, with a key-based tile vendor on dev and staging only. The production tile account is chosen by the owner in the final phase. Sites without coordinates show in the list by village.
   - (b) No map in Phase 4.
7. **The field app** (F1 to F5). **Recommended: (a).**
   - (a) *Recommended:* ADR 0012 accepted as written: an Expo development build, WatermelonDB on expo-sqlite and 5 days offline. Field engineers sign in once on a device with their email and password (and the authenticator where their role needs it). The device holds a rotating, device-bound refresh token in the Android Keystore. The app opens with a 4-digit PIN or the phone's biometric. A device is revoked from the web.
8. **Attendance and expenses in the app** (F4). **Recommended: (a).**
   - (a) *Recommended:* captured in Phase 4 on the tables DATABASE plans: `attendance_events`, `expense_claims` and `expense_lines`, through the `expense-claim` machine's `create` and `submit`. Approval, regularisation and the export are Phase 5.
   - (b) Both wait for Phase 5.
9. **The classification threshold** (J7). **Recommended: (a).**
   - (a) *Recommended:* 0.85 as a named default (PROJ-3). Below it, or on a customer mismatch, the file waits for a person. For the first two weeks of live use every file waits (the workshop's trial), behind one setting.
10. **Labour and contractors** (J6). **Recommended: (a).**
    - (a) *Recommended:* contractors are a `kind` of vendor (U1's master). Labour and contractor charges are cost lines on the project behind `finance.cost.read`, written by holders of `projects.write` with that grant.
11. **CMC** (J11). **Recommended: (a).**
    - (a) *Recommended:* a CMC record is created at the handover of a PM Surya Ghar project, for 5 years by default, with a reminder to the General Manager each year and a status report.
12. **New packages** (F1, J5). **Recommended: (a).**
    - (a) *Recommended:* the owner approves this list, each pinned to an exact version at least two weeks old, installed by the lead in the slice that first needs it:
      - `expo`, `react-native`, `expo-router`, `expo-sqlite`, `expo-secure-store`, `expo-local-authentication`, `expo-camera`, `expo-location`, `expo-image-manipulator`, `expo-notifications`;
      - `@nozbe/watermelondb`, `nativewind`;
      - `jest-expo`, `@testing-library/react-native`;
      - `@dnd-kit/core`, `maplibre-gl`.

      Any other package asks first.

**Unavailability before leave exists** (J5) is decided by the lead, as engineering: Phase 5 builds leave. Phase 4 adds `unavailability` (person, from, to, kind `leave`, `training` or `other`, recorded by holders of `projects.schedule.write`), which the board's conflict check reads. Phase 5's approved leave writes into it.

## 3. Slices
Each slice is vertical, as in Phases 1 to 3: contract → schema, row security and grants → command → worker, route or server action → screen or app screen → end-to-end test, with its documents. A wave is a dependency tier.

**Sync collections:** each slice adds its own to F2's engine, one entry each, and owns its collection's DTO and conflict rule. Tiers follow [models-and-usage §2](../runbooks/models-and-usage.md#2-slice-tiers).

| Wave | Slice | Needs | Tier | Requirements |
|---|---|---|---|---|
| 1 | J1 Projects and the standard flow | Phase 3's merge of H2 | A | PRJ-01, WA-03 (projects in STATUS) |
| 1 | J2 Customer loans | — | A | CRM-08, BLUEPRINT §8.5 (loan gates) |
| 1 | J3 Customer documents and requirements | — | A | PRJ-03 (completeness), SECURITY §5, §11 items 7–8 |
| 1 | F1 Field app foundation and mobile sign-in | — | A | FLD-03 (version gate), API §3.1, SECURITY §2 |
| 2 | J4 PM Surya Ghar and subsidy gates | J1, J3 | A | PRJ-02 |
| 2 | J5 Scheduling board | J1 | B | PRJ-04 (board, conflicts, queue, map) |
| 2 | J6 QC and labour cost lines | J1 | A | PRJ-05, the QC step of PRJ-02 |
| 2 | F2 Sync engine and conflict review | F1, J1 | A | FLD-02 |
| 2 | J7 Document collection on WhatsApp | J3 | A | WA-02, AI-05 |
| 3 | J8 DCR/ALMM and loan gates on dispatch | J2, J4, D2 | A | PRJ-02 (DCR), BLUEPRINT §8.5 |
| 3 | J9 Visit booking and the customer's messages | J5 | A | PRJ-04 (booking, confirmation, reminder), WA-01 |
| 3 | J10 DISCOM packs | J4 | B | PRJ-03 (packs) |
| 3 | F3 Field jobs in the app | F2, J5, J6, D2 | B | FLD-01, Phase 3 question 7 (arrival) |
| 3 | F4 Attendance and expense capture | F2 | B | FLD-01, API §3.2 (check-in, expenses) |
| 4 | J11 Handover, warranty and the CMC register | J1, J4, D2 | B | PRJ-06, PRJ-07, WA-01 |
| 4 | F5 Uploads, push, navigation and the version gate | F3 | B | FLD-03 |
| 4 | G4 Phase 4 exit pack | all | A | the exit gate's engineering items |

**Shared registration points**, edited by several slices of a wave, one line each, as in Phase 3:
- the event catalogue and worker registry;
- the permission catalogue and seed;
- `MACHINES_IN_USE`;
- the sync collections registry (F2);
- `en.json` and `nav.ts`;
- `turbo.json` and `.env.example`;
- the testing lists and the retention list;
- `WORKSHOP_DEFAULTS`;
- the print registry;
- the file purposes' readers and writers;
- the WhatsApp milestone values.

Migrations are numbered at merge, in merge order.

**Files each slice owns, where two could meet:**
- **Wave 1:** J1 owns `projects`, `project_flow_templates`, `project_milestones`, `/projects` and the project page's frame (tabs added by later slices, one line each). J3 owns `documents`, `document_requirements`, `identity_documents` and the Documents tab. F1 owns `apps/field` (the scaffold, navigation, theme from `packages/tokens`), `/api/v1/auth/mobile/*`, `mobile_devices`, `feature_flags` and `GET /me`.
- **Wave 2:** J5 owns `crews`, `crew_members`, `schedule_slots`, `unavailability` and `/projects/schedule`. F2 owns `/api/v1/sync/*`, the app's database and sync loop, and the conflict screen. J6 owns `checklists`, `qc_inspections` and `project_cost_lines`.
- **Wave 3:** F3 owns the app's job screens and `inventory.dispatch.arrive`. F4 owns `attendance_events`, `attendance_sites`, `expense_claims`, `expense_lines`, and the app's attendance and expense screens. J9 owns the Concierge's booking tool.

## 4. New permissions
Each permission gets a row in SECURITY §3.2, its seed and its oracle case, in the slice that first uses it. The keys `projects.read`, `.write`, `.gate.approve`, `.qc.signoff`, `.schedule.write`, `documents.read`, `.write`, `.sensitive.read`, `finance.expense.submit` and `finance.cost.read` are already in the catalogue and the seed, and Phase 4's slices are their first users. A dash means no grant.

| Permission | Executive | GM | Inventory | Project Mgr | Field | Accounts | Agents | Slice |
|---|---|---|---|---|---|---|---|---|
| `inventory.dispatch.arrive` (record arrival and leftovers at a site of the engineer's own job) | all | entity | entity | entity | own | – | – | F3 |
| `field.device.revoke` (revoke a person's phone) | all | entity | – | entity | – | – | – | F1 |

A Field Engineer's `own` scope means the projects and schedule slots they are assigned to, through `project_assignments` (J1). This answers H1's open note: an engineer reads the stock of their own job's dispatch, never a hub's.

**Platform-only grants** (`PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, SECURITY §3.3; ADR 0020):

| Grant | What it is for | Slice |
|---|---|---|
| `projects.draft` | Draft a project from a confirmed order | J1 |
| `documents.classify` | File a WhatsApp document against a requirement, or queue it for a person | J7 |
| `projects.reminders.process` | Send the visit reminder the day before, the yearly CMC reminder, and the document-chasing nudges | J9, J11 |

**Agents:**
- `agent:concierge` gains no grant. It books a visit only through J9's narrow tool, which offers slots from J5's finder and makes a *proposed* booking a person confirms (PRJ-04).
- `agent:orchestrator`'s declared grants are used only in Phase 6.
- No agent principal holds `documents.sensitive.read` or `finance.cost.read`.
- The agent refusal sweep covers every Phase 4 command.

## 5. The project model
- **`projects`:** `entity_id`, `project_no` (series kind `project`, code `PRJ`), `sales_order_id`, `account_id`, `site_id`, `segment`, `scheme` (`none`, `pm_surya_ghar`, `pm_kusum`; from the sizing), `flow` (`standard` or `surya_ghar`), `template_version_id`, `state`, `owner_id` (the Project Manager), `sanctioned_load_kw` (locked at feasibility), `hold_reason`, `cancel_reason`, `handed_over_at`.
- **`project_assignments`:** the engineers and crews on a project, for `own` scope.
- **`project_milestones`:** one row per step of the copied template: `position`, `key`, `title`, `state` (`open`, `done`, `skipped` with a reason), `done_at`, `done_by`, and `requires` (document requirement keys).
- **Subsidy projects:** `subsidy_applications` (one per project: portal and DISCOM numbers and dates) and `subsidy_gates` (one per gate, machine `subsidy-gate`) carry the gate sequence of BLUEPRINT §8.5.
- **Documents:**
  - `document_requirements` holds the requirement templates per flow and step: key, label, mandatory, accepted kinds.
  - `documents` is a customer's or project's filed document: file, requirement, kind, classifier confidence, filed by a person or the classifier, sensitivity.
  - `identity_documents` keeps only the last four digits and the masked file.

  A step or gate closes only when its mandatory requirements are filed (the guard `documents_missing`, naming what is missing).
- **Costs:** labour and contractor charges, as `project_cost_lines`, are restricted. Material cost comes from the ledger's issues to the project's dispatches. Both feed Phase 5's job costing; neither is shown without `finance.cost.read`.
- **Retention:** projects, documents and attendance join the retention list (migration 0142's note) with the periods DATABASE §7 gives, or a named default pending the CA.

## 6. Wave 1

### 6.1 J1 Projects and the standard flow
- **Tables:** `projects`, `project_assignments`, `project_flow_templates` (company, segment, version, steps as JSON validated by a contract, `published_at`, `published_by`) and `project_milestones`. The machine `project-standard` is brought into use: `create`, `milestone.complete`, `hold`, `resume`, `complete` and `cancel`, each a command.
- **Drafting:** on `sales.order.confirmed`, the platform-only `projects.draft` drafts the project (question 1). The order page shows its project. Creating by hand is open to holders of `projects.write` at entity scope.
- **Template editor:** Settings › Project steps, for an Executive. A new version is published, and running projects keep theirs (question 2).
- **Screens:**
  - `/projects`: by state, owner, segment and stage, with a keyset list;
  - the project page: the header, Milestones, and the Documents, Schedule, QC, Costs and Loan tabs that later slices add;
  - Account 360's Projects section.
- **STATUS:** `app.status_summary()` includes the customer's own projects and their current step (WA-03).
- **Acceptance:** PRJ-01's criteria; a drafted project copies the current template; an engineer reads only their own projects on every route.

### 6.2 J2 Customer loans
- **Table `customer_loans`:** `entity_id`, `account_id`, `sales_order_id`, `lender` (a name from a list per company in Settings, else free text), `amount`, `state` (machine `customer-loan`: `applied`, `sanctioned`, `disbursed`, `rejected`), `sanctioned_at`, `disbursed_at`, `reference` and `gates_json`. `gates_json` lists what waits for which state: `dispatch` (default: disbursed) and, in Phase 5, payment milestones.
- **Commands:** `crm.loan.create`, `.sanction`, `.disburse` and `.reject`, with `crm.account.write`. Each is audited and raises its event.
- **Screens:** the Loan tab on the order and project pages, and Account 360's loans.
- **Acceptance:** CRM-08's loan state on the order. A loan-gated order answers its gate as pending until disbursal, read by J8's dispatch guard.

### 6.3 J3 Customer documents and requirements
- **Tables:** `document_requirements` (seeded with the defaults of §10 per flow and step), `documents` and `identity_documents`.
- **File purposes:** `customer_document` gets readers and writers (`documents.read` and `.write` per their scopes; `documents.sensitive.read` for a document marked sensitive, such as bank or identity papers). It joins `MASKED_PURPOSES`, so every customer document passes the OCR masking step before storage and before any model call. An identity number is replaced by its mask, with only its last four digits kept (SECURITY §5).
- **Commands:**
  - `documents.file` attaches a masked, clean file to a requirement of a project or a customer, and refuses a file of another customer (`file_customer_mismatch`);
  - `documents.unfile`;
  - `documents.requirement.set` (Executive) edits the templates.
- **The completeness check:** `app.project_missing_documents(project, step)` is a definer that the milestone and gate guards read.
- **Screens:** the Documents tab (requirements with their state, upload, view masked) and Account 360's documents.
- **Acceptance:** PRJ-03's first criterion. SECURITY §11 items 7 and 8: a file is only ever filed against its own customer, and no identity number's digits survive in storage, logs or a model call, proved by tests over the masking path with generated documents.

### 6.4 F1 Field app foundation and mobile sign-in
- **`apps/field`:**
  - an Expo app with a development build profile, expo-router and NativeWind themed from `packages/tokens` (light and dark), English copy in the app's own catalogue under the copy-lint rules, and Sentry for React Native behind the same scrubbing rules as the web;
  - workspace scripts for typecheck, lint and `jest-expo` tests, run in CI with the other workspaces (a checks change: the owner's `checks-ok`).
- **Mobile sign-in:**
  - `POST /api/v1/auth/mobile/token` (email, password, the authenticator code where the role needs it, and the device's id and name), `/refresh` and `/revoke`, per `mobile-auth.ts`.
  - `mobile_devices` holds the refresh token's hash, its family id and the push token.
  - Access tokens last 15 minutes and are ES256-signed. Refresh tokens rotate and last 30 days.
  - Reusing a refresh token revokes the family (`refresh_reused`).
  - Rate limits apply per token and per address through Redis.
- **`GET /api/v1/me`** answers the person, their roles, `minimumAppVersion` and the feature flags (`feature_flags`, editable with `admin.flags.write`). Every mobile route refuses an app below the minimum version (`app_update_required`).
- **Idempotency:** the Redis front for `Idempotency-Key` on mobile mutations, in front of `idempotency_keys` (STATUS follow-up "Mobile tokens and the Redis front").
- **Web:** Admin › Team members › a person's phones, with Revoke (`field.device.revoke`).
- **App screens:** sign in, the PIN or biometric unlock, an empty Today, and Settings (sign out, the version).
- **Acceptance:** the version gate; refresh rotation and reuse; a revoked device is refused at its next call; no token in logs or Sentry.

## 7. Wave 2

### 7.1 J4 PM Surya Ghar and subsidy gates
- **Tables:** `subsidy_applications` and `subsidy_gates`. The machines `project-surya-ghar` and `subsidy-gate` are brought into use with one command per event.
  - Gates are approved or rejected with `projects.gate.approve`. A rejection's reason returns the gate for resubmission (PRJ-02).
  - `feasibility.approved` locks `sanctioned_load_kw`; nothing changes it afterwards.
  - `qc.signoff` needs `projects.qc.signoff` (J6's inspection).
  - `material.delivered` checks the DCR serials (J8 adds the serial check; until then it checks the items' DCR flags).
- **Screens:** the project page's Subsidy tab (each gate with its documents, submit, approve or reject, the history of rejections) and `/projects/subsidy`, the gates waiting per stage.
- **Acceptance:** PRJ-02's criteria, each through every path.

### 7.2 J5 Scheduling board
- **Tables:** `crews` and `crew_members`; `schedule_slots` (`entity_id`, project, milestone, engineer or crew, start, end, `travel_min`, state `proposed`, `confirmed`, `done` or `cancelled`, `proposed_by` a person or an agent); `unavailability`.
- **Conflicts:** `findScheduleConflicts()` is a pure function that flags double booking, unavailability and too little travel time between consecutive visits (question 6). It runs before a slot is saved and names each conflict. Saving over a conflict needs a reason and is audited.
- **The slot finder:** `suggestSlots(project, window)` is pure. It ranks free slots per engineer by travel from their previous visit. J9's booking and Phase 6's Orchestrator call it; nothing is saved until a person confirms (PRJ-04).
- **Screens:** `/projects/schedule`:
  - day and week views by engineer or crew, with drag and drop through `@dnd-kit/core`, keyboard-operable;
  - the unassigned queue (milestones waiting for a visit);
  - the map of the day's jobs (MapLibre behind the `schedule_map` flag);
  - Unavailability.
- **Acceptance:** PRJ-04's first criterion. The board renders 30 engineers × 7 days within its JavaScript budget, and its list query has `EXPLAIN` evidence.

### 7.3 J6 QC and labour cost lines
- **Tables:** `checklists` (templates per step, with their items and the photo each needs), `qc_inspections` (a project's filled checklist: answers, photos, signer, `projects.qc.signoff`) and `project_cost_lines` (`kind` labour, contractor or other_direct; vendor for a contractor; quantity, rate and amount, all restricted by `finance.cost.read`).
  - Contractors become a vendor `kind` (U1's master; question 10).
- **Commands:** `projects.qc.submit`, `.signoff` and `.reject`; `projects.cost.add`, `.reverse`. Cost lines are append-only, and a correction is a reversal.
- **Screens:** the QC tab and the Costs tab (only with `finance.cost.read`).
- **Acceptance:** PRJ-05's criterion: a cost line is visible only with `finance.cost.read`, on every route, DTO, event and audit value.

### 7.4 F2 Sync engine and conflict review
- **Routes:** `GET /api/v1/sync/pull?since=` and `POST /api/v1/sync/push`, per `sync.ts`.
  - Pull answers the changes to the collections the person may read since an opaque cursor, paged. An expired cursor means a full pull.
  - Push takes 1 to 100 commands in order. Each has its idempotency key and runs through `executeCommand()` as the person, and is answered `applied`, `replayed`, `conflict` (with the server's record), `rejected` or `held` (a later command on a record with a conflict).
- **The collections registry:** F2 builds the engine with `projects`, `project_milestones`, `customer_sites` and `reference`. Later slices add theirs (`schedule_slots` J5, `checklists`, `qc_inspections` J6, `surveys`, `survey_photos`, `material_issues` F3, `attendance_sites`, `expense_claims` F4, `items`). A collection names its DTO, its scope rule and its conflict rule.
- **Conflict rules** (ADR 0012):
  - transitions are server-authoritative (`state_changed`);
  - survey answers merge per field by `clientTime` (`field_newer_on_server` only for a field the server changed later);
  - a removed record answers `record_removed`;
  - a short stock movement answers `stock_short`.
- **The app:** WatermelonDB's schema and models; the sync loop (pull, then push the outbox, on start, on regaining a network, every 5 minutes while open); the outbox of commands with client UUIDv7 ids; and the Conflicts screen. Nothing is discarded unseen: each conflict shows both versions and the person's choice.
- **Tests:**
  - the protocol, against the real API and Postgres, with WatermelonDB's LokiJS adapter in Node;
  - a device offline for 5 days with 500 commands syncing without loss or duplicate movements (FLD-02);
  - two devices editing one survey merging field by field.
- **Acceptance:** FLD-02's criteria.

### 7.5 J7 Document collection on WhatsApp
- **Requests:** `documents.request` sends the customer the list of missing documents for a step through a WhatsApp template (person-triggered in Phase 4, Orchestrator-triggered in Phase 6).
- **Incoming media:**
  - A photo or PDF on a thread with an open request passes W1's scan and the masking step (`document-filing`: `receive`, `scan`, `mask`).
  - It is then classified by Claude vision through the provider wrapper, on the masked copy only. The kinds are the requirement kinds; the answer is a kind and a confidence.
  - `documents.classify` (platform-only) files it when the confidence is at or above the threshold and the sender is the project's customer (`file`). Otherwise it queues the file for a person (question 9).
  - The machine `document-filing` is brought into use.
- **Screens:** Documents waiting for a person: the masked image, the suggested kind, the requirement, and File or Reject.
- **Guardrails:** the classifier's input is labelled untrusted. Its output is a closed enum and a number, validated, with no free text acted on. A file is never filed against another customer.
- **Acceptance:** WA-02's three criteria; the injection set covers a document carrying instructions.

## 8. Wave 3

### 8.1 J8 DCR/ALMM and loan gates on dispatch
- **The serial's DCR certificate number:** a column on `serials`, entered at receipt (U2's receive screen gains the field for DCR items) and editable with `inventory.stock.adjust`, audited.
- **Dispatch:** D2's `depart` guards become live:
  - `loanGateRequired` and `loanGateMet` are read from J2's loan on the order;
  - `dcrSerialsRequired` holds where the order's project has a DCR scheme (`WORKSHOP_DEFAULTS.sizing.dcrSchemes`);
  - `dcrSerialsValidated` holds when every picked serial of a DCR item carries its certificate number, and the item its ALMM reference.
- **The project's `material.delivered`** reads the same check.
- **Acceptance:** PRJ-02's first criterion: a dispatch to a subsidy project with a serial that is not DCR-valid is refused by every path, including a direct call to the command. A loan-gated dispatch waits for disbursal.

### 8.2 J9 Visit booking and the customer's messages
- **Booking:** from the board or the project, a person books a visit from `suggestSlots()`.
  - The Concierge gains one narrow tool, `projects.visit.propose`. It offers the customer up to three slots from the finder within the chat and records the customer's choice as a *proposed* slot. A person confirms it on the board.
  - The Concierge's other rules (A3) stay as they are.
- **Messages:** confirming a visit sends `visit_booked` (the engineer's name and the date). The day before, `visit_reminder` goes out through `projects.reminders.process`.
  - The milestones get their values and shapes.
  - Their subject becomes `project` (a migration widens the subject check).
  - A template not approved is held, not sent (WA-01).
- **Acceptance:** PRJ-04's second criterion: an Orchestrator or Concierge suggestion changes nothing until a person confirms it; a confirmed visit sends the confirmation once and the reminder the day before.

### 8.3 J10 DISCOM packs
- **Templates** in the print registry, filled only from the project's records (site, sanctioned load, the sizing, the installed serials, the customer's masked documents), light, A4, on the company's letterhead:
  - the single-line diagram;
  - the earthing declaration;
  - the structural declaration.
- **Generation:** the subsidy gate's `submit` effect `build_pack` generates the pack and files it as the gate's document.
- **Acceptance:** PRJ-03's second criterion: no field typed again; each template renders inside the print budget.

### 8.4 F3 Field jobs in the app
- **Today and jobs:** the day's visits (`schedule_slots`), the job with its site, contacts (masked as the web masks them), milestones and navigation.
- **Surveys:** answers per field (`surveys`, merged per field), and `survey_photos` with place and time.
- **Checklists and QC:** the step's checklist and its photos, submitted through J6's commands.
- **Signatures:** the customer's signature at handover (file purpose `signature`).
- **Material arrival and leftovers:**
  - `inventory.dispatch.arrive` is a new event on the dispatch machine, a field engineer's version of `deliver` with the same arrival photo, for their own job's dispatch. It answers Phase 3's question 7.
  - Leftovers are recorded into R2's surplus pool with `project_id`, through a command the engineer holds by `own` scope.
- **Every task works with no network,** and every photo carries its place and time (FLD-01).
- **Acceptance:** FLD-01's criteria for these tasks, through F2's offline test.

### 8.5 F4 Attendance and expense capture
- **Attendance:** `attendance_sites` (an office or hub with its point and radius, `WORKSHOP_DEFAULTS.attendance.geofenceMetres`) and `attendance_events` (person, kind `in` or `out`, time, place, accuracy, distance from the nearest site, selfie file, `needs_review`).
  - `POST /api/v1/attendance/check-in` records outside the geofence with the distance and marks it for review, never refusing it (API §3.2).
  - A field check-in at the job site is a check-in at the visit's site.
  - The selfie is kept 90 days and never used for face matching (push plan P5-6; DPDP).
- **Expenses:** `expense_claims` and `expense_lines` (category travel, fuel, food or site_purchase; amount; receipt photo; project or overhead), through the `expense-claim` machine's `create` and `submit`.
  - `over_limit` is set from the policy limits once HR-3 gives them. No limit is set until then, which is a named default.
  - Approval is Phase 5.
- **Screens:** the app's Check in and My expenses screens, and the web's My expenses for office staff.
- **Acceptance:** FLD-01's attendance and expense tasks offline; HR-01's geofence criterion's capture side.

## 9. Wave 4

### 9.1 J11 Handover, warranty and the CMC register
- **Handover:**
  - The handover kit (`handover_kit` print document: warranty cards per serial, manuals and certificates from the vault, the commissioning report) is sent on WhatsApp as the `handover_kit` milestone, and `installed` goes out at installation.
  - Each installed serial's warranty start is set at handover, or kept from delivery where D2 set it, whichever the workshop names. The named default is handover.
  - The project's `complete` effects `handover_kit` and `register_warranty` run.
- **CMC:** `cmc_register` (project, start, end, state `active`, `due`, `expired`, `renewed`) is created at a PM Surya Ghar handover (question 11). A yearly reminder goes to the General Manager through `projects.reminders.process`. The status report lists every installation by CMC state.
- **Acceptance:** PRJ-06's and PRJ-07's criteria.

### 9.2 F5 Uploads, push, navigation and the version gate
- **Background uploads:** photos are compressed on the device (`expo-image-manipulator`) and uploaded in the background through `/api/v1/files/presign` and `/complete` with the mobile bearer. A record shows pending until its file lands, and an upload resumes after a restart.
- **Push:** through `expo-notifications` with FCM behind an adapter. Notifications use `NOTICE_TYPES`, with project and visit kinds added, and respect each person's preferences and quiet hours (RPT-04). With no Firebase project the adapter stays off; that is the final phase's account.
- **Navigation:** opens the phone's maps app at the site's coordinates, or the village when there are none.
- **The version gate in the app:** below `minimumAppVersion`, the app blocks new work and asks for the update (FLD-03).
- **Acceptance:** FLD-03's criteria.

### 9.3 G4 Phase 4 exit pack
- **The isolation sweep:** every Phase 4 table, view, definer, route and sync collection read as every role and agent principal: `documents.sensitive.read`, `finance.cost.read` (cost lines), a Field Engineer's `own` scope, and identity digits nowhere.
- **The sync conflict cases** of FLD-02 run as one scripted test: 5 days offline, two devices, a refused transition, and a short stock movement.
- **Runbooks:** a lost or stolen phone (revoke), sync stuck on a device, a gate rejected by the DISCOM, a misfiled customer document, and a visit missed.
- **Alerts in Sentry:** sync failures per device, uploads pending over 24 hours, and the reminders job failing.
- **Measures** in a new record `field.md` in `docs/04-architecture-appendix/`: pull size and time at a realistic working set, push of 500 commands, the board at 30 × 7, and a document's masking and classification time.
- **The final-phase checklist** of §11 written into `exit-gate-actions.md`, and `currentPhase` moved by the exit gate.

## 10. Workshop defaults
Each lives in `WORKSHOP_DEFAULTS`, is added by the slice that first uses it, and is named under its question in the workshop pack:
- **`projects`:**
  - the standard steps survey, dispatch, install, commission and handover (PROJ-2; `STANDARD_MILESTONES` exists);
  - the requirement lists per step and gate from BLUEPRINT §8.5, as mandatory or optional (PROJ-1): electricity bill, identity proof (masked), property papers, site photos, the sanctioned load letter, the agreement, the commissioning report and the net-meter certificate;
  - CMC 5 years;
  - warranty starting at handover.
- **`documents`:** the classification threshold 0.85, and every file waiting for a person for the first 14 days of live use (PROJ-3).
- **`schedule`:**
  - a road factor of 1.4;
  - an average speed of 30 km/h;
  - a buffer of 15 minutes between visits;
  - a working day of 09:30 to 18:00 IST (PROJ-4, HR-1's partial answer).
- **`field`:** 5 days offline (PROJ-4); a minimum app version.
- **`attendance`:** a geofence of 200 metres; the selfie kept 90 days (HR-1).

Data with no default stays empty until the client gives it: crews, engineers' areas, lenders, attendance sites, checklists per step, expense limits and each DISCOM's formats.

## 11. Final-phase verification
| Slice | Live step in the final phase | Needs |
|---|---|---|
| J1, J4 | The client's real steps and gate lists entered; one live project per flow taken through | PROJ-1, PROJ-2 |
| J3, J7 | Masking checked on real document photos with the customers' consent; the classifier's threshold set after its trial | client-actions 21, PROJ-3 |
| J5, J9 | The board run with the real engineers and crews; a visit booked over WhatsApp and confirmed | the team list, PROJ-4, approved templates |
| J10 | Each DISCOM's own formats | the client's DISCOM contacts |
| F1–F5 | The app built with EAS, installed on the engineers' phones, push through Firebase, rolled out in stages | an Expo account, a Google Play developer account, a Firebase project |
| G4 | **The pilot: 2–3 engineers on live jobs for two weeks** (the exit gate) | the engineers, live jobs |

## 12. Questions for the client (final phase)
1. PROJ-1: the documents each step and gate needs, and which are mandatory.
2. PROJ-2: the standard steps per segment.
3. PROJ-3: whether a person checks every auto-sorted document for the first weeks.
4. PROJ-4: travel times and the longest time an engineer works without data.
5. The engineers, crews and areas; who books visits.
6. The lenders the group works with, and what a loan holds back (dispatch, milestones).
7. Each DISCOM's pack formats, and who signs the declarations.
8. CMC terms per scheme.
9. HR-1: the offices and hubs as attendance sites, the geofence, and whether a selfie is wanted.
10. HR-3: the expense categories' limits, ahead of Phase 5's approval.

## 13. Tests per slice
Every slice gets the same base as in Phases 1 to 3:
- unit tests beside the code;
- for each new table, its place in the `*_TABLES` lists, a fixture row per company and a rule in the role × company matrix;
- for each command, the denied, wrong-company and happy-path tests on real Postgres;
- the agent refusal sweep over new commands;
- journeys for the roles it touches with axe checks and light, dark and 400 px snapshots;
- `EXPLAIN` evidence for every list;
- the JavaScript budget;
- `pnpm db:docs` and `machines:docs`.

The app's slices add `jest-expo` tests and the protocol tests against the real API. Beside those:

| Slice | Tests of its own |
|---|---|
| J1 | Drafting from confirmation per segment; template versions; an engineer's own scope; projects in STATUS |
| J2 | The loan machine; gates answered per state |
| J3 | Masking on every customer document path; identity digits nowhere; filing against the sending customer only; the completeness definer |
| F1 | Token rotation and reuse; revocation; the version gate; rate limits; no token in logs |
| J4 | Every gate's path, including rejection and resubmission; the sanctioned-load lock |
| J5 | Conflict detection on generated schedules; the slot finder's order; drag and drop by keyboard |
| J6 | Cost lines per role on every path; QC sign-off by grant |
| F2 | 5 days offline; two devices; every conflict reason; replay after a lost answer |
| J7 | Classification above and below the threshold; another customer's file; the injection set |
| J8 | DCR and loan gates by every path |
| J9 | A proposal changes nothing until confirmed; the confirmation and reminder once each |
| J10 | Packs from records only; the print budget |
| F3, F4 | Every task offline; place and time on photos; arrival by own scope; check-in outside the geofence recorded for review |
| J11 | Warranty dates per serial; the CMC reminder and report |
| F5 | Upload resume; push quiet hours; the gate in the app |
| G4 | The isolation sweep; the scripted sync cases |

## 14. Gaps and conflicts in the governing documents
- **The order's segment:** `sales_orders` has no segment. J1 reads it from the opportunity's pipeline and snapshots it on the project (question 1).
- **Who records arrival:** the dispatch machine's note leaves it to the workshop. Phase 3 gave it to `inventory.dispatch.write` (question 7 there), and F3 adds `inventory.dispatch.arrive` for the engineer's own job.
- **Crews and material issues:** DATABASE names `crew_id` and the `material_issues` sync collection but plans no tables. J5 adds `crews` and `crew_members`, and F3 makes `material_issues` a view over the ledger's issues to the engineer's dispatches.
- **Leave before Phase 5:** the board's conflict check needs leave. J5's `unavailability` serves it and Phase 5's approved leave writes into it (§2).
- **WhatsApp subjects:** the milestone sends allow only `quote` and `sales_order`. J9 widens the check to `project`.
- **Push:** FCM needs a Firebase project in the group's name. F5 builds the adapter off until it exists.
