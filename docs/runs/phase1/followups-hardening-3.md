# Hardening follow-ups, batch 3 (wave 6, after G1)

| | |
|---|---|
| Branch | `fix/followups-hardening-3` on GitHub, from `main` at 42555caa (#189) |
| PC worktree | `followups-hardening-3`, slot 2: Postgres 54332 (container `shakti-pg-followups-hardening-3`), app 3032 |
| Runs on | PC (owner, 17-10-2026: spend the week's remainder before the reset; the lead runs it while the owner is away) |
| Tier | B (the handover's state machine, workers, permissions): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | build Opus medium from week 96 (18-10-2026) |
| State | building |
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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
