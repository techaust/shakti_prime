# Models and usage

Which Claude model and effort level each task runs on, the budget gate the lead session checks before starting any agent, and how usage is measured. The owner approved this plan on 08-10-2026 ([DECISIONS](../11-decisions.md)). The plan is Claude Max 5x: one weekly allowance shared by every model, reset each Monday at 10:00 UTC (15:30 IST), and a 5-hour window.

## 1. Principles
- Sonnet builds, Opus checks, Haiku does the mechanical work. Rework costs more than any model choice, so Opus reasoning goes where a defect is expensive, and cheap checks come early.
- The lead session runs all day, so its setting matters most: Opus at medium, raised to high for one named task at a time, never as the day's setting.
- Opus at xhigh or max, and Opus as a builder, are not used routinely.

## 2. Slice tiers
The lead sets the tier when it writes the brief, and the run file's header records it.

| Tier | What puts a slice in it | Phase 1 slices |
|---|---|---|
| A | Money, credit, tax, ledgers, row-level security, AI agent principals, deleting or anonymising data | S2, A1, M1, G1 |
| B | State machines, permissions, workers, notifications | N1, K1, T2, R1 |
| C | Screens composed from existing commands | L1 |

## 3. Who runs what

### The lead session
The owner sets the lead's model and effort in the app; the lead says when a switch is worth it and switches back after the task.

| Task | Model and effort |
|---|---|
| Starting the day, starting agents, pull requests, routine integration, `migrate-hosted`, ending the day | Opus, medium |
| A Tier A brief; taking `main` into a slice whose migrations move or redefine a function, check constraint or foreign key; an unexplained failure; designing a phase or wave | Opus, high, for that task only |

### Agents per slice
The lead passes the model and effort for the slice's tier when it starts the agent; the agent files hold the defaults (`slice-builder` Sonnet at medium, `slice-reviewer` Opus at high).

| Work | Tier A | Tier B | Tier C |
|---|---|---|---|
| Build (`slice-builder`) | Sonnet, high | Sonnet, medium | Sonnet, medium |
| Finish checks after a stop | Sonnet, medium | Sonnet, medium | Sonnet, medium |
| Review (`slice-reviewer`) | Opus, high | Opus, high | Opus, medium |
| Fix the findings (`slice-builder`) | Sonnet, medium | Sonnet, medium | Sonnet, low |
| Re-check the fix diff only (`slice-reviewer`) | Opus, medium | Opus, medium | the lead reads it |

### Haiku agents
They skip `CLAUDE.md` (`omitClaudeMd`) and never touch migrations, row-level security, commands, tax or credit logic, product copy or reviews.

| Agent | Effort | Job |
|---|---|---|
| `code-finder` | low | Finds where code lives and answers "where is X"; the lead uses it in place of the built-in Explore agent, which runs on Opus on this plan |
| `test-runner` | low | Runs one suite or check through the heavy-command lock for the lead and reports only the failures |
| `doc-clerk` | medium | Drafts CHANGELOG lines, the status page's tables and document-link fixes; the lead checks the draft before it is committed |

A subagent cannot start another subagent, so builders read their own logs (§6) and only the lead uses the Haiku agents.

## 4. Getting it right the first time
1. **A tight brief:** the exact files, contracts and tests, what another slice owns, and when the slice is done.
2. **An early check on Tier A:** when the builder has the schema, migrations and commands, it commits, reports and stops; the lead reads that diff (Opus, medium) before the builder goes on to the screens.
3. **Commits as it goes:** at least every 20 minutes and at each finished layer, so a stopped builder loses nothing.
4. **Severity triage:** critical and high findings are fixed before the merge; medium and low ones become follow-ups unless they are a one-line fix.
5. **`main` taken early:** when `main` has moved since the slice branched, it is merged into the slice before the review, not after.

## 5. The budget gate
Before starting any agent, the lead reads the plan's usage (the session's usage tool). The pace is 14 % of the week per day since Monday's reset.

| Reading | What runs |
|---|---|
| Weekly use at or under the pace and the 5-hour window at or under 50 % | Up to two agents at once |
| Weekly use over the pace | One agent at a time; Tier B reviews at medium |
| Weekly use at 85 % or more | No new build; only finishing, reviewing and merging what is in flight |
| The 5-hour window over 50 % | No new builder; a review or a running agent may continue |
| The 5-hour window at 75 % or more | Nothing new starts until it resets |

The day runs in up to three 5-hour windows, with the expensive work at a window's start: the first for starting the day, the brief or the review triage and the builder; the second for the review and its fixes; the third for integration, `migrate-hosted` and ending the day.

## 6. Habits that save usage on any model
- The builder's tools are a fixed list (the built-in file, shell and skill tools and Context7), not every MCP server.
- Long output (suites, build, journeys, lint) goes to a log file; agents read the summary and failure lines (`tail`, `grep`), never the whole log.
- The reviewer reads the diff and opens a whole file only where the diff points to it.
- One lead conversation per slice event (brief, review triage, integration), closed with a handover in the run file; the prompt cache lasts an hour, so a conversation left idle longer pays to read its whole context again.
- No progress check-ins while agents run.

## 7. Measuring
- Each agent run records the weekly percentage at its start and end in the run file's Usage line.
- In the first week only one agent runs at a time, so each reading belongs to one run.
- After S2 and the reviews of N1 and K1, the lead compares each tier's cost with the pace and proposes at most two adjustments; the owner's choice becomes a DECISIONS row. If the measured pace is still over 14 % a day, the next lever is the lead on Sonnet at medium on days of pure operations (merging, `migrate-hosted`, documents).
