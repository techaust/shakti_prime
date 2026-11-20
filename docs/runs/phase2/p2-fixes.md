# P2 fixes: Phase 2 review follow-ups (wave 4)

| | |
|---|---|
| Branch | `fix/p2-fixes` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): role grants in a definer, a customer-facing filter, an anonymisation window |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder on Opus 5.5 at high effort from start to done |
| State | fix round done: M1, L1 and L2 fixed, waiting for the lead |
| Next step | the lead reads the fix round and integrates |

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
- `pnpm test:security`, run again after feb0c00d: db 1512 of 1512, domain 1389 of 1389, web 445 of 445 (4 of 4 tasks). The first run had 24 domain failures, all in `whatsapp-quotes.test.ts` (the clock fault above), and turbo stopped before the web suite.
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

### 20-11-2026, cloud session: done (items 4 to 9)

Commits after the early check: a7bd15ec (4), 72077ef5 and 20a3d522 (5), 4d3a7c73 (6), 70a7a0bd (7), e447070d and 6df1991c (8), 3ba7d1c6 (9, the lead's addition), 0a928f45 (baselines). New migrations after `main`'s 0218, for the lead to renumber: 0219 and 0220 (early check), 0221, 0222 (generated), 0223, 0224 (generated). None is cited by number in code.

**4. Voice's `bosToken`**
- `VoiceSessionResponse` no longer has `bosToken`, and `/voice/session` no longer sends it. The worker still receives the token in `VoiceDispatchMetadata`.
- Updated alongside: the contract fixture, the voice journey's stub answer, and `docs/06-api.md`.
- Test: `handlers.test.ts`. The route's raw answer has no `bosToken` and does not contain the worker's token; the token is verified from the dispatch metadata instead. It failed before the fix, since the strict schema rejects the key.
- `voice.spec.ts` passes in all three projects.

**5. WhatsApp quotes**
- (a) A STATUS or a code alone on a chat handled by people:
  - Migration 0221 redefines `app.whatsapp_record_inbound()` from 0188 (its newest definition on `main`). It gains `p_platform boolean default false`, and the waiting mark becomes `t.needs_reply or not p_platform`. Diff against 0188, nothing else changed:
    ```
    <   p_handled_by text
    >   p_handled_by text,
    >   p_platform boolean default false
    <          needs_reply = true,
    >          needs_reply = t.needs_reply or not coalesce(p_platform, false),
    ```
  - The 8-argument function is dropped and the 9-argument one granted to `app_user` as before. `messaging.inbound.record` passes its existing `platform` flag.
  - Test: `whatsapp-quotes.test.ts` (domain). STATUS alone leaves the chat not waiting, and `app.notice_whatsapp_waiting()` does not list it; a question followed by STATUS still waits and is listed. It failed before the fix.
- (b) A message the messaging worker refuses after the quote was marked sent:
  - `whatsapp_milestone_sends.requested_by` (0222, nullable, FK to `principals`) keeps who asked for the milestone: the quote's sender, from `sales.quote.sent`.
  - Migration 0223 redefines `app.whatsapp_queue_milestone()` from 0201 with `p_requested_by uuid default null`, written in both inserts. It also redefines `app.whatsapp_send_extras()` from 0203 to return `requested_by`. Diffs: only those lines; grants as before.
  - `send.ts` (`tellQuoteSender`): after any refusal is recorded on a `quote_sent` message, the sender is told through the existing `whatsapp_quote_not_sent` notice (`notifyEvent` with `sales.quote.sent`, once per quote). This covers the window, the template, a STOP, the filter, and `tier_budget_reached` (the lead's addition). A failure to notify is logged and the refusal stands.
  - Tests: `apps/web/tests/whatsapp-quotes.test.ts`, +2. A quote refused at the messaging limit (window closed, limit 0) and one refused for a STOP after queueing: the worker sends nothing and the sender gets the notice. Both failed before `send.ts` changed. The domain test of `readSendExtras` now carries `requestedBy`.

**6. The audio player**
- A failure is signed again once. The page instead says the browser cannot play the recording, with a "Download the recording" button, when either:
  - a failure comes before the address loaded, after one new address was already signed, or
  - a failure comes under 5 s after signing.
- The download is `openFile(fileId, true)`, which signs an `attachment` address.
- Copy: `knowledge.file.notPlayable` and `knowledge.file.downloadRecording`. The second key is added to the copy-lint button list.
- Journey `knowledge-audio.spec.ts`, new case: every media request answers bytes no browser plays, after 5.5 s. Exactly two addresses are asked for, the sentence and the button show, no third address comes in the next 6 s, and axe is clean. It failed on the build from before the fix (the sentence never showed) and passes in all three projects.

**7. The dialled call**
- Both workspaces (`calling-screen.tsx`, `use-call-logging.ts`) clear the dialled call and remount the call bar only when the saved log is the dialled call's own lead.
- Journey `click-to-dial.spec.ts`, new case: dial lead B, open lead A in the same page, save A by hand, return to B. B's bar still reads "The call has ended. Choose its outcome to save it.", and saving B records its outcome with no "saved already". On the old build it failed exactly there (line 109); it passes in all three projects.

**8. Website keys and attached enquiries**
- Tests for the three gaps. The code was already right (the finding says so), so these cases guard behaviour rather than fail first.
  - Domain `lead-ingest.test.ts`, +2: another company's live website is refused (`lead_source_missing`), even for an Executive of both companies. A key whose site was archived is found without the site or its consent, and no new key takes the archived site.
  - Security `lead-ingest.test.ts`, +1, the insert policy alone through direct inserts: a live site of the key's company passes; another company's site, an archived site and a form are refused.
- The notice:
  - `crm.lead.attached` gains `nurtured` and `attachedBy` (both optional in the catalogue, so older events still parse) and becomes subscribed: `NOTICE_EVENT_TYPES`, the registry, the QStash map.
  - Both emitters set the new fields: `attachEnquiry()` from the lead's state before it is reopened, and `crm.lead.ingest` from `ingest_customer`'s `lead_state`; there the lead stays in nurture.
  - The new notice kind `enquiry_attached` goes to the lead's owner now, once per event. It is not sent when the owner added the enquiry, or when the lead was not in nurture.
  - Registration: `NOTICE_TYPES`, the check constraints in 0224 (`NOT VALID`, as 0202 did), `en.json` (kind and push), and `docs/05-database.md`. Each shared list carries a `p2-fixes` comment.
  - Tests: `notifications.test.ts`, +2 (told once; nobody when the owner added it or the lead was not nurtured). They failed before the fix. `catalogue.test.ts` and `qstash.test.ts` were updated to list the event.
  - Screen changed: Notification settings gains one row. Its Linux baselines were remade and verified per project, each on a fresh database.

**9. The Concierge and a failing AI service (the lead's addition)**
- Choice: hand off at once (`no_assistant`), not through the three-in-a-row streak:
  - The stops before the model (switched off, no spending limit, spend or runs used up) already hand off at once as "the assistant cannot answer now", and an outage is the same case.
  - The streak exists because one refused draft says little about the next. An outage drafts nothing for every message while it lasts (the provider's breaker pauses the vendor for minutes), so counting would leave up to two more customer messages unseen.
- Code (`run-concierge.ts`): a reply run whose recorded outcome is `unavailable` (the provider's `integration_unavailable`: an outage, the breaker open, a deadline) or `cap_reached` (the spend reached while asking) hands over with cause `unavailable`. The chat goes to people with reason `no_assistant` in its history, and the refusal count is cleared.
- `docs/03-roadmap-appendix/phase2.md` §7.2's built line says so.
- Test: domain `concierge-runs.test.ts`, +1, a fake transport answering HTTP 503 (no live model call). The reply run is `unavailable`, the chat is with people for `no_assistant`, nothing is drafted, the refusal count is clear, and a redelivery is skipped without asking again. It failed before the fix.

**Checks in this VM (final)**
- `pnpm typecheck`: 10 of 10.
- `pnpm lint` (whole repository): clean.
- `pnpm copy-lint`: clean.
- Unit tests: contracts 322, domain 2593, db 160, web 1155 (+1 skipped).
- `pnpm test:security` after item 9: db 1513, domain 1395, web 447 (4 of 4 tasks).
- `pnpm db:docs` and `machines:docs`: regenerated, in the commits.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within budget (55).
- Journeys in the Linux image (`e2e:snap`) on the final build, specs `roles`, `voice`, `knowledge-audio`, `click-to-dial`, `notifications`, `calling`, `converting`, `whatsapp-quotes`:
  - On the long-used database, every journey passed except five pictures and one notice count:
    - `whatsapp-templates` showed a template my suites registered;
    - `calling` showed company numbers left by the suites;
    - the snapshot caller had a fourth notice (a `whatsapp_reply_waiting` from the suites);
    - `notification-settings` (expected, the new row);
    - `converting-board` (the lead's known fault).
  - Each project was then rerun on its own fresh database (`fresh-db.sh` on this VM's own `shakti-postgres`), for `calling`, `converting`, `notifications` and `whatsapp-quotes`. Only `notification-settings` (remade, then verified: 20, 19 and 19 passed) and `converting-board` failed.
  - `converting-board` fails in all three projects: the lead's known DND-date fault, fixed on techaust/shakti_prime#269. Its baseline is untouched.
- Function diffs against `main`, one line each:
  - 0219 `app.role_may_hold()`: the agent-only clause;
  - 0220 `app.customer_idle()`: the WhatsApp clause;
  - 0221 `app.whatsapp_record_inbound()`: the platform argument and the waiting mark;
  - 0223 `app.whatsapp_queue_milestone()`: `requested_by` in its two inserts and its argument; `app.whatsapp_send_extras()`: `requested_by` returned.

**Review checklist**
- Every redefined SQL function keeps every clause `main` has (diffs above).
- No staff role can be granted `agents.note.write` (the command, the guard and the oracle).
- The filter still refuses every number not in the customer's name (9 refusal cases).
- The anonymisation and its count agree (the window's `stale` equals the action).
- Nothing reaches a customer without a person: item 9 only hands chats to people, and item 5 tells staff.
- Each item has a test that failed before its fix, except item 8's three tests, which the finding names as missing tests only.

**Assumptions**
- (5b) Only a refusal tells the sender. A send Meta errors on is recorded `failed`, and a timeout may still have delivered it, so it tells no one.
- (5b) A refused `order_confirmed` milestone tells no one: it has no `requested_by`.
- (6) A failure under 5 s after signing is taken as the file's own, and the download is offered at once.
- (8) The notice is for a nurtured lead only, as the brief says. An attach to an active lead tells no one, since its owner is working it.
- (8) For an integration's lead (`crm.lead.ingest`), the notice goes to the owner even though the lead stays in nurture; it is the only signal they get.
- (9) `failed` endings (a bug, not the service) do not hand over. They are logged as errors.
- Repository debris: the long-used local database fails three journeys that pass on a fresh one. CLAUDE.md already requires fresh databases for journeys, so it is not a new follow-up.

**Skills loaded:** none (no command or table added).

### 20-11-2026, cloud session: fixes (the lead's review at 5ad17101)

**M1, the Concierge's name exemption (5bc544e5)**
- `withoutCustomerName()` in `claims.ts` now exempts nothing when every word of the name is a number word, titled forms included ("Das", "Paanch Hazaar", "Five Thousand").
- The titled forms still take the whole name or one word of it. All matches are found first, and a match is left alone when the word beside it (spaces skipped) makes any claim, or when it touches another match, so matches cannot chain into a number phrase.
- Tests in `filter.test.ts`:
  - refused: the review's three ("Five Thousand" with "That comes to five thousand sir."; "Ramesh Paanch Hazaar" with "Shri paanch hazaar ji."; "Ramesh Das" with "Mr Das das ji."), plus "Paanch Hazaar" with "Woh paanch hazaar ji hoga.", "Ramesh Das" with "Namaste Das ji das hazaar." and "Das" with "Namaste Das ji, …";
  - passing: every earlier passing greeting except "Das ji" for a customer named just "Das", which moves to refused under the all-number-words rule; plus "Namaste Shri Ramesh Das ji, …".
- Each of the review's cases blanked its number words under the old function (checked with a throwaway test against both versions, 4 failed and 4 passed) and keeps them under the new one.

**L1, item 7 on the converting workspace (af89643c)**
- `converting.spec.ts`, new case: Kishan Verma, company 1's Lead Converter (company 1 has calling numbers), dials lead B from the bar, saves lead A by hand, returns to B and saves it.
- An Executive then finds one "Play recording" on B's customer page, which means the log names the placed call.
- Against a build with the hook as it was before item 7, it fails exactly there (0 recordings: B's log was saved unlinked). With the fix it passes in all three projects.
- Found while writing it: this workspace rebuilds the calls panel per lead and per tab (`lead-workspace.tsx`, the panel body is keyed by lead and tab). So its call bar never shows B's ended call after a switch, before or after this slice; only the save's link is kept. The calling screen's bar does keep it. Left as it is; whether the bar should survive a tab or lead switch there is a design choice for the lead.

**L2, the download path (84a8cd66)**
- `knowledge-audio.spec.ts`: the unplayable-recording case clicks "Download the recording" and expects a download with a filename and no failure, and no third address is asked for.
- Against a build whose `openFile` signs the address inline, the step fails (no download event within the test's time). With the real code it passes in all three projects.

**Checks in this VM, after the fixes**
- `pnpm typecheck`: 10 of 10. `pnpm lint` (whole repository): clean. `pnpm copy-lint`: clean.
- Unit tests: contracts 322, domain 2593, db 160, web 1155 (+1 skipped).
- `pnpm test:security`: db 1513, domain 1395, web 447 (4 of 4 tasks).
- `pnpm build`: passed. js-budget: 55 pages within budget.
- Journeys in the Linux image, each project on its own fresh database, specs `roles`, `voice`, `knowledge-audio`, `click-to-dial`, `notifications`, `calling`, `converting`, `whatsapp-quotes`: 44, 43 and 43 passed. The one failure per project is `converting-board`, the lead's known DND-date fault (fixed on techaust/shakti_prime#269), whose baseline is untouched. No baseline changed in this round.
- The DATABASE rows' migration numbers are left as they are, as asked.
- The VM restarted before this round. The session hook's `docker compose` could not start Postgres beside the container `fresh-db.sh` had made, so the database was recreated with `fresh-db.sh` and migrated.

## Review

## Integration
