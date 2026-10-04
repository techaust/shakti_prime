---
name: integrate-slice
description: Bring a built and reviewed slice branch of Shakti Prime BOS onto main. Use when a slice's builder has finished and its review findings are fixed. Takes main into the branch, renumbers its migrations, runs every check, makes the Linux screenshot baselines and opens the pull request.
---

# Integrate a slice

The procedure, the reasons and the lessons are in `docs/runbooks/slice-integration.md` §5 to §8; follow it exactly. In short:

1. **Ready?** The slice's report is read, the `slice-reviewer` findings are verified, every medium or worse is fixed, and the worktree is clean (`git status`).
2. **Take main:** record the pre-merge commit, `git merge --no-commit origin/main`, resolve with `tools/integration/merge-union.py`, `merge-json.py` and `merge-copylint.py` (read every code hunk by hand), then `node tools/integration/renumber-migrations.mjs origin/main <pre-merge sha>`. `pnpm db:generate` must report no changes; run `pnpm db:docs`; fix the migration numbers the slice's documents cite; commit the merge.
3. **Check everything:** `bash tools/integration/integrate.sh <worktree> <log>` in the background; wait for its last line. On `INTEGRATION FAILED`, read `<log>.<step>`, fix, commit, run it again.
4. **Baselines:** on a fresh database only (`tools/integration/fresh-db.sh`, then migrate, seed, build), `pnpm --filter web e2e:snap -- --update-snapshots=missing`; look at every new image; a verification run without updating must match.
5. **Pull request:** push, open it with what it builds, its migrations, its checks and anything left for the owner (body ends with the Claude Code line). The merge workflow merges it; never merge by hand. A commit pushed after CI started misses the merge: check it with `git merge-base --is-ancestor`.
6. **After the merge:** the `migrate-hosted` skill when the slice has migrations, then note the merge for the `end-session` skill.
