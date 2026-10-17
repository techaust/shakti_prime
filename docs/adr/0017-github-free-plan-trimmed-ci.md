# ADR 0017 — GitHub's free plan with a trimmed CI and merge-on-green, no branch rules

**Status:** Accepted (owner, 03-10-2026) · **Date:** 03-10-2026 · **Deciders:** Owner · **Blueprint:** §5, §12, §17 · **Architecture:** §12 · **Testing:** `docs/09-testing.md` · **Audit:** the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45 · **ADR:** 0001

## Context
The repository is a personal repository on GitHub's free plan. While it is private, that plan offers no branch protection or rulesets for it, so nothing can require a pull request or a green CI run before `main` changes (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45), and it has no deployment environments, so hosted secrets are repository secrets with a suffix per environment.

It also includes a limited number of Actions minutes a month, which the full CI (the security suite on a fresh database, three end-to-end shards, Lighthouse) used up during Phase 1. The alternatives were a paid plan, or moving the repository to the client's organisation on a plan with rulesets (ROADMAP §10).

The repository has been public since 06-10-2026 (owner), so its Actions minutes, environments and branch rules are free; an Actions budget is set, and the plan moves to GitHub Pro, before it goes private again ([DECISIONS](../11-decisions.md)).

## Decision
**Stay on the free plan, spend Actions minutes only where a change can break something, and merge only through a workflow that waits for green.**

- `.github/workflows/ci.yml` starts with a *What changed* job. A pull request that changes only `docs/` and the root Markdown files runs the lint, unit-test and supply-chain jobs alone; the unit tests still check every generated document (`docs/data/`, `docs/state-machines/`).
- The end-to-end shards and Lighthouse run on pull requests and their branches only, not again on `main` after the merge, since a pull request merges only on the `main` it was tested with.
- `.github/workflows/automerge.yml` is the only path into `main`: after CI passes on a pull request it merges it with a merge commit when it is open, not a draft, from this repository, unlabelled `hold`, still at the tested commit and by `techaust` or a Dependabot minor or patch bump, then deletes the branch and runs CI on `main`; when `main` has moved since the tested commit it takes `main` into the branch and tests it again, and a pull request that changes the checks waits for the owner's `checks-ok` label ([TESTING §6](../09-testing.md#6-what-ci-runs)).
- Nobody pushes to `main` directly, and history on GitHub is never rewritten: force pushes and branch deletions are refused, so rebased work goes up under a new branch name.
- The plan is revisited when the monthly minutes run short again.
- **Production (G1).** The public repository's free branch ruleset `main` refuses a direct push, a force push and a deletion and requires the CI checks, which the merge-on-green workflow still passes; production's secrets live in the GitHub environment `production` (the owner as required reviewer, branch `main` only), and the lead's token has no write access to *Administration*, *Deployments* and *Environments*, set up as [DEPLOY §1](../runbooks/deploy.md#1-before-the-first-deploy-once-per-environment) step 4 says. Production's database is copied in AWS, so GitHub holds no credential that reads it without the owner's approval. Vercel deploys production only through the release workflow, which the owner approves (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45 is resolved by these).

## Consequences
- Once the ruleset is set, a direct push to `main` is refused; before it, the rule against it is a working rule (`AGENTS.md`). Vercel deploys what reaches `main` to dev and staging, never to production, which waits for a release.
- A documents-only pull request skips the build and the security suite, so a document that a code test reads (06-api.md §3, SECURITY §3.2, DATABASE §6) is still checked, by the unit tests.
- A failure that only the end-to-end journeys would catch after a merge is caught on the pull request instead; `main` is not re-run through them.
- Hosted migrations of dev and staging run from the manual *Migrate a hosted database* workflow with suffixed repository secrets; production's run in its environment, through a release or that workflow's `production` choice, each waiting for the owner's approval (`docs/runbooks/deploy.md`).
- If the repository is made private on the free plan, its environments and ruleset stop protecting production; the move to GitHub Pro comes first.
