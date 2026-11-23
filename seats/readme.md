# Seats: how the lead hands work to the owner's other cloud sessions

This branch is never merged. The lead session (on the owner's PC) writes one file per seat, `seats/seat-<n>.md`; each seat session reads only its own file and never pushes to this branch. A seat reports through the branch it works on, by commit subject, exactly as a builder or reviewer of [hybrid §4](../docs/runbooks/hybrid.md#4-starting-a-builder-or-a-reviewer) does.

## A seat file
```
assignment: <a number; a higher number is new work>
role: build | review | fix | idle
branch: <the branch to work on>
run_file: <the run file, the brief>
wait_for: <a commit subject that must be on the branch before starting, or none>
note: <anything the lead adds>
```

## The loop, for seat <n>
1. Wait: `git fetch -q origin ops/seats && git show origin/ops/seats:seats/wait.sh | bash -s -- <n> <last assignment done, 0 at first>`. It returns within 25 minutes: either `NEW` with the seat file, or `WAIT` (run it again at once). Never end your turn while waiting: run the wait again, as many times as it takes.
2. On `NEW`: commit and push anything left from the previous assignment, then `git fetch origin && git switch <branch>` (or `git switch -c <branch> origin/<branch>`), `git pull --ff-only`.
3. Do the role:
   - **build:** you are that slice's builder. Read the run file and follow `.claude/agents/slice-builder.md` completely (its Cloud lines). Report as the run file says (`report: <slug> <stage>`). At an `early check`, keep waiting for a seat file with the same branch and the note `continue` before going on.
   - **review:** you are that slice's reviewer. Read the run file and follow `.claude/agents/slice-reviewer.md` completely. Write your findings into the run file's Review section, the only file you change, commit `review: <slug> done` and push.
   - **fix:** you are that slice's builder for its one fix round: apply the run file's Review findings the lead marked to fix, run the slice's checks, write the Report section's fix-round entry, commit `report: <slug> fixes` and push.
   - **idle:** nothing; go back to waiting.
4. Go back to 1 with this assignment's number as the last one done.

## Rules for every seat
- You are not the lead: never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or to `ops/seats`, delete a branch, force-push, or touch a hosted service or GitHub workflow.
- Push the branch you work on after every commit, at least every 10 minutes.
- Start every shell command with `. tools/integration/lib.sh &&`; the session hook starts Postgres on 54322.
- If your account's usage limit stops you, push what you have with `report: <slug> blocked` and the words "usage limit" if you still can.
