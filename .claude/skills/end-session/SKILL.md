---
name: end-session
description: Close a lead session on Shakti Prime BOS on the PC. Use when the owner says "end the day", "stop for today", or otherwise to stop, pause or wrap up, or after the last pull request of a session merges. Replaces docs/STATUS.md, adds CHANGELOG lines, checks the document links and opens the documents pull request.
---

# End a session

**PC only:** this skill pushes and opens a pull request, which a cloud session never does. A cloud builder or reviewer ends as [hybrid §6](../../../docs/runbooks/hybrid.md#6-how-a-cloud-session-ends) says: its report or findings in the run file, committed and pushed.

1. **STATUS:** replace the content of `docs/STATUS.md` with the state now. Keep its sections (the dated summary line, Phase N with In progress, hosted environments, deferred gate items, waiting on the owner, open follow-ups). Never append to it, and never write status or history into `CLAUDE.md`.
   - Counts come from a run in this session (the security suite's three totals, the unit-test total); if none ran, keep the old counts with their date.
   - Migrations on `main` and on each hosted environment: the highest number in `packages/db/migrations` and the last migrate run per environment.
   - In progress: one row per slice in flight (branch, run file, where it runs, state, next step), matching each run file's header.
2. **CHANGELOG:** one line per pull request merged in the session, newest first, under its phase and wave in `CHANGELOG.md`: `- **#N** (DD-MM-YYYY) what it built, in final words; migrations if any`.
3. **DECISIONS:** a row for every decision the owner took in the session that is not there yet.
4. **Links:** `python3 tools/integration/check-doc-links.py` from the repository root (after `. tools/integration/lib.sh`, which maps `python3` to `python` where Git Bash has only that) prints `bad 0`.
5. **Pull request:** branch `docs/status-<DD-MM>`, commit, push, open the pull request; the merge workflow merges it when CI passes (documents only: about two minutes).
6. **Tell the owner** in a few plain lines: what was done, what was verified and how, what is waiting on them, and the next step.
7. With slice agents still running on the PC or in the cloud, stop nothing without the owner's word; say which are still running.
