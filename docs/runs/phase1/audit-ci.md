# Audit fixes: CI, merging, tests and documents (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-ci`, from `main` |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-ci`, slot 8: Postgres 54338, app 3038 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (the merge workflow decides what reaches `main`): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | the gate's reading at the start and end of each agent run |
| State | brief |
| Next step | the lead branches it from `main` and starts the builder |

## Brief
The audit's evidence: [`5-ops.md`](../../14-reviews/2026-10-audit/5-ops.md), [`5-ops.verdict.md`](../../14-reviews/2026-10-audit/5-ops.verdict.md) (OPS-7 and OPS-12 were refuted: do not fix them) and [`6-arch.md`](../../14-reviews/2026-10-audit/6-arch.md). Report: `docs/14-reviews/2026-10-audit.md`. The merge workflow runs from `main`, so its changes take effect after this merges; test them with `jq` on sample payloads and a scratch repository, as the auditor did.

1. **OPS-1 and OPS-V1 (medium):** a pull request merges only on the `main` it was tested with: when `main` moved, the workflow updates the branch (`gh pr update-branch`) and the new run decides; TESTING §6 says so.
2. **OPS-2 (medium; owner, 13-10-2026):** a pull request that changes the checks themselves (`.github/`, `turbo.json`, the vitest and Playwright configs) runs CI as usual but merges itself only once the owner has added the label `checks-ok`; every other pull request still merges itself on green. AGENTS §8 and TESTING §6 say so.
3. **ARCH-1 (medium):** the lint fences refuse `defineCommand`, `runCommand`, `executeCommand` with a command not from the registry, the audit, outbox and idempotency sinks, and `drizzle-orm` in `apps/web` outside the files that need them; `executeCommand` refuses a command missing from the registry at run time; a lint probe test.
4. **OPS-6 (low):** the missing denied and wrong-company tests for the commands the verdict lists, and a registry-driven check that every command has both.
5. **OPS-10, OPS-11, OPS-13 to OPS-19 (low):** a fork's branch name; concurrency on the merge job and a schedule that re-evaluates green pull requests; `--no-renames`; migrate secrets only on the steps that need them; absolute screenshot thresholds and masks on cells; flaky journeys reported and not merged (fix the known flaky `pipelines.spec.ts` referral-partners journey and the converting journey's clock first); Turbo test inputs; one helper for test phone numbers; images pinned by digest.
6. **ARCH-7 to ARCH-11 (low):** the PRD trace, ROADMAP milestones, README, TESTING and ARCHITECTURE lines brought to the code; the duplicated IST and worker-error helpers made one; the dead fixture removed.

Done when: the checks of AGENTS §10 pass; every workflow change tested on sample payloads, with the results in the report.

**How to work:** as every brief: commit every 20 minutes, never push, never docker, heavy commands through `bash /home/user/shakti_prime/tools/integration/heavy.sh`, no pull request, no install, no hosted service.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
