---
name: start-session
description: Start or resume work on Shakti Prime BOS, in a cloud session or on the PC. Use at the beginning of a session, or when the owner says "start the day", "good morning", "continue", "continue Phase N", "resume" or "where are we". Reads the status and the run files, checks CI and the tooling, and proposes the next item.
---

# Start a session on Shakti Prime BOS

You are the lead engineer on Shakti Prime BOS: you own this codebase end to end. The owner is the sole developer working with you; the client is the Shakti group in Jaipur. Each step says where it applies: **both**, **PC** or **cloud** ([docs/runbooks/hybrid.md](../../../docs/runbooks/hybrid.md); a cloud session has `CLAUDE_CODE_REMOTE=true`).

## 1. Read, in this order (both)
1. `CLAUDE.md` (the rules; already loaded).
2. `docs/STATUS.md`: the phase, what is merged, in progress (each slice's branch, run file, where it runs and its next step) and next, what waits on the owner, the open follow-ups.
3. `docs/DECISIONS.md`: what the owner has decided. Never ask again about a decided question.
4. `AGENTS.md`, then the `docs/BLUEPRINT.md` sections, `docs/ROADMAP.md` for the current phase, and the module document and design section (`docs/design/`) for the next item in STATUS. BLUEPRINT governs on any conflict.
5. If the work is a slice of a phase: its run file `docs/runs/phase1/<slug>.md`, `docs/runbooks/slice-integration.md` and `docs/runbooks/hybrid.md`.

## 2. Check
- **Both:** the latest CI run on `main` is green (`gh run list --branch main --limit 3`; the merge workflow's own runs may send no email); open pull requests: `gh pr list`. `gh` is signed in on the PC and in the cloud.
- **PC:** the `[tooling-check]` block from the session-start hook: tell the owner in one short message what is missing for the current phase (install step and any sign-in), or nothing if all is in place.
- **Cloud:** the `[tooling-check]` block is the cloud note (no plugins or MCP servers here; nothing to install). The `[cloud-session]` line says whether Postgres is up on 54322; if it reports a problem, read `/tmp/cloud-session-*.log` and [hybrid §9](../../../docs/runbooks/hybrid.md#9-a-reclaimed-vm-or-a-usage-limit).
- **PC:** no Docker (owner, 05-10-2026): every database, suite and journey runs in a cloud session. Check each slice in flight by its pushed branch and run file (`git fetch`, `git log origin/<branch>`).

## 3. Then (both)
Say in one short paragraph where things stand, then continue from the next item in STATUS that the current phase allows and that this place may run ([hybrid §1](../../../docs/runbooks/hybrid.md#1-what-runs-where): in the cloud, building and reviewing; on the PC, everything). For anything touching more than one file, present a plan (numbered steps with files, commands, tests and migrations) and wait for approval, unless the owner has already approved the plan this work belongs to.

## How we work
- A decision that belongs to the client or the owner is asked as a multiple-choice question, recommended option first; routine engineering decisions are taken and stated. Every owner decision becomes a row in `docs/DECISIONS.md`.
- Build in vertical slices: contract → command → tests → server action or route → screen → end-to-end journey. Never leave a layer half wired. Follow AGENTS.md for conventions, recipes and the definition of done (§10).
- Report honestly: what ran, what passed, what was not verified. Never report the security suite as verified without running it on the local Postgres.
- Never install plugins, MCP servers or dependencies without the owner's go-ahead. Never write to the database outside a domain command. Never put a colour, price or tax calculation in UI code. Never invent client inputs.
- Every user-facing word follows `DESIGN.md` §11: plain final English, Roman-script Hinglish only for caller scripts, voice speech and training.
- Keep the phase discipline in `docs/ROADMAP.md`. End a lead session on the PC with the `end-session` skill; a cloud session ends as [hybrid §6](../../../docs/runbooks/hybrid.md#6-how-a-cloud-session-ends) says.
