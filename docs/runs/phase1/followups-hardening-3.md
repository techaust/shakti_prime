# Hardening follow-ups, batch 3 (wave 6, after G1)

| | |
|---|---|
| Branch | `fix/followups-hardening-3` on GitHub, from `main` at 42555caa (#189) |
| PC worktree | `followups-hardening-3`, slot 2: Postgres 54332 (container `shakti-pg-followups-hardening-3`), app 3032 |
| Runs on | PC (owner, 17-10-2026: spend the week's remainder before the reset; the lead runs it while the owner is away) |
| Tier | B (the handover's state machine, workers, permissions): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | build Opus medium from week 96 (18-10-2026) |
| State | built, waiting for review |
| Next step | the builder reports; the lead reads the diff and starts the review |

## Brief
The Phase 1 follow-ups in [STATUS](../../10-status.md#open-follow-ups) that need no client input: two handover defects, one value with two copies, a page near its size budget, and three small pieces the design or the owner left for after C3 and P2b. No change to tax, price or credit logic. A migration only where an item needs one, as [AGENTS §6](../../../AGENTS.md#6-database-changes) says; a new command as [AGENTS §5](../../../AGENTS.md#5-domain-commands) says (the `add-command` and `add-table` skills).

**The handover (T2)**
1. **Call tasks on a handover by the workers** (T2 follow-up): the handover runs as `system:workers`, which holds no `crm.lead.write`, so `moveCallTasks` moves nothing and a callback that was open stays with the caller. Move the open call tasks to the converter through a narrow definer that checks a platform-only permission, as ADR 0020 says for the workers principal (never by giving `system:workers` a person's `crm.*` grant). Tests: a handover with a callback open moves it; the denied and wrong-company cases.
2. **A nurtured lead on reassignment** (T2 follow-up): `crm.opportunity.assign` runs only from open, so a nurtured lead's owner and its nurture calls cannot be reassigned. Let the assignment run from nurture too, moving the nurture calls with the owner, by the state machine's rules (`packages/domain/src/state-machines`; regenerate `machines:docs`). Tests for both states.
3. **The handover's state-machine check** (T2 review #9) runs on a made-up lead record and can never refuse; the database function holds the real check. Make the check run on the lead's real state (read under the request's context) so it can refuse, or remove it and say why in the code, whichever keeps one source of truth; a test that it refuses a lead in a state the machine does not allow.
4. **The lock length's two copies:** `pipelines.lock_hours` is `not null default 48`, so `WORKSHOP_DEFAULTS.opportunity.handoverLockHours` is never reached. Keep one source: the column without a default, filled from `WORKSHOP_DEFAULTS` by the seed (which writes code-owned columns, DATABASE §9) for a pipeline that has none, so the workshop answer changes one place. Check the seed's re-run rules (`roles.customised_at` and an Admin's edits are never overwritten).

**Pages and forms**
5. **`/settings/profile` at 192.3 kB** against its 200 kB budget: find what grew (the notification bell) and load it lazily or split it, so the page is back near 186 kB; the JavaScript budget run shows before and after.
6. **The add-partner form** (owner, 05-10-2026): a referral partner made as a customer of the kind Referral partner with no lead, from the referral partners' screen, through the existing customer command (its contract gains the kind if needed); a journey with axe; the button's key added to `tools/copy-lint/copy-lint.config.json`.
7. **Referral codes in the import mapping** (after P2b): a column of referral codes maps to the lead's referral partner, a code that matches no partner refused with its own reason in the reconciliation; tests in the import suites.
8. **The walk-in form's PIN box** gets P2b's PIN lookup (the same lookup the other forms use: a PIN fills the post office, district and state); a journey step.

Copy for every new word goes in `apps/web/messages/en.json` and passes `pnpm copy-lint`. Screens: list every baseline that changes for the lead to remake in the Linux image; do not remake them on the host. Shared lists are append-only.

Done when: the checks of AGENTS §10 pass on the slot; the security suite passes on the slot's Postgres; each changed journey passes twice in a row with `e2e:seed` before each run.

**How to work:** you are the only builder on the PC, but the lead may run checks beside you, so every lint, typecheck, test, build and journey, folder-level ones too, goes through `bash tools/integration/heavy.sh <command>` (the main checkout's copy). Commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Never open a pull request, install a dependency or touch a hosted service.

## Report

### 18-10-2026, PC (slot 2, Postgres 54332), Opus 5.5 medium
Skills loaded: `add-command`, `add-table`. All eight items built; one migration, `0159_pipeline_lock_hours` (renumber at the merge).

**What was built, by item**
1. **Call tasks on a handover:** already built in T2. `app.handover_assign()` (0125) checks `crm.handover.run` through `app.require_handover()` and moves the open callbacks and nurture calls to the new owner as new tasks, cancelling the old ones; `system:workers` holds no `crm.*` grant. The STATUS line was stale. Added the tests the follow-up asked for (`packages/domain/tests/commands/handover.test.ts`): a handover moves two open callbacks, one already due (moved to now) and one later (time kept), while the worker holds no `crm.lead.write`; the definer refuses a person (GM) and a worker outside the company (42501), and nothing moves.
2. **A nurtured lead on reassignment:** already built in T2. The machine has `nurture → assign → nurture` (`move_call_tasks`), and `crm.lead.reassign_all` uses it. Added direct `crm.opportunity.assign` tests from open (the callback moves) and from nurture (state stays nurture, the nurture calls move with their times), plus a lost lead refused with `opportunity_transition_not_allowed`. Machine unchanged, so `machines:docs` did not need regenerating.
3. **The handover's machine check:** `handoverMachineAllows(state, now)` in `packages/domain/src/commands/crm/hand-over-lead.ts` fires `assign` on the lead's real state, which comes from `app.handover_lead_facts()` under the request. A won or lost lead (or an unknown state) is refused and answers `not_open`. It does not throw, because the worker retries a `conflict`. The handover's own rule (open leads only) still answers `not_open` for a nurtured lead, and `app.handover_assign()` checks both again under the row lock. Unit tests: `hand-over-lead.test.ts` (3). Domain test: a lost lead is left with no owner change and no lock.
4. **One copy of the lock hours:** `pipelines.lock_hours` now has no default and allows null (migration 0159). The value lives in one place, `WORKSHOP_LOCK_HOURS` in `packages/contracts/src/crm/config.ts`. `WORKSHOP_DEFAULTS.opportunity.handoverLockHours` reads it, and so does the seed: it writes the value on insert, and on a re-run uses `coalesce(pipelines.lock_hours, excluded.lock_hours)`, so it fills only a pipeline with none and never overwrites an Admin edit. The pipeline settings read and command answer the workshop default for a pipeline with none. Test `packages/db/tests/security/seeds.test.ts`: a null is filled, a 72 is kept, and the column has no default. DATABASE §6 (the `pipelines` row) and §9 now say this.
5. **`/settings/profile`:** went from 193.7 to 189.5 kB. Other BOS pages dropped by 0.6 to 4.2 kB, and none grew more than 0.2 kB. (Its STATUS line says 192.3.) The causes found by diffing the page's first-load chunks against `/sign-in`:
   - the (bos) layout's `ThemeSync`, the profile menu and the password forms each imported `screens/contract-values.ts`, so the whole browser value list went to every staff page. `THEMES`, `isTheme`, `CONTRASTS` and `PASSWORD_MIN_LENGTH` now live in `screens/theme-values.ts`, which `contract-values.ts` re-exports, so `contract-values.test.ts` still covers them. This saved 3.1 kB.
   - the bell now loads beside the page through `next/dynamic`. The server still draws it, and a placeholder the size of the bell holds its place on a page drawn in the browser. This saved 1.1 kB.
   
   It is not back at 186. The rest of the shell's growth is the menu icons (3.5 kB) and code that was already there on 29-09 (tailwind-merge 8.9 kB, Radix Slot). I also tried loading the presence form lazily from the server page; it did not split, so I reverted it. `js-budget.json` is unchanged: it is a checks file.
6. **The add-partner form:** there is no command that makes a customer without a lead, so this adds `crm.referral_partner.create`:
   - Rights and context: `crm.config.write:all`, also `crm.account.write:own`, people only, in `packages/domain/src/commands/crm/referrals.ts`. Its contract is `CreateReferralPartnerInput`.
   - What it writes: it reuses the customer import's writer `commitAccountBatch()` (the same rows and policies as any customer). The result is a customer of type `referral_partner` in one company, with the Executive looking after it there, and no lead.
   - The code: set through `crm.referral_partner.set` in the same transaction, when one is given.
   - Refusal: a number that already belongs to a customer is refused with `referral_partner_phone_known`, shown under the phone box.
   - Wiring: registered in the registry, exported, the action `createReferralPartner` (`apps/web/src/actions/crm-settings.ts`), named in `audit.ts`, and added to the sweep's `INPUTS`, `CUSTOMER_INPUTS` and `PEOPLE_ONLY_INPUTS`.
   - Screen: an Add partner button and dialog in `referrals-editor.tsx` (company, name, mobile number, business name, code). The new partner joins the list and the commission form's choice. The buttons `addPartner` and `savePartner` were added to `copy-lint.config.json`, and the intro and empty-list copy no longer send people to the lead form.
   - Journey: `e2e/pipelines.spec.ts` checks the dialog with axe, a refused number under its box with axe, then saves and finds the code and the commission choice. The e2e seed archives the partners the journey adds (`archiveAddedPartners()`, per-project names in `ADDED_PARTNERS`).
7. **Referral codes in the import mapping:**
   - Mapping: `referralCode` is appended to `LeadImportFieldSchema` and to the web's `LEAD_IMPORT_FIELDS`, with headings `referralcode`, `referral`, `partnercode`, `refcode` and `referredby`.
   - Preview: it asks `app.referral_partner_for_code()` once per distinct code in the file. A row whose code no active partner of the company has is invalid with `referral_code_unknown`, which is appended to `ImportRowErrorCodeSchema`.
   - Commit: a code stopped between the preview and the commit sets its row aside with the same reason (`rowRefusal()` in `commit-job.ts`), and the rest of the batch goes in. A batch holding a code goes row by row, as before.
   - Copy: `imports.fields.referralCode`, `rowErrors` and `reconcile.reasons`.
   - Tests: unit test in `leads.test.ts` (a code in small letters, an unknown code, a malformed code, a blank cell). `imports.test.ts` covers the preview, the commit crediting the partner, and a code stopped before the commit.
8. **The walk-in PIN box:** `walk-in-form.tsx` uses `usePinLookup()`, `PinHint` and `LocalityOptions` as the lead form does, and clears the PIN after a save. The journey step in `e2e/walk-in.spec.ts` checks the tehsil and district hint, the offered post office, axe, and an unknown PIN. The e2e seed writes one made-up post office as the table owner (`WALK_IN_PIN`, PIN 999002, an Army Postal Service range no office uses), since the e2e database has no PIN list.

**Checks (all through `heavy.sh`)**
- `pnpm test:security`: db 1272 passed (45 files), domain 1039 passed (77), web 333 passed (25); 4 of 4 tasks. The first run failed one case in `crm-pipelines.test.ts`: a pipeline made outside the seed now audits `lockHours: null` before an edit. I updated the expectation (with a comment) and reran the whole suite green.
- Unit tests (`turbo run test --force`):
  - domain 2254, contracts 182, db 146, ui 107, tokens 146, copy-lint 17;
  - web 952 passed, 1 skipped, after naming the new command in `audit.ts`;
  - `release-workflows.test.ts` hit its 90 s limit under the whole run's load and passes alone (17 of 17). The slice does not touch it.
- `pnpm lint` (whole repository) clean, `pnpm typecheck` 8 of 8, `pnpm copy-lint` clean, `pnpm db:docs` regenerated (`docs/data/`).
- `pnpm build` then `pnpm --filter web js-budget`: every page within its budget, 46 pages.
- Journeys `pipelines`, `walk-in`, `imports`, `notifications` and `profile`, `e2e:seed` before each run: 84 passed, then 84 passed. In an earlier pair, the walk-in keyboard case flaked once on desktop-dark (the save notice was not seen; it passed on retry). A run with `--repeat-each 3 --retries 0` then passed 68 of 68.

**EXPLAIN (ANALYZE)** (the one new lookup on a table; the import's code lookup is one definer call per distinct code): the partner number check is an Index Scan on `contact_phones_e164_idx`, then `account_contacts_contact_idx`, then `accounts_pkey`, 9 shared buffers, 2.2 ms, 1,841 phones.

**Baselines for the lead to remake in the Linux image:** `settings-pipelines` (the Add partner button and the new intro), `imports-job` and `imports-identity-left-out` (the matching step lists Referral code), each in desktop-light, desktop-dark and phone. The bell is still drawn by the server, so I expect no other picture to change.

**Decisions the brief did not settle**
- Items 1 and 2 needed no code. The STATUS follow-up line describes the state before T2's definer, and the lead can close it.
- Lock hours: the column is nullable rather than `not null` without a default. A pipeline made outside the seed (tests, a later Admin create) then reads the workshop default rather than failing. The value is in `@shakti/contracts` because `packages/db` may not import `@shakti/domain` (the precedent is `WORKSHOP_DISPOSITIONS`).
- Add partner: a new command over the customer import's writer, as no single-customer create command exists. Only an Executive may run it (the code decides commission). A number already a customer's is refused rather than turned into a partner, since that is a type change on Account 360.
- The machine refusal in the handover answers `not_open`, not an error, so the event is not retried.

**Unfinished:** `/settings/profile` is at 189.5 kB, not 186. Getting there needs the menu icons (3.5 kB) out of the shell's script, for example drawn by the server layout and passed to `AppShell` as nodes. That is a shell change across every page, left for the lead to decide.

## Review
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | Medium (confirmed, one-line fix) | `packages/domain/src/commands/crm/referrals.ts` `createReferralPartner`: the number is looked up with no number lock. `crm.lead.create` takes `lockNewNumber()` (`lead-phone:<company>:<phone>`) before its lookup for exactly this reason. A caller saving a walk-in with number X while an Executive adds partner X in the same company: both find X free, both commit, two customers with one number. Fix: `await lockNewNumber(ctx.tx, input.phone, input.entityId)` before the `known` select. | open |
| 2 | Medium (plausible) | `apps/web/e2e/pipelines.spec.ts`: the `settings-pipelines` snapshot (test 1, full page) can include another project's added partner. Playwright runs `fullyParallel` with 2 workers, the describe is serial only within a project, and the seed archives the added partners only before the run. Scenario: desktop-light's add test runs while desktop-dark takes its snapshot, and the list shows "Gram Mitra Dudu" with that run's own code, so the remade Linux baseline flakes. Fix: mask the partner list in that `snap()`, or order the add test after every project's snapshot (a project dependency). | open |
| 3 | Low (confirmed) | `referrals-editor.tsx` `onAdded`: the new partner is sorted into the loaded rows even when more pages are left (`cursor !== null`). If its name sorts after the cursor, Load more returns it again, which gives a duplicate row and a duplicate React key. Fix: insert it only when `cursor === null` or when it sorts before the last loaded row, or drop ids already shown when a page is appended. | open |
| 4 | Low (confirmed) | `hand-over-lead.ts`: `!handoverMachineAllows(state) \|\| state !== 'open'` behaves exactly like `state !== 'open'`, because the machine allows `open`. The machine check can never be the refusal that decides. The domain test "leaves a lost lead" passes with or without it, and the rule now has three copies (the machine, the `open` test and `app.handover_assign()`) where the brief asked for one. No behaviour is wrong. Follow-up: remove the call with a code comment naming `app.handover_assign()` as the source, or keep it and say in the comment that it is the documented check, not a guard. | follow-up |
| 5 | Low (plausible) | `referrals.ts` `known` select: it does not join `contacts` with `archived_at is null`, as `app.lead_phone_status()` does. A number left only on an archived contact is refused as "already belongs to a customer". Fix: `join contacts c on c.id = cp.contact_id and c.archived_at is null`. | open |
| 6 | Low (plausible) | `apps/web/src/screens/import-wizard.ts` HEADINGS: `referredby` and `referral` auto-map a column of referrers' names to Referral code. In such a file every filled row fails as a malformed or unknown code until the importer changes the match. Fix: keep the code-like headings only (`referralcode`, `partnercode`, `refcode`). | follow-up |

**Checked and sound:** every read of `pipelines.lock_hours` copes with null:
- `app.handover_assign()` uses `coalesce(p.lock_hours, p_default_hours)`, and the command passes the workshop default.
- `crm.opportunity.assign`, the settings query and the settings command DTO fall back to `WORKSHOP_DEFAULTS`.
- `handover_lead_facts.lock_hours` is not selected.
- The event's `lockHours` comes from those fallbacks.
- The check constraint passes null. The seed's `coalesce(pipelines.lock_hours, excluded.lock_hours)` fills only a null and never overwrites an edit, and the test proves both.

STATUS items 1 and 2 were already built in T2, as the builder says. 0125's `app.handover_assign()` checks `crm.handover.run` through `app.require_handover()` and moves open `callback` and `nurture` tasks as new tasks, cancelling the old ones. The machine has `nurture → assign → nurture` with `move_call_tasks`. `crm.opportunity.assign` moves the call tasks.

`handoverMachineAllows()` refuses only won, lost and unknown states, so it adds no new refusal.

The new command:
- It has its denied, wrong-company, agent and happy-path tests.
- `auditFields` are labelled (`accountType` is in `audit.ts`), and the command is named in `ACTIONS`.
- Name and phone stay out of the audit.
- It is `peopleOnly` and appears in `INPUTS`, `CUSTOMER_INPUTS` and `PEOPLE_ONLY_INPUTS`.
- The import writer inserts under `app_user`'s policies with the colleague check.
- A code collision maps to `referral_code_taken` through the nested run's `constraintReasons`, and the whole create rolls back.

Import codes:
- The preview asks the definer once per distinct code, in capitals, and the definer applies `upper(btrim())`.
- At the commit a stopped code sets its row aside with its own finding.
- The counts move valid to invalid, and the test checks committed, valid and invalid.

The walk-in PIN lookup is wired as the lead form's, and the PIN is cleared after a save. The bell is `next/dynamic` with a placeholder the size of the bell. `theme-values.ts` imports only types and is re-exported, so `contract-values.test.ts` still covers it. The copy is in `en.json`, both button keys are added, and DATABASE §6 and §9 and the design's Built record match the code.

**Not checked:** the reviewer ran no suite (the slot's database is stopped) and relied on the builder's runs. The Linux baselines are not yet remade, so no screenshot was seen. The JavaScript budget (189.5 kB, not the brief's 186, left to the lead) and the EXPLAIN were not reproduced.

## Integration notes
