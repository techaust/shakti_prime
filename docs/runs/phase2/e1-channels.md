# E1 Channels and dial rules (wave 1)

| | |
|---|---|
| Branch | `feat/e1-channels` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | early check |
| Next step | the lead reads the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §5.2](../../03-roadmap-appendix/phase2.md#52-e1-channels-and-dial-rules), §2 (question 13: off on production), §3, §4, §11, §12 and §14.
- BLUEPRINT §7.7 (DLT 140 and 160 series, TRAI hours, DND, consent); PRD TEL-04 and CRM-10; SECURITY §3.2; DATABASE §5 (the planned `entity_channels`); `docs/04-architecture-appendix/exotel.md` and `calling.md`.
- What exists: `checkDial` and the telecom rules in `packages/domain/src/telecom`; `contact_phones.is_dnd` and `dnd_checked_at`; consents and their withdrawal; the Cold Caller (`/calling`) and Converting workspaces; Settings › Companies; `WORKSHOP_DEFAULTS.calling`; the ports folder `packages/domain/src/ports`.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **`entity_channels`** as §5.2 says, with RLS by company, the testing lists, a fixture row per company and the role × company matrix (AGENTS §6); `org.channel.set` and `org.channel.archive` (`admin.entities.write:all`, audited, denied, wrong-company and happy-path tests).
2. **`app.dial_facts()`**, answering only what `checkDial` needs; its security tests.
3. **`call-purpose.ts`** (pure, unit-tested) and `checkDial` choosing the 160 series for a consented service call and the 140 series otherwise, refusing a promotional call to a DND number and any call outside 09:00 to 21:00 IST, listing every broken rule.
4. **DND:** the `DndRegistry` port with a fixture adapter; `crm.phone.dnd_record` through the port as the platform (a platform-only grant if it needs one, in `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and a new `app.platform_only_permissions()` that keeps every key of `main`'s latest, migration 0142); `WORKSHOP_DEFAULTS.calling.dndFreshDays` (7); a stale check refreshed at the dial, an unreachable registry refusing only the promotional dial (`dnd_unknown`).
5. **Screens:** Settings › Companies › Channels (each company's numbers, whether verified); in the Cold Caller and Converting workspaces, the number a call would go out on, why, and any refusal reason, in plain words from `en.json` (no Dial key: T3 adds it). Journeys with axe; the JavaScript budget.
6. **Tests:** every case of TEL-04's two criteria; a contact who withdrew call consent cannot be dialled by any path; a stale DND check; the security suite proving `entity_channels` per role and company.
7. **Documents:** DATABASE, SECURITY §3.2, the telecom document, design §5.2 "Built (E1)", `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: everything above. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, `WORKSHOP_DEFAULTS`. P5, V1 and K2 build beside you: never touch `webhook_inbox`, the webhook routes, `apps/web/src/integrations/voice` or the Playbook.

**Early check (Tier A):** once the table, the commands, `app.dial_facts()`, the purpose rule, `checkDial` and the DND port are committed with their tests, write a short report in this file, commit it with the subject `report: e1-channels early check`, push and stop. The lead reads that diff and starts you again for the screens.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §5.2 pass; `pnpm test:security` passes on the local Postgres.

Not in E1: the Dial key, Exotel calls and recordings (T3); the real DND scrub source and the DLT numbers (final phase); WhatsApp sending (W1). Nothing the client must give is invented: channel numbers are entered on the screen, tests use clearly synthetic numbers.

## Report

### Early check, 13-11-2026, cloud session
Skills loaded: `add-table`, `add-command`. Everything below is committed and pushed on `feat/e1-channels`; the screens (brief step 5) and the remaining documents (step 7) wait for the lead.

**Built:**
- **`entity_channels`** (`packages/db/src/schema/entity-channels.ts`; migrations `0160_entity_channels.sql` generated, `0161_e1_channels_rls.sql` custom, numbered after `main`'s 0159): §5.2's columns; one active row per company and channel, `provider_ref` unique among active rows; RLS forced, read by any principal acting in the company (`app_user`, `app_reader`), insert and update by `admin.entities.write:all` in a company of the request; column grants so only `provider_ref`, `dlt_header`, `verified_at`, `is_active` change; `app.entity_channels_guard()` never puts a number back in use. In `ENTITY_TABLES`, a fixture row per company (out of use, so it never stands in for a number), the matrix rule (`CONTEXT`), `NARROWER`, `enum-sync`.
- **`org.channel.set` / `org.channel.archive`** (`packages/domain/src/commands/org/channels.ts`, `admin.entities.write:all`, audited): the same number is updated in place; another number takes its place and the old row is kept out of use, so what named it (T3's calls, W1's threads) keeps it. `org.channel.list` read (`queries/org/list-channels.ts`). Contracts `packages/contracts/src/commands/org/channels.ts`.
- **`app.dial_facts(opportunity, contact_phone)`**: a definer for a person holding `calls.dial` who reads the lead (`app.scope_ok('crm.lead.read', …)`, company in the request, `app.request_is_person()`); answers the lead's company, its source channel, an open callback, an order, the phone's number and DND state, the contact's unwithdrawn service consent for calls, whether any contact of the customer or anyone holding the same number withdrew call consent and gave none since, and the company's active 140 and 160 numbers. Query `dialFacts()` (`queries/calls/dial-plan.ts`).
- **Purpose rule** `packages/domain/src/telecom/call-purpose.ts` (pure): service only with a service consent for calls and an order, an open callback, or a customer-initiated source (`meta_ads`, `google_ads`, `website`, `whatsapp`, `ivr`, `missed_call`, `walk_in`); otherwise promotional.
- **`checkDial`** (built) gained `call_consent_withdrawn`, `company_number_missing` (no number in use for the purpose) and `dnd_unknown`; `callerId: string | null` and `onDnd: boolean | 'unknown'` stay compatible with the Exotel client. `telecom/dial-plan.ts`: `planDial()` picks the 160 number for service and the 140 otherwise and runs `checkDial`; `prepareDial()` looks a stale (or never made) DND check up again for a promotional call only, with a 3-second limit, records the answer as the platform, and leaves it `unknown` when the register does not answer.
- **DND:** port `packages/domain/src/ports/dnd.ts` (`DndRegistry`, `fixtureDndRegistry` with two synthetic numbers, `unavailableDndRegistry`); `crm.phone.dnd_record` (`commands/crm/record-phone-dnd.ts`) through `app.record_phone_dnd()` with the new platform-only grant `crm.dnd.record` (catalogue, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, seed, role-editor label, `app.platform_only_permissions()` = 0142's ten keys plus this one); `app.contact_phones_dnd_guard()` stops any request setting `is_dnd` or `dnd_checked_at`; `WORKSHOP_DEFAULTS.calling.dndFreshDays` = 7.
- Registration lines: `en.json` (four error sentences, audit field and action names, channel kind names, the permission's name), `audit.ts` and `activity-details.tsx` (`channelKind`), `contract-values.ts`, the agent refusal sweep inputs, the reader-parity list.

**Tests added:** `telecom/call-purpose.test.ts` (3), `telecom/dial-plan.test.ts` (14), `ports/dnd.test.ts` (2), `telecom/dial-policy.test.ts` (+4); `packages/db/tests/security/entity-channels.test.ts` (9); `packages/domain/tests/commands/dial-rules.test.ts` (17: denied, wrong-company and happy path for both channel commands and the DND record; every TEL-04 case through `app.dial_facts()` as the caller; withdrawal by the contact and by another customer's holder of the same number; stale DND refreshed through the platform, an unreachable register refusing only the promotional dial).

**Checks:** `pnpm --filter <ws> typecheck` (contracts, db, domain, web): clean. `pnpm exec eslint` on `packages/contracts`, `packages/db`, `packages/domain`, `apps/web/src/screens`, `apps/web/src/components/activity`: clean. `pnpm copy-lint`: clean. Unit: domain `src/telecom`, `src/ports`, `src/command` 196 passed; web `src/screens`, `src/components/activity` 227 passed; db `src` 147 passed; contracts 182 passed. `pnpm db:docs` and `machines:docs` regenerated. SECURITY_RESULT

**EXPLAIN (ANALYZE) under RLS** (local seed, tele-caller of company 3): the channel list is a sequential scan of one page (27 rows, 0.08 ms; at most five live rows a company, `entity_channels_active_unique` serves it once the table grows). `app.dial_facts()` 6.6 ms the first call, 1.5k buffers; its body run as the owner with sequential scans off uses `opportunities_pkey`, `account_contacts_account_id_contact_id_pk`, `contact_phones_contact_e164_unique`, `contact_phones_e164_idx`, `consents_contact_idx`, `sales_orders_opportunity_idx`, `tasks_open_calls_due_idx`, `entity_channels_active_unique` (0.47 ms); on the small seed the planner prefers sequential scans.

**Decisions the brief did not settle:**
1. `org.channel.set` does not refuse a 140 or 160 channel whose number is not of that series: the Exotel trial numbers stand in for them on dev (§5.2 "Sandbox now"), and `checkDial` refuses a wrong-series caller id at every dial (`caller_id_not_promotional` / `caller_id_not_service`). The Channels screen will say when a number is not of its series.
2. `verified_at` is set by the Executive (`verified: true` on `org.channel.set`); a new number starts unverified unless sent. No provider check sets it in E1.
3. An opt-out also holds across customers: a number whose holder on any customer withdrew call consent is refused (`call_consent_withdrawn`), since the phone is what is dialled ("by any path"). Log-call's own rule stays the customer's contacts only.
4. A service call never asks the DND register (consent makes it lawful whatever the register says), so a stale check is refreshed only for a promotional call.
5. The DND answer is recorded by `system:workers` in a command of its own, outside the caller's request, bound to the number asked about and never over a newer answer; a failure to record does not change the plan.
6. `crm.dnd.record` is the new platform-only grant's name; `org.channel.*` are not `peopleOnly` (as `org.entity.update`), agents are refused by `admin.entities.write`.
7. Production has no DND register until the final phase (question 13): the runtime will use `unavailableDndRegistry()` there, so a promotional dial with a stale check is refused; dev and staging the fixture. To be wired with the screens.

**For the lead:** DATABASE §6.1 cites the table as Built (0160): renumber with the migrations. Two tests of `main` change with the new platform-only key (`caller-profiles.test.ts` length 11, `crm-scoring-referrals.test.ts` exception list); P5 and K2 add keys there too.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; if E1 redefines `app.platform_only_permissions()`, keep every key P5 or K2 adds.
