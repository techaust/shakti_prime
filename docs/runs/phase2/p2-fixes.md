# P2 fixes: Phase 2 review follow-ups (wave 4)

| | |
|---|---|
| Branch | `fix/p2-fixes` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): role grants in a definer, a customer-facing filter, an anonymisation window |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder on Opus 5.5 at high effort (start and early check) |
| State | early check: items 1 to 3 built, waiting for "continue" |
| Next step | the lead reads the early check; then items 4 to 8 and the lead's two additions |

## Brief
The open Phase 2 follow-ups of [STATUS](../../10-status.md#open-follow-ups) that are code, one commit each with its tests. Read each item's source finding in the run file named before you change anything.

1. **`agents.note.write` agent-only** ([a2-copilot.md](a2-copilot.md)): the role editor can offer it to a staff role (only the insert policy refuses it). Add it to `roleMayHold()` and `app.role_may_hold()`'s agent-only list. Redefine the SQL function from `main`'s newest migration that defines it, keeping every clause other slices added (diff it line by line and say so in the report). Tests: the role editor's command refuses it; the security suite's oracle agrees.
2. **The Concierge's number-word filter and the customer's own name** ([a3-concierge.md](a3-concierge.md)): Roman Hindi number words that are also names ("Das", "Sat") make the filter refuse a greeting naming that customer. Exempt the words of the customer's own name, only where they stand as that name; a number word elsewhere is still refused. Tests for both, in `packages/domain/src/ai/concierge/`.
3. **The anonymisation window and WhatsApp** ([w1-whatsapp.md](w1-whatsapp.md) re-check N3): `app.customer_idle()` gains the `last_inbound_at` test the anonymisation already applies, so the stale-lead window and the dry run count only what will be anonymised. Redefine from `main`'s newest definition, keeping every clause. Security test: a customer who wrote on WhatsApp inside the period is neither counted nor anonymised.

**Early check (Tier A):** once items 1 to 3 are committed with their tests, write a short report here (with the function diffs against `main`), push `report: p2-fixes early check` and stop. The lead reads the diff and sends "continue" to this session.

4. **Voice's `bosToken`** ([v2-voice.md](v2-voice.md) review L3): drop `bosToken` from `VoiceSessionResponse` and the route's answer; the worker's dispatch already carries it. Tests that the answer no longer holds it and the voice journey still passes.
5. **WhatsApp quotes** ([s3-whatsapp-quotes.md](s3-whatsapp-quotes.md)): a STATUS or a code alone on a chat handled by people no longer brings the reply-waiting notice; a message the messaging worker refuses after the quote was marked sent is told to the person who sent the quote (an in-app notification through the existing notifications path).
6. **The audio player** ([k3-vault-audio.md](k3-vault-audio.md) re-check N2): a file the browser cannot play stops asking for a new address after the first failure and says it cannot be played, with a download link.
7. **The dialled call** ([t3-dial.md](t3-dial.md) re-check 12): a save on one lead clears another lead's dialled call; a save clears only its own lead's.
8. **Website keys and attached enquiries** ([i1-ingest.md](i1-ingest.md) re-check N2): the tests it lists (a key used for another company's site, a site archived after its key was made, the insert policy on its own), and a subscriber for `crm.lead.attached` that tells the lead's owner an enquiry joined their nurtured lead.

For each item touching a screen: copy in `en.json`, the journey that covers it, axe, and baselines for any screen that changed.

Files owned: the files each item names; `packages/domain/src/ai/concierge/rules.ts` and its tests; `apps/web/src/workers/messaging/` notice logic for item 5.

Do not touch: the shadow reports and their pages (`g2-shadow-pack`), `apps/web/src/observability/` and the jobs check (`g2-alerts`), `docs/runbooks/` and `docs/13-client-packs/` (`g2-runbooks`), `docs/04-architecture-appendix/` (`g2-measures`), the WhatsApp media files and their retention (`w2-media-retention`).

Review checklist (check before your report): each SQL function redefined keeps every clause `main` has; no staff role can be granted an agent-only permission; the filter still refuses every number not in the customer's name; the anonymisation and its count agree; nothing reaches a customer without a person; each item has a test that failed before the fix.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `fix/p2-fixes` is on GitHub with this file. Start with `git fetch origin && git switch fix/p2-fixes` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: p2-fixes <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: p2-fixes done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: p2-fixes fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: p2-fixes blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

### 20-11-2026, cloud session: early check (items 1 to 3)

**Warning for the lead (affects every pull request's CI today):** `packages/domain/tests/commands/whatsapp-quotes.test.ts` fails 24 cases on any branch until about 19:00 UTC on 20-11-2026. `testPhone()` (`packages/db/src/testing/phone.ts`) numbers count from `Date.now() % 4e9`, so for about 13 hours in every 46 days they begin with `91`. The file's helpers (lines 196 and 1102) and `apps/web/tests/whatsapp-quotes.test.ts:242` strip `/^\+?91/` as if it were the country code, so the chat matches no customer (`holders: 0`). Fixed in feb0c00d (the number's own digits are kept); worth cherry-picking ahead of today's pull requests. This session could not message the lead's PC session (cloud to PC is refused), so it is recorded here.

Commits: 394a0114 (item 1), 721d2686 (item 2), ecef6f42 (item 3), 5dd9fbe7 (`docs/data` regenerated), feb0c00d (the test number above).

**1. `agents.note.write` agent-only**
- `packages/contracts/src/permissions.ts`: `AGENT_ONLY_PERMISSIONS` (`agents.note.write`) and `isAgentOnlyPermission()`; `roleMayHold()` answers true only for an `agent:` role.
- The role editor's page (`packages/domain/src/queries/admin/roles.ts`) no longer lists an agent-only permission for a staff role, as it already did for platform-only ones, so no locked row with a wrong reason appears. `admin.role.permissions.set` refuses it with `permission_not_for_role` through `roleMayHold()`.
- Migration `0219_agent_only_permissions` redefines `app.role_may_hold()`. Its only definition on `main` is 0074, and the line-by-line diff against it is one added line; every other clause is unchanged:
  ```
  4a5
  >     when p_permission_key = 'agents.note.write' then p_role_key like 'agent:%'
  ```
  The migration also deletes any staff role's `agents.note.write` grant left over from before. Such a grant wrote nothing, since the insert policy admits only the Co-pilot. The seed has none.
- `docs/07-security.md` §3.1 names the agent-only rule.
- Tests, all failing before the fix:
  - `permissions.test.ts`: 4 expectations.
  - `set-role-permissions.test.ts`: 1 case (the Executive, the GM and a tele-caller are refused).
  - `role-editor.test.ts` (security): the oracle `app.role_may_hold()` against `roleMayHold()` failed before; plus 2 holder-guard refusals and 1 case where only agent roles may hold it. 4 cases failed against 0074's function.
  - `admin-roles.test.ts`: the page omits it.
  - `roles.spec.ts`: the Store Manager's page offers no "Write call briefs and call summaries".

**2. The Concierge's number words and the customer's own name**
- `claims.ts` `withoutCustomerName()`, called in `replyProblem()` after the company's own numbers are set aside. `ConciergeFilterFacts.customerName` comes from the run's facts (`conciergeFilterFacts`).
- The name counts as standing as that name in two forms:
  - written whole ("Ramesh Das", "R.K. Das");
  - a word of it beside a title: before it `mr`, `mrs`, `ms`, `shri`, `sri`, `smt`, `shrimati`; after it `ji`, `sir`, `madam`, `sahab`, `saheb`.
- Written whole without a title, the name counts only when one of its words is not a number word, since "Das" alone cannot be told from the number.
- The name is untrusted (it can come from the WhatsApp profile), so the exemption is bounded:
  - a name holding any money, day, offer or promise word exempts nothing;
  - a name of more than 5 words exempts nothing;
  - only the name's own span is blanked, and a number word anywhere else, even in the same sentence, is still a claim.
- Tests in `filter.test.ts`, 2 new cases:
  - 7 greetings that pass. These failed before the fix.
  - 9 that are still refused: no name recorded, the same word used as a number, a bare all-number name, a name holding a money or day word, another number word beside the name.

**3. The anonymisation window and WhatsApp**
- Migration `0220_customer_idle_whatsapp` redefines `app.customer_idle()` (its only definition on `main` is 0142) with the anonymisation's own `last_inbound_at` test. Diff against 0142, one added clause, all else unchanged:
  ```
  28a29,30
  >          and not exists (select 1 from public.whatsapp_threads x
  >                           where x.account_id = a.id and x.last_inbound_at >= p_cutoff)
  ```
- `app.stale_leads()` (the window and the dry run) reads it through `app.lead_is_stale()`, so `stale` now agrees with what `app.anonymise_stale_leads()` acts on.
- `anonymise_stale_leads()` is not redefined: its own check (0207's definition) stays and is now redundant but harmless. Redefining 250 lines for no change in behaviour seemed worse.
- `docs/05-database.md` describes the clause in `customer_idle`.
- `EXPLAIN (ANALYZE)` of the probe: Index Scan using `whatsapp_threads_account_idx`, Index Cond `account_id`, Filter `last_inbound_at`, 0.26 ms.
- Security test in `whatsapp.test.ts`: a customer who wrote today has `stale: false` in the window and is passed by; one last heard from in 2010 has `stale: true` and is anonymised. It failed before the fix (the recent writer read as stale).

**Checks in this VM**
- `pnpm typecheck`: 10 of 10 tasks.
- eslint `--max-warnings 0` on every folder and file touched: clean (needs `NODE_OPTIONS=--max-old-space-size=6144` here).
- Unit tests: contracts 322 of 322, domain 2593 of 2593, db 160 of 160 after `pnpm db:docs`.
- `pnpm test:security`:
  - db: 1512 of 1512.
  - domain: 1365 passed, 24 failed. All 24 are in `whatsapp-quotes.test.ts` (the clock fault above); after feb0c00d that file passes 34 of 34 alone, and `apps/web/tests/whatsapp-quotes.test.ts` passes 17 of 17.
  - web: in the same run, passed.
- `pnpm build`: passed.
- `roles.spec.ts`:
  - with the host's Chromium, every step passed but the screenshot (a font-rendering difference);
  - `e2e:snap -- roles.spec.ts` in the Linux image: 20 passed, baselines unchanged. The role grants page has no screenshot, and the roles list does not change.
- `machines:docs`: no change.

**Assumptions**
- Agent-only means any `agent:` role, the same shape as platform-only meaning any `system:` role. The notes' insert policy still admits only `agent:copilot`.
- The role editor hides an agent-only permission rather than showing it locked, so no new lock reason or copy is needed.
- In docs, the new migrations are not cited by number in `05-database.md`'s row, because the lead renumbers them at the merge.

**Skills loaded:** none. `add-command` and `add-table` do not apply, since no command or table was added.

**Lead's additions, received during the early check, to do after "continue":**
- the `tier_budget_reached` refusal told to the quote's sender (part of item 5);
- item 9: a Concierge run that ends with the AI service unavailable counts toward the hand-off.

## Review

## Integration
