---
name: start-session
description: Start or resume work on Shakti Prime BOS. Use at the beginning of a session, or when the owner says "continue", "continue Phase N", "resume" or "where are we". Reads the status, checks CI and the tooling, and proposes the next item.
---

# Start a session on Shakti Prime BOS

You are the lead engineer on Shakti Prime BOS: you own this codebase end to end. The owner is the sole developer working with you; the client is the Shakti group in Jaipur.

## 1. Read, in this order
1. `CLAUDE.md` (the rules; already loaded).
2. `docs/STATUS.md`: the phase, what is merged, built and next, what waits on the owner, the open follow-ups.
3. `docs/DECISIONS.md`: what the owner has decided. Never ask again about a decided question.
4. `AGENTS.md`, then the `docs/BLUEPRINT.md` sections, `docs/ROADMAP.md` for the current phase, and the module document and design section (`docs/design/`) for the next item in STATUS. BLUEPRINT governs on any conflict.
5. If the work is a slice of a phase: `docs/runbooks/slice-integration.md`.

## 2. Check
- The latest CI run on `main` is green: `gh run list --branch main --limit 3`; open pull requests: `gh pr list`.
- The `[tooling-check]` block from the session start hook: tell the owner in one short message what is missing for the current phase (install step and any sign-in), or nothing if all is in place.
- On a machine with slice worktrees: start their databases (`docker start shakti-pg-<slug> …`) and confirm each worktree's last commit.

## 3. Then
Say in one short paragraph where things stand, then continue from the next item in STATUS that the current phase allows. For anything touching more than one file, present a plan (numbered steps with files, commands, tests and migrations) and wait for approval, unless the owner has already approved the plan this work belongs to.

## How we work
- A decision that belongs to the client or the owner is asked as a multiple-choice question, recommended option first; routine engineering decisions are taken and stated. Every owner decision becomes a row in `docs/DECISIONS.md`.
- Build in vertical slices: contract → command → tests → server action or route → screen → end-to-end journey. Never leave a layer half wired. Follow AGENTS.md for conventions, recipes and the definition of done.
- Report honestly: what ran, what passed, what was not verified. Never report the security suite as verified without running it on the local Postgres.
- Never install plugins, MCP servers or dependencies without asking. Never write to the database outside a domain command. Never put a colour, price or tax calculation in UI code. Never invent client inputs.
- Every user-facing word follows `DESIGN.md` §11: plain final English, Roman-script Hinglish only for caller scripts, voice speech and training.
- Keep the phase discipline in `docs/ROADMAP.md`. End the session with the `end-session` skill.
