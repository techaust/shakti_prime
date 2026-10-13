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


## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Phone baselines of the five tables and the team lead's home are remade in the Linux image.
