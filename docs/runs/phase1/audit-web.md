# Audit fixes: web app, accessibility, copy (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-web`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-web`, slot 4: Postgres 54334 (container `shakti-pg-audit-web`), app 3034 |
| Runs on | cloud, beside M1 and the database follow-ups (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | B (sessions, permissions on screens, one query and index): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | no reading posted; the owner said to proceed (12-10-2026) |
| State | building |
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
16. **ARCH-6:** the seven pages without a JavaScript budget get measured entries (+5 %), and `js-budget` fails on an app page with no entry.

Not here: WEB-12 ("Order" or "Sales Order") waits on the owner's choice. Anything M1 builds (`feat/m1-migration-uat`: the import job page's reconciliation section, anonymisation, the role journeys) and the database follow-ups (`fix/followups-db`: notifications, commission accruals, the Triage shadow report, audit partitions). Shared lists are append-only.

Done when: the checks of AGENTS §10 pass on the branch; every changed journey passes twice in a row on the same database; `js-budget` holds for every page.

**Migrations:** if one is needed (the order number index), start at 0132 (M1 and the database follow-ups take 0130 and 0131 for now; the lead renumbers at the merge).

**How to work:** commit at least every 20 minutes and after each finding; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files; the whole-repository lint once, last. Other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash /home/user/shakti_prime/tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service. Remake no screenshot baseline on the host: list them for the lead.

**Reviewer's checklist (check it yourself before reporting):** no change lets a page or action reach the database except through `executeCommand()`/`executeQuery()`; the session change cannot lengthen a session without a person's action and cannot shorten the idle rule; every new word in `en.json` and plain (copy lint); focus and announcements checked with a keyboard and the axe checks; no client bundle grew without a budget entry saying why.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Phone baselines of the five tables and the team lead's home are remade in the Linux image.
