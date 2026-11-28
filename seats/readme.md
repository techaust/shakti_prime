# Seats: how the lead hands work to the owner's other cloud sessions (protocol v2)

This branch is never merged. The lead session writes one file per seat, `seats/seat-<n>.md`. Each seat session reads only its own file and never pushes to this branch. A seat reports through the branch of each lane, by commit subject ([hybrid §11](../docs/runbooks/hybrid.md#11-seats-on-the-owners-other-accounts)). Version 2 (owner, 27-11-2026) gives a seat several lanes at once. The seat session is the seat's orchestrator, and each lane runs in a subagent of its own.

## A seat file
```
seat: <n>
max_agents: <how many lane agents may run at once in this seat, set by the lead from the usage reading>
updated: <when the lead last wrote it, UTC>
note: <anything for the whole seat>

lane: <a number, unique across all seats; never reused>
role: build | review | fix | prep | idle
branch: <the slice's branch>
run_file: <the run file, the brief>
wait_for: <a commit subject that must be on the branch before the lane starts, or none>
done_when: <the commit subject that finishes the lane>
note: <anything the lead adds for this lane>

lane: ...
```
- A blank line separates the lanes.
- The lead adds lanes and takes them out. It never changes a lane's `branch`, `role` or `done_when` after a seat may have started it. A changed lane gets a new number.
- A lane is finished once its `done_when` subject is on its branch on GitHub. A lane whose branch ends with `report: <slug> blocked` is held, and `wait.sh` does not offer it again, until the lead answers with a commit on the branch. A seat therefore keeps no state: after a restart it starts every lane that is not finished, from the branch as pushed.

## The loop, for seat <n>
Start every shell command with `. tools/integration/lib.sh &&`. Keep a list of the lanes you are running, as lane id, slot and agent.

1. **Wait:** `git fetch -q origin ops/seats && git show origin/ops/seats:seats/wait.sh | bash -s -- <n> <running lane ids, comma-separated>`.
   - It returns within 25 minutes, with `WAIT` or with lines `MAX`, `GONE <id>`, `DONE <id>` and `NEW <id>`, followed by each new lane's block.
   - On `WAIT`, run it again at once. Never end your turn while you wait or while a lane agent runs.
2. **On `NEW`,** start the lanes in the order printed, one at a time, while two things hold:
   - you run fewer lane agents than `MAX`;
   - `bash tools/integration/cloud-capacity.sh --agents <lane agents running> --browser-agents 0` says `yes`.

   For each lane:
   - Take a free slot *s* from 1 to 5. Its Postgres is on 54330 + *s* and its app on 3030 + *s*.
   - Run `bash tools/integration/setup-worktree.sh <slug> <branch> <54330+s> <3030+s>`. The slug is the run file's name without `.md`. If the worktree is already there, run `git -C <worktree> pull --ff-only` first. Then check its `.env` lines with `grep -E '^DATABASE_URL' <worktree>/.env | grep -v ':<54330+s>/'`, which must print nothing.
   - Start the lane's agent in the background, with the Agent tool, on model Opus 5.5 at high effort and with the prompt below for its role.
     - `build` and `fix`: `slice-builder`.
     - `review`: `slice-reviewer`.
     - `prep`: `slice-builder` with the prep prompt.
   - At most one `prep` lane runs at a time in a seat, because `integrate.sh` uses the database on 54340.
3. **When a lane's agent finishes:**
   - Check that its worktree is committed and pushed: `git -C <worktree> status --short` is empty, and `git -C <worktree> log origin/<branch>..HEAD` is empty. If not, commit what it left (`wip: <slug> left by the agent`) and push.
   - Check the lane's `done_when` subject is on the branch.
   - If it is not, and the agent stopped on a rule, the agent's own report commit is the signal (`report: <slug> blocked`). Leave it for the lead.
   - Stop the slot's database (`docker stop shakti-pg-<slug>`) and free the slot. Leave the worktree in place: a later lane on the same branch reuses it.
4. **`GONE <id>`:** the lead took the lane back. Stop its agent (TaskStop), commit and push what it left with `wip: <slug> stopped by the lead`, and free its slot. **`DONE <id>`:** treat it as finished (step 3).
5. Go back to step 1.

A seat never builds and reviews the same slice: the lead gives the review to another seat. One agent works on a branch at a time, and the lead never gives two open lanes on one branch.

## The prompts, filled in for each lane
Replace `<worktree>`, `<run_file>`, `<branch>`, `<slug>`, `<port>` (the slot's Postgres) and `<appport>`. Each lane prompt ends with this paragraph:
```
You work only in the worktree <worktree> on branch <branch>; its Postgres is on <port> (already
running) and the app on <appport>. Follow your agent file's PC lines for the worktree, the ports and
the heavy-command lock (other agents share this VM: run every heavy command, and while another agent
runs every lint, typecheck and test too, through bash tools/integration/heavy.sh), and its Cloud lines
for pushing: commit at least every 20 minutes and push your branch after every commit
(git push origin HEAD). Never run docker or fresh-db.sh: if you need a fresh database, commit, push
and stop with a report saying so. Never open or merge a pull request, push to main or ops/seats,
delete a branch, force-push, install a package or touch a hosted service.
```
- **build:** `You are the slice builder for <slug>. Read <run_file> (your brief) and follow .claude/agents/slice-builder.md completely. Report as the run file says, by the commit subject report: <slug> <stage>. At the early check (Tier A and B), stop after report: <slug> early check; the lead gives a new lane with the note continue.` plus the lane's note.
- **build with the note `continue`:** the same, then `The lead read your early check: <the lane's note>. Go on from the branch as pushed to the screens and the journeys, then report: <slug> done.` If you still hold the agent that made the early check, send it this message instead of starting a new one.
- **review:** `You are the slice reviewer for <slug>. Read <run_file> and follow .claude/agents/slice-reviewer.md completely. Write your findings into the run file's Review section, the only file you change, then commit "review: <slug> done" and push. You cannot sign in to the journeys in this session: read their specs and say which you did not run.` plus the lane's note.
- **fix:** `You are the slice builder for <slug>, for its one fix round. Apply every finding in the run file's Review section that the lead marked to fix, run the slice's checks, write the fix-round entry in the Report section, commit "report: <slug> fixes" and push.` plus the lane's note.
- **prep:** `You prepare <slug> for the lead's integration (owner, 27-11-2026). Follow docs/runbooks/slice-integration.md §5 exactly to take main into the branch: a merge commit, the merge helpers, pnpm install, then node tools/integration/renumber-migrations.mjs, pnpm db:generate reporting no changes, and pnpm db:docs. Then follow §10's "Merging with main" lessons: diff every function, check constraint and foreign key the slice's migrations redefine against main's latest, and grep the shared lists for a key used twice. Typecheck at once. Then run bash tools/integration/heavy.sh bash tools/integration/integrate.sh <worktree> <log> in parts, with INTEGRATE_STEPS set to "install lint format copylint generated typecheck", then "unit", then "security dbverify", then "audit build jsbudget gitleaks"; never the e2e step. Each part runs in the background and must end INTEGRATION PARTIAL. Fix only what the merge broke, with one exception: a Prettier finding in the slice's own files (run pnpm exec prettier --write on those files, commit "style: Prettier on <files>" and go on). Anything else is stopped and reported. Write an "Integration prep" entry in the run file: main's commit, the migrations' new numbers, every redefinition checked and its result, each part's verdict line and the counts of each suite. Commit "report: <slug> prepped" and push. If a step fails for a reason outside the merge, commit "report: <slug> prep blocked" with the failure lines.`

## Rules for every seat
- **Never end your turn.** After any event (a lane started, an agent finished, a report seen), run the wait in step 1 again in the same turn. A seat that writes a status message and stops is idle: its lanes stop being offered and its agents are not watched. Report nothing to the owner; the lead reads the branches.
- **Check a lane agent is alive before counting it as running:** when the wait returns, or every 30 minutes, check each agent you count as running (TaskGet or its output). An agent that ended without its `done_when` subject on its branch is no longer running. Commit and push what it left, then start the lane again from its branch.
- You are not the lead. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, delete a branch, force-push, install a package, or touch a hosted service or a GitHub workflow.
- Every lane agent runs on Opus 5.5 at high effort, and so does the seat session itself.
- **A build or fix lane runs `pnpm format:check` (Prettier) before its `done` or `fixes` report** and fixes what it names in its own files. Two preps stopped on it on day 1 (J1, H2).
- Every branch is pushed after every commit, at least every 10 minutes.
- If your account's usage limit stops you, push what you have, with `report: <slug> blocked` and the words "usage limit" if you still can. When the session comes back, continue the loop: the seat files say what is left.
