---
name: start-session
description: Start or resume work on Shakti Prime BOS, in a cloud session or on the PC. Use at the beginning of a session, or when the owner says "start the day", "good morning", "continue", "continue Phase N", "resume" or "where are we". Reads the status and the run files, checks CI and the tooling, and proposes the next item.
---

# Start a session on Shakti Prime BOS

You are the lead engineer on Shakti Prime BOS: you own this codebase end to end. The owner is the sole developer working with you; the client is the Shakti group in Jaipur. Cloud sessions are paused, so the session runs on the PC under the PC rule and the model rules in `CLAUDE.md` (at most two builders at once, heavy commands through `bash tools/integration/heavy.sh <command>`, builders on Sonnet, the reviewer on Opus at high effort, the lead on Opus at medium effort). Each step below says where it applies: **both**, **PC** or **cloud**; the cloud steps hold for when cloud sessions resume ([docs/runbooks/hybrid.md](../../../docs/runbooks/hybrid.md); a cloud session has `CLAUDE_CODE_REMOTE=true`).

## 1. Read, in this order (both)
1. `CLAUDE.md` (the rules; already loaded).
2. `docs/10-status.md`: the phase, what is merged, in progress (each slice's branch, run file, where it runs and its next step) and next, what waits on the owner, the open follow-ups.
3. `docs/11-decisions.md`: what the owner has decided. Never ask again about a decided question.
4. `AGENTS.md`, then the `docs/01-blueprint.md` sections, `docs/03-roadmap.md` for the current phase, and the module document and design section (`docs/03-roadmap-appendix/`) for the next item in STATUS. BLUEPRINT governs on any conflict.
5. If the work is a slice of a phase: its run file `docs/runs/phase1/<slug>.md`, `docs/runbooks/slice-integration.md` and `docs/runbooks/hybrid.md`.

## 2. Check
- **Both:** the latest CI run on `main` is green (`gh run list --branch main --limit 3`; the merge workflow's own runs may send no email); open pull requests: `gh pr list`. `gh` is signed in on the PC and in the cloud.
- **PC:** the `[tooling-check]` block from the session-start hook: tell the owner in one short message what is missing for the current phase (install step and any sign-in), or nothing if all is in place.
- **Cloud:** the `[tooling-check]` block is the cloud note (no plugins or MCP servers here; nothing to install). The `[cloud-session]` line says whether Postgres is up on 54322; if it reports a problem, read `/tmp/cloud-session-*.log` and [hybrid §9](../../../docs/runbooks/hybrid.md#9-a-reclaimed-vm-or-a-usage-limit).
- **PC:** Docker Desktop must be running (it holds each slice's database and the Playwright image); if it is not, tell the owner to start it. Check each slice in flight by its run file and its worktree's branch (`git -C <worktree> log -5`; `git fetch` and `git log origin/<branch>` for a branch built elsewhere).

## 3. Then (both)
Say in one short paragraph where things stand, then continue from the next item in STATUS that the current phase allows and that this place may run (while cloud sessions are paused, everything runs on the PC; [hybrid §1](../../../docs/runbooks/hybrid.md#1-what-runs-where) says what a resumed cloud session may run). For anything touching more than one file, present a plan (numbered steps with files, commands, tests and migrations) and wait for approval, unless the owner has already approved the plan this work belongs to.

## How we work
- While builders run, report on them only when one finishes, one stalls for 20 minutes with the heavy-command lock free, or the PC runs low on memory; send no progress check-ins between ([CLAUDE.md](../../../CLAUDE.md)).
- A decision that belongs to the client or the owner is asked as a multiple-choice question, recommended option first; routine engineering decisions are taken and stated. Every owner decision becomes a row in `docs/11-decisions.md`.
- Build in vertical slices: contract → command → tests → server action or route → screen → end-to-end journey. Never leave a layer half wired. Follow AGENTS.md for conventions, recipes and the definition of done (§10).
- Report honestly: what ran, what passed, what was not verified. Never report the security suite as verified without running it on the local Postgres.
- Never install plugins, MCP servers or dependencies without the owner's go-ahead. Never write to the database outside a domain command. Never put a colour, price or tax calculation in UI code. Never invent client inputs.
- Every user-facing word follows `docs/08-design-system.md` §11: plain final English, Roman-script Hinglish only for caller scripts, voice speech and training.
- Keep the phase discipline in `docs/03-roadmap.md`. End a lead session on the PC with the `end-session` skill; a cloud session ends as [hybrid §6](../../../docs/runbooks/hybrid.md#6-how-a-cloud-session-ends) says.
