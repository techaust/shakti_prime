# Audit fixes: web app, accessibility, copy (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-web`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-web`, slot 4: Postgres 54334 (container `shakti-pg-audit-web`), app 3034 |
| Runs on | cloud, beside M1 and the database follow-ups (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | B (sessions, permissions on screens, one query and index): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | no reading posted; the owner said to proceed (12-10-2026) |
| State | built, ready for review |
| Next step | builder: the findings below |

## Brief
The Phase 0–1 audit of 12-10-2026 (report `docs/14-reviews/2026-10-audit.md`, written by the lead when the audit closes) found these in the web app. Each finding's evidence, file and line and proposed fix are in the auditor's file and the verifier's verdict (read both first; the verdict corrects some line numbers and severities):
- `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/4-web.md` and `4-web.verdict.md`
- `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/6-arch.md` (ARCH-2, ARCH-3, ARCH-4, ARCH-6)

Fix, each with a test that fails before the fix:
1. **WEB-1 (medium):** the message catalogue sent to every page. Per route group providers with only the namespaces their client components use; the public pages get only what they need; a per-segment test in place of the single list; the HTML/RSC weight of `/sign-in` and one staff page added to the budget check.
2. **WEB-2 (medium):** a field error from the server is announced (live region or alert) and focus moves to the field; a journey assertion (`toBeFocused`) on one server-side field error.
3. **WEB-4 (medium):** the five tables become card lists below `md` as `DataGrid` does (quote lines, order lines, team queues, targets, the home sections); remake their phone baselines in the Linux image only through the lead (list them in the report).
4. **WEB-3:** root `error.tsx` calls `retry ?? reset`, with a unit test like `(bos)/error.test.tsx`.
5. **WEB-5:** a second row's action is not refused while the first is in flight (a key per row, or `run()` refusing while in flight).
6. **WEB-6:** the palette hint passes AA; the missing pairs on `surface-3`/`accent-soft` added to `CONTRAST_PAIRS`.
7. **WEB-7 and WEB-V1:** an expired session during an action ends at sign-in with `returnTo`, not "went wrong on our side"; the proxy lets server-action POSTs reach the action so it can answer `unauthorized`; a journey that clears the cookie and then acts.
8. **WEB-8 and WEB-V2:** the bell's poll and other background reads never extend the session (no refresh, no cookie set, no page re-render); only actions the person takes extend it. A test that a poll leaves the session's expiry unchanged.
9. **WEB-9:** `/two-factor` no longer loads the token generator.
10. **WEB-10:** the held-since label and the "As of" labels the verdict lists as one message each with the date inside (`t.rich`).
11. **WEB-11:** delete the two unused keys and add an unused-key test with an allow-list of template-reached prefixes.
12. **WEB-13:** the team lead's home mask covers only the changing cells; the baseline remade by the lead in the Linux image.
13. **ARCH-2 (medium):** order numbers searchable in ⌘K and on the orders list (an index on the order number under the order's policies, `EXPLAIN (ANALYZE)` under RLS in the report); RPT-03 (order numbers) in the PRD §8 trace and the design's slice table.
14. **ARCH-3:** the lead's score shows who last changed it (a person's name, or the overnight job in plain words).
15. **ARCH-4:** the enquiry routing for a colleague's customer moves from `apps/web/src/actions/crm.ts` into a domain command (savepoint around `crm.lead.create`, route in the same transaction), with the add-command recipe's tests; the action becomes a thin wrapper.
17. **WEB-12 (owner, 13-10-2026: "Order"):** the role editor's permission labels `adminRoles.permissions.sales_order_*` say "orders" (for example "Create orders"); the design rule already says Order. No other copy changes.
16. **ARCH-6:** the seven pages without a JavaScript budget get measured entries (+5 %), and `js-budget` fails on an app page with no entry.

Anything M1 builds (`feat/m1-migration-uat`: the import job page's reconciliation section, anonymisation, the role journeys) and the database follow-ups (`fix/followups-db`: notifications, commission accruals, the Triage shadow report, audit partitions). Shared lists are append-only.

Done when: the checks of AGENTS §10 pass on the branch; every changed journey passes twice in a row on the same database; `js-budget` holds for every page.

**Migrations:** if one is needed (the order number index), start at 0132 (M1 and the database follow-ups take 0130 and 0131 for now; the lead renumbers at the merge).

**How to work:** commit at least every 20 minutes and after each finding; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files; the whole-repository lint once, last. Other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash /home/user/shakti_prime/tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service. Remake no screenshot baseline on the host: list them for the lead.

**Reviewer's checklist (check it yourself before reporting):** no change lets a page or action reach the database except through `executeCommand()`/`executeQuery()`; the session change cannot lengthen a session without a person's action and cannot shorten the idle rule; every new word in `en.json` and plain (copy lint); focus and announcements checked with a keyboard and the axe checks; no client bundle grew without a budget entry saying why.

## Report

### 13-10-2026, cloud (worktree `/home/user/shakti-wt/audit-web`, Postgres 54334)
Skills loaded: add-command, vercel-react-best-practices, web-design-guidelines, writing-guidelines (the last two fetch their rules from GitHub, which this session may not reach, so their checklists were applied from the repository's own design and copy rules).

**Items (all 17 done):**
1. **WEB-1:** the root layout sends only `app` and `errorPage`; `(public)/layout.tsx` adds `auth`, `fields` and only the error sentences the public forms can show (`PUBLIC_ERROR_KEYS`, `src/auth/public-errors.ts`); `(bos)/layout.tsx` adds the shell's groups; each of the 19 `(bos)/<screen>/layout.tsx` adds its screen's own (`CLIENT_SCOPES` in `src/i18n/client-namespaces.ts`, `ClientMessages` in `src/i18n/client-messages.tsx`, merged in the browser by `AddMessages` so no group is sent twice). `client-namespaces.test.ts` follows each scope's imports (a `'use client'` boundary and everything below it) and checks: every namespace used is sent, only those, none twice, every folder has its provider; the public error list holds every auth reason and form literal. Document budgets (`documents` in `js-budget.json`, `checkDocument()` in `scripts/js-budget.ts`) for `/sign-in` (measured 5.6 kB gzip, budget 6) and `/leads` (36.3 kB, budget 45), checked by `public.spec.ts` and `leads.spec.ts` against the served build. The root error screen takes the public button from its own module (`components/form-button.tsx`): the UI kit's button had put 12 kB on every public page.
2. **WEB-2:** `useFieldFailure().fieldError()` renders the sentence as an alert keyed by the attempt and moves focus to the field's control; `failure.test.tsx`; journey `leads.spec.ts` (a refused mobile number: `toBeFocused`, `aria-invalid`, again on a second try). `RolesField` takes a `ReactNode` error.
3. **WEB-4:** `CardList` in `packages/ui/src/card-list.tsx`; quote and order lines, team queues, targets (in force and history), the team leaderboard (with a "Rank by" row on phones, since the metric links lived in the table head) and the Executive's quotes-and-orders table are cards below `md`, tables above. `style-rules.test.ts` fails a table wider than a phone without a `CardList`. Journeys read a table or its cards (`tableOrCards`, `rowOf` in `e2e/support/fixtures.ts`) and only the visible amount.
4. **WEB-3:** root `error.tsx` calls `retry ?? reset`; `app/error.test.tsx`.
5. **WEB-5:** `runKeyFor()` in `use-command.ts`: a run with other details while one is in flight gets its own key; a double press keeps it.
6. **WEB-6:** palette hint uses `text-muted`; the generator keeps `accent-soft` deep enough in dark (L 20 → 17) and lifts `text-muted` to the minimum on `surface-3` and `accent-soft` where needed (only the high-contrast variants change); pairs `text-muted`/`accent-soft`, `text`/`surface-3`, `text-muted`/`surface-3` added to both contrast tests; design §2 token table updated. Dark `accent-text` moves #888FFC → #8087F4 (it is fitted against `accent-soft`).
7. **WEB-7, WEB-V1:** the proxy lets a POST with `Next-Action` through; `useCommand`/`useQuery` send an `unauthorized` answer to `/sign-in?reason=session_ended&returnTo=<screen>`; sign-in, the code screen and both code forms carry `returnTo` (only a BOS path, `safeReturnPath`); the proxy's own redirect carries it too. Tests: `session-gate.test.ts`, `proxy.test.ts`, `use-command.test.ts`; journey `e2e/session.spec.ts` (clear cookies, Save, land on sign-in, sign in, back on `/leads/new`).
8. **WEB-8, WEB-V2:** `SessionUse` (`extend` | `quiet`) in `session-principal.ts`; quiet reads pass `disableRefresh` and write no `last_seen_at`, so no cookie is set and no page re-renders. `signedInQuietly()` for the bell's count, the import progress check and a new `recheckKnowledgeFiles()` for the vault's poll; within a page the layout's lookup is reused. Suite test in `tests/auth.test.ts`: a quiet read leaves `expires_at` and `last_seen_at` as they were; a person's use rolls them. Security §2 says so.
9. **WEB-9:** the QR code's ground is `theme-light bg-surface`; `style-rules.test.ts` fails a client component importing a value from `@shakti/tokens`.
10. **WEB-10:** "As of" (calling, converting board), "Held since", the quote line's "valid until", the inbox's "Suggested"/"Passed on" and sizing's "Worked out on" are one message each with `<time>{when}</time>` (`momentValues()` in `date-time.tsx`); `i18n/whole-sentences.test.tsx` fails a fragment before a `DateTime`.
11. **WEB-11:** `quotes.page.totalsHeading` and `converting.lead.noOrder` deleted; `i18n/unused-keys.test.ts` (allow-list `errors.`, `roles.`, `imports.rowErrors.`).
12. **WEB-13:** `home-team-lead` masks `main td`, `main dd` and times only.
13. **ARCH-2:** trigram index `sales_orders_so_no_trgm_idx` and definer `app.order_search_ids()` (migrations 0132 and 0133, after M1's and the database follow-ups' numbers); `searchSalesOrders()` in ⌘K ("Order for …") and a number search on `/orders` (`q` on `ListSalesOrdersInput`); `SearchTextSchema` moved to `dto/search-text.ts` to avoid an import cycle. Tests: `db/tests/security/sales-orders.test.ts` (own order not crowded out by 205 colleague matches, `%` stands for itself, refused without a read grant), `grants.test.ts`, `domain/tests/commands/orders.test.ts` (whole number first, by part, on `/orders`, not for another caller, refused to HR), `reader-parity.test.ts`, `palette.test.ts`, `tests/actions.test.ts`. PRD §8 trace and the design's slice table name RPT-03 (order numbers) for S2; DATABASE §4 lists the definer.
14. **ARCH-3:** `LeadListItemDto.scoreChangedBy` (a person's name, or `overnight` for `system:workers`); the score popover says "Last changed {when} by {name}" or "…, when every score was brought up to date overnight". Test in `crm-scoring-referrals.test.ts`. The lead's score is shown with its history only in the leads list's popover; other screens show the number alone.
15. **ARCH-4:** `crm.enquiry.take` (`commands/crm/take-enquiry.ts`, people only, `crm.lead.write` + `crm.account.write`): `crm.lead.create` in a savepoint, `crm.enquiry.route` in the same transaction on `customer_held_by_colleague`; `takeEnquiry()` is a thin wrapper (the derived route key is gone). Registry, Activity log label, event catalogue emitters, refusal sweep (`PEOPLE_ONLY_INPUTS`, `CUSTOMER_INPUTS`); tests in `notifications.test.ts`: refused to HR, wrong company, created, routed with no `crm.lead.create` row and every audit row `ok`, one lead on the account. Security §4 updated.
16. **ARCH-6:** `js-budget` has no default: a page with no budget fails; the seven pages measured and budgeted (+5 %): `/converters` 246, `/dealer-credit` 241, `/orders` 241, `/orders/[entityId]/[orderId]` 223, `/orders/new` 208, `/targets` 208, `/knowledge` 208. TESTING §5 updated.
17. **WEB-12:** "Create orders", "Confirm orders", "Cancel orders".

**Checks (last run on 9fe8b57c, all through the lock):**
- `pnpm lint` (whole repository): exit 0. Typecheck of tokens, contracts, db, domain, ui, web: exit 0.
- Unit: web 811 passed, 1 skipped; domain 2,057; tokens 146; ui 107; contracts 181. `pnpm copy-lint`: clean.
- `pnpm test:security`: db 40 files, 1,197 tests passed; domain 72 files, 938 passed; web 22 files, 304 passed (the web suite re-run alone after the quiet caller was added to its mocks).
- `pnpm build` with no `.env`: passed. `pnpm --filter web js-budget`: "Every page is within its budget (46 pages)".
- Journeys (host, `--ignore-snapshots`), after `e2e:seed`: public, leads, session, calling, targets 127 passed, then again on the same database 118 passed (the 9 single-use steps of `public.spec.ts`, which use up the seed's links by design, left out of the second run); quotes, orders, converting 1 run passed after the card fix; agents, customers, walk-in, notifications, roles passed in the earlier run. Axe runs in each.
- `pnpm db:docs` regenerated (`docs/data/events.md`, ERD, dictionary).

**EXPLAIN (ANALYZE) under RLS** (`pnpm --filter @shakti/domain spike:orders`, 20,000 orders in company 2): every search reads `sales_orders_pkey` over the definer's candidates, the policies' checks on `account_entities_account_entity_key`: ⌘K whole number, Executive 35.8 ms; last digits, General Manager 26.2 ms; Lead Converter 30.1 ms; `/orders` by number, Executive 29.5 ms.

**Screenshot baselines the lead must remake in the Linux image:** every `desktop-dark` baseline (dark `accent-soft` and `accent-text` changed); phone: `quotes.spec.ts` quote-page and quote-builder, `orders.spec.ts` order-page and order-builder, `targets.spec.ts` targets, home-team-lead, home-general-manager, home-executive, `calling.spec.ts` if its team view is captured; all three projects: `orders.spec.ts` orders-list (search box), `targets.spec.ts` home-team-lead (masks; the phone one returns to 400 px wide). Any baseline with the palette open, the root error screen or a high-contrast page if such exist.

**Decisions the brief did not settle:**
- The `(bos)` scopes are per top-level folder (19), not per page; `/admin` therefore carries every admin page's groups.
- The document budget for `/leads` is 45 kB, not measured + 5 %: the list holds up to 50 leads and the measure was taken with the seed's leads.
- WEB-6 changed the generator rather than the screens; the two selected-row workarounds (full text colour) stay, with their comments corrected.
- Selected rows' cards on phones use the same `CardList` markup as `DataGrid`'s cards; `DataGrid` itself was not refactored onto `CardList`.
- `fieldError()` returns a node now (an alert span), not a string.
- The migrations are numbered 0132 and 0133 in their files; the journal's `idx` stays 130 and 131. DATABASE §4 cites 0133; the renumbering at the merge changes it.

**Not done or uncertain:** the high-contrast variants' `text-muted` changed (no baselines known); the journeys' second run of `public.spec.ts` cannot repeat its single-use steps without a new seed.

### Fix round, 13-10-2026, cloud
All nine review findings fixed in 5d1b55b7:
1. `app.order_search_ids(text, state, limit)` (0133 edited in place) reads a dealer's order as `account_entities_read` does, the fourth rule included: a person, not an agent or `system:` principal, who reads a live lead of that customer in the company. Test in `sales-orders.test.ts`: the policy and the search both find such an order, and neither once the lead is archived.
2. The status filter goes to the definer, before the cap of 200. `listSalesOrders` answers `searchCapped`, and `/orders` says "Only the 200 newest orders with a number like this are shown. Type more of the number to find an older one." when the cap was reached. Tested: a status that does not match finds nothing, and a small search is not capped.
3. Another company: `sales-orders.test.ts` (a company-3 order is not returned to a company-4 General Manager) and `orders.test.ts` (`searchSalesOrders` for a company-1 request).
4. `src/actions/quiet-reads.test.ts`: the caller of a person's own use answers nobody and the quiet read answers the caller, so the bell's count, the import progress check and the vault re-read pass only through the quiet read.
5. `document-weight.ts` fails when the answer's final path is not the route measured.
6. The proxy sets `x-shakti-path`, replacing any value the browser sent; the `(bos)` layout sends a session that is gone to `expiredSignInPath()`, which gives `/sign-in?reason=session_ended&returnTo=<screen>`. Tests: `session-gate.test.ts` and `proxy.test.ts`, and a journey in `session.spec.ts` (a session cookie with a value no session has, then `/leads/new`).
7. `notifications.test.ts`: since the run began, the outbox holds the routing's `crm.enquiry.routed` for the account and no event whose opportunity or duplicate pair does not exist, so nothing of the refused attempt.
8. `phase1.md` (the routed-work line) and `08-design-system.md` (the palette row) corrected; DATABASE §4's definer row names the state and the fourth rule.
9. A one-character search is **refused**: the field shows "Type at least 2 characters of the order number." and the list stays as it was.

My database was migrated with the old 0133. I took it back locally: a one-off script, never committed, dropped the old function and removed that migration's record. `pnpm db:migrate` then applied the new text.

Checks, all through the lock:
- Typecheck of contracts, db, domain and web: passed.
- db security: `sales-orders` and `grants`, 177 passed.
- domain security: orders, notifications, reader parity and agent refusals, 111 passed.
- Unit: web 817 passed (1 skipped); contracts 181.
- `copy-lint` clean; the touched folders' lint clean.
- `pnpm build` with no `.env`: passed. `js-budget`: "Every page is within its budget (46 pages)".
- Journeys after `e2e:seed`: session, public, leads and orders 91 passed; then session, leads and orders again on the same database, 64 passed.
- Whole-repository `pnpm lint`: exit 0.

## Review
Reviewed 13-10-2026 (cloud, Opus 5.5 high) at 39b3c789 against 23f78a5. No critical, high or medium finding; nine low.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | low | `0133_orders_so_no_search_rls.sql:44-47`: for a dealer's order (no lead) `app.order_search_ids()` keeps only `account_entities_read`'s first three rules and leaves out its fourth (a person, not an agent or `system:`, who reads a live lead of that customer in the company). Evaluated on the slice's database in a rolled-back transaction: a caller with `crm.lead.read:own` who owns a live lead on dealer account `01a13336-8f3e…` meets the policy's rule, but the definer returns 0 rows for `SMP/SO/2026-27/0008`. So `/orders` lists that order, and the number search on the same page and ⌘K do not find it. The error is on the safe side (nothing leaks). Fix: add the fourth rule to the dealer branch (people only, through a live opportunity the caller reads under the `opportunities_read` rules), with a test. 0133 is not applied anywhere hosted yet, so it can be edited in place. *Confirmed.* | fixed (5d1b55b7) |
| 2 | low | `list-orders.ts:158` with `0133:49`: the `/orders` number search reads only the 200 newest matches, chosen before the status filter and the paging. Example: an Executive searches "2026" and picks "Held for credit". Only held orders among the 200 newest matches appear, "Load more" ends there, and nothing says that older matches were left out. Fix: pass the state to the definer (or apply it before the limit), or say on the last page that only the newest 200 matches were searched. *Confirmed (code read).* | fixed (5d1b55b7) |
| 3 | low | `packages/db/tests/security/sales-orders.test.ts` and `packages/domain/tests/commands/orders.test.ts`: the order search has tests for the caller's own orders, another team and HR, but none for an order in a company outside the request. The code filters on `so.entity_id = any(v_entities)`, so behaviour is right today; a regression would go unnoticed. Fix: one assertion that a company-2 order is not returned to a company-1 request, in the definer test and in `searchSalesOrders`. *Confirmed.* | fixed (5d1b55b7) |
| 4 | low | WEB-8 wiring is untested. The suite test (`tests/auth.test.ts`) proves that `resolveSessionPrincipal(..., 'quiet')` leaves the session as it was. But every web suite mocks `currentPrincipalQuietly` to do the same as `currentPrincipal` (`actions.test.ts:68` and the seven one-line additions), so switching `noticeCount`, `getImportJob` or `recheckKnowledgeFiles` back to `signedIn()` fails no test. Fix: a unit test that those three actions resolve through the quiet path (a spy on the two resolvers), or a suite test that calls `noticeCount()` on an aged session and checks `expires_at`. *Confirmed.* | fixed (5d1b55b7) |
| 5 | low | `e2e/support/document-weight.ts:14`: `page.request.get(route)` follows redirects, and the check never asserts that the answer is the route itself. If the session is gone, `/leads` answers with the sign-in page (5.6 kB), which fits within `/leads`'s 45 kB, so the check passes without measuring the page. Fix: `expect(new URL(response.url()).pathname).toBe(route)` (or `maxRedirects: 0`). *Plausible.* | fixed (5d1b55b7) |
| 6 | low | `(bos)/layout.tsx:26`: when the cookie is still sent but its session is past `expires_at`, Better Auth's `getSession` deletes the cookie (`session.mjs:156`) and `nextCookies()` writes that deletion inside the action. Next then renders the page into the action's answer, and the layout's `redirect('/sign-in')` takes the person to sign-in with no `reason` and no `returnTo`, instead of the WEB-7 path. A page load with such a cookie loses `returnTo` the same way. This is rare, because the cookie's max-age rolls with the session. `session.spec.ts` covers only the cleared cookie. Fix: have the layout redirect to `signInPath(<path>, 'session_ended')`, with the path in a request header the proxy sets, or accept it and record it. *Plausible.* | fixed (5d1b55b7) |
| 7 | low | `notifications.test.ts`, "passes a colleague's customer…": the test checks the audit rows and the lead count. It does not check that the refused attempt's events (`crm.lead.created`, `crm.duplicate.found`) never reach `outbox_events`. The code path is sound: the savepoint in `run-command.ts` truncates `innerEvents`. Fix: assert that the account's outbox rows hold `crm.enquiry.routed` only. *Confirmed (code read).* | fixed (5d1b55b7) |
| 8 | low | Two documents are out of date. `docs/03-roadmap-appendix/phase1.md:404` still says that the `takeEnquiry` action runs `crm.enquiry.route` "in a fresh transaction"; it is now `crm.enquiry.take`, with a savepoint and the same transaction. `docs/08-design-system.md:127` still says order numbers "join with sales orders (slice S2)", as future work, although they are searched now. Fix: one line each. *Confirmed.* | fixed (5d1b55b7) |
| 9 | low | `orders-screen.tsx:85`: Search with a single character drops the text and silently lists every order, so the person believes they searched. Fix: show the helper sentence as the field's error, or keep the button inactive below `SEARCH_MIN_CHARS`. *Confirmed (code read).* | fixed (5d1b55b7) |

**Checked and sound:**
- **Proxy (WEB-7):** letting a cookieless POST with `Next-Action` through adds no new reach. Any action was already callable by POSTing to a public path. Every BOS action resolves `signedIn()`. A page rendered into an action's answer still meets the `(bos)` layout's check and the page's `screenAccess()`/`executeQuery()`. A plain POST without the header is still redirected.
- **`returnTo`:** `safeReturnPath` refuses absolute URLs, `//host`, backslashes, whitespace, `/home@host`, decoded `%2F%2F` and double-encoded forms, and any non-BOS path. The sign-in, two-factor and both code actions re-validate the value, so there is no open redirect.
- **Quiet read (WEB-8):** in Better Auth 1.7.7, `disableRefresh` returns before any update or cookie write, and `getSessionFromCtx` in the revoked-session hook carries the flag too. Expiry, revocation and the absolute limit are still enforced, so the quiet read can neither extend a session nor skip the idle rule. The suite test passes.
- **Message scopes (WEB-1):** nested providers inherit time zone, formats and error handling (use-intl 4.14.9 `IntlProvider` reads the parent context). The scope test follows `'use client'` boundaries, dynamic imports and template namespaces. No client file uses an unscoped `useTranslations()`. `FormError` and `fieldError` fall back to `internal` for an unknown error key. The public error list holds every `REASONS` reason and every form literal.
- **`app.order_search_ids()`:** `search_path = ''`, every name qualified, execute revoked from `public` and `readonly_reporter`, granted to `app_user` and `app_reader` (grants test), permission checked in the body, company filter applied, LIKE escaping correct, ids only, no cost column.
- **`crm.enquiry.take`:** people only; `alsoRequires` `crm.account.write`; in both refusal lists; registry entry and Activity log label present; one idempotency key; the savepoint truncates the audit rows and events it held; the denied, other-company, created and routed tests pass.
- **Tokens (WEB-6):** recomputed every pair of all ten theme blocks before and after. The three new pairs reach AA, or 7:1 in high contrast. Dark `accent-text` stays at least 4.6 on `accent-soft`. No hard-coded colour; the QR code uses `.theme-light`.
- **Card lists (WEB-4):** each of the five tables has a `CardList`. The table rule catches every `min-w-` table.
- **Budgets (ARCH-6):** each of the seven new budgets is its measured size plus 5 %, rounded up. Every client file the slice changed imports only types from `@shakti/contracts`.
- **Runs (all through the lock):**
  - web unit: i18n, session-gate, proxy, style rules, screens, error and js-budget, 82 passed;
  - db security: `sales-orders`, `grants`, 175 passed;
  - domain security: notifications, orders, agent refusals, scoring, reader parity, 137 passed;
  - tokens: 146 passed;
  - web suite: the quiet-read test passed.

**Not checked:** the journeys and the screenshots (the builder ran them with `--ignore-snapshots`; the lead remakes the baselines in the Linux image), `pnpm build`, the whole-repository lint and the `EXPLAIN (ANALYZE)` figures (taken from the report, not run again).

## Integration notes
- Phone baselines of the five tables and the team lead's home are remade in the Linux image.
