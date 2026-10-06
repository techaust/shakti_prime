# ADR 0017 — GitHub's free plan with a trimmed CI and merge-on-green, no branch rules

**Status:** Accepted (owner, 03-10-2026) · **Date:** 03-10-2026 · **Deciders:** Owner · **Blueprint:** §5, §12, §17 · **Architecture:** §12 · **Testing:** `docs/09-testing.md` · **Audit:** the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45 · **ADR:** 0001

## Context
The repository is a private personal repository on GitHub's free plan. That plan offers no branch protection or rulesets for it, so nothing can require a pull request or a green CI run before `main` changes (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45), and it has no deployment environments, so hosted secrets are repository secrets with a suffix per environment.

It also includes a limited number of Actions minutes a month, which the full CI (the security suite on a fresh database, three end-to-end shards, Lighthouse) used up during Phase 1. The alternatives were a paid plan, or moving the repository to the client's organisation on a plan with rulesets (ROADMAP §10).

## Decision
**Stay on the free plan, spend Actions minutes only where a change can break something, and merge only through a workflow that waits for green.**

- `.github/workflows/ci.yml` starts with a *What changed* job. A pull request that changes only `docs/` and the root Markdown files runs the lint, unit-test and supply-chain jobs alone; the unit tests still check every generated document (`docs/data/`, `docs/state-machines/`).
- The end-to-end shards and Lighthouse run on pull requests only, not again on `main` after the merge.
- `.github/workflows/automerge.yml` is the only path into `main`: after CI passes on a pull request it merges it with a merge commit when it is open, not a draft, from this repository, unlabelled `hold`, still at the tested commit and by `techaust` or a Dependabot minor or patch bump, then deletes the branch and runs CI on `main`.
- Nobody pushes to `main` directly, and history on GitHub is never rewritten: force pushes and branch deletions are refused, so rebased work goes up under a new branch name.
- The plan is revisited when the monthly minutes run short again, and branch rules arrive with a paid plan or the client's organisation (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45 stays open until then).

## Consequences
- CI cannot block a direct push to `main`; the rule against it is a working rule (`AGENTS.md`), not an enforced one. Vercel deploys what reaches `main`, so a red commit there would deploy.
- A documents-only pull request skips the build and the security suite, so a document that a code test reads (06-api.md §3, SECURITY §3.2, DATABASE §6) is still checked, by the unit tests.
- A failure that only the end-to-end journeys would catch after a merge is caught on the pull request instead; `main` is not re-run through them.
- Hosted migrations run from the manual *Migrate a hosted database* workflow with suffixed repository secrets, since the plan has no environments (`docs/runbooks/DEPLOY.md`).
