# Models and usage

Which Claude model and effort level each task runs on, the budget gate the lead session checks before starting any agent, and how usage is measured. The owner approved this plan on 12-10-2026 ([DECISIONS](../11-decisions.md)).

## 1. Principles
- The plan is Claude Max 5x: one weekly allowance shared by every model, reset each Monday at 10:00 UTC (15:30 IST), and a 5-hour window. Fable 5.1 draws from that same allowance, faster than the other models, and is capped at half of it; the Fable bar on the usage card is that cap, not extra capacity ([Claude Fable models on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)). Extra usage stays off; only the owner switches it on.
- The cheapest model that gets a task right the first time runs it. Rework and test re-runs cost more than any model choice (§7), so the brief carries the review's checklist and builders test their own screens before they report.
- Fable 5.1 runs only where a missed defect costs a fix round or a hosted rollback: a Tier A review, a Tier A early check, and the lead's named tasks. It is never the lead's all-day model.
- Every model is pinned by its id (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`); the agent files hold the defaults and the lead passes the tier's model and effort when it starts an agent. At the start of a session the lead says when a newer version exists, and the owner decides whether to move the pins.
- A session runs entirely on the PC or entirely in a cloud session, as the owner chooses that day; the models and the gate are the same in both places.

## 2. Slice tiers
The lead sets the tier when it writes the brief, and the run file's header records it.

| Tier | What puts a slice in it | Phase 1 slices |
|---|---|---|
| A | Money, credit, tax, ledgers, row-level security, AI agent principals, deleting or anonymising data | S2, A1, M1, G1 |
| B | State machines, permissions, workers, notifications | N1, K1, T2, R1 |
| C | Screens composed from existing commands | L1 |

## 3. Who runs what

### The lead session
The owner sets the lead's model and effort in the app, on the PC or in the cloud; the lead says when a switch is worth it and switches back after the task.

| Day or task | Model and effort |
|---|---|
| A build day: briefs, starting agents, early checks, fix diffs, routine integration, pull requests | Opus 5.5, medium |
| An operations day: merging, `migrate-hosted`, documents, a start or end of day with no agent | Sonnet 5.5, medium |
| One named task: a Tier A brief; taking `main` into a slice whose migrations move or redefine a function, check constraint or foreign key; an unexplained failure; designing a phase or wave | Fable 5.1, high, for that task only, then back |

### Agents per slice
The lead passes the model and effort for the slice's tier when it starts the agent; the agent files hold the defaults (`slice-builder` Opus 5.5 at medium, `slice-reviewer` Opus 5.5 at high).

| Work | Tier A | Tier B | Tier C |
|---|---|---|---|
| Build (`slice-builder`), with the reviewer's checklist in the brief and the slice's own journeys run before the report | Opus 5.5, medium | Opus 5.5, medium | Sonnet 5.5, high |
| Early check of the schema, migrations and commands, before the screens (§4) | the lead, Fable 5.1, high | the lead, Opus 5.5, medium | none |
| Finish checks after a stop | Sonnet 5.5, high | Sonnet 5.5, high | Sonnet 5.5, high |
| Review (`slice-reviewer`), once | Fable 5.1, high | Opus 5.5, high | Opus 5.5, medium |
| Fix every finding, in one round (`slice-builder`) | the build's model | the build's model | the build's model |
| Check the fix diff | the lead | the lead | the lead |
| Re-check the fix diff (`slice-reviewer`), only when the review found a critical or high finding | the review's model | the review's model | the review's model |

A Tier A review is on the strongest model because one missed finding in money, tax, row-level security or an agent principal is a production defect; it costs about 2 % of the week. A Tier B review on Opus 5.5 at high found S2's and N1's defects for under 1 %. Builds stay on Opus 5.5 for Tiers A and B (the 09-10-2026 decision), with the one measured lever of §7.

### How many at once
At most two builders on a PC day (8 GB, every heavy command through the lock) and three on a cloud day (a 16 GB VM).

### What runs where on a PC day
The PC runs every check of `integrate.sh` but only the slice's own journeys (`E2E_SPECS`), and makes the Linux screenshots of the slice's own screens (`e2e:snap -- --grep`); CI runs every journey and compares every screenshot on the pull request. A screen whose picture shows figures other journeys make gets no screenshot until it has seeded figures of its own ([slice-integration §10](slice-integration.md#10-lessons)).

### Haiku agents
They skip `CLAUDE.md` (`omitClaudeMd`) and never touch migrations, row-level security, commands, tax or credit logic, product copy or reviews.

| Agent | Model and effort | Job |
|---|---|---|
| `code-finder` | Haiku 5.5, high | Finds where code lives and answers "where is X"; the lead uses it in place of the built-in Explore agent, which runs on Opus |
| `test-runner` | Haiku 5.5, high | Runs one suite or check through the heavy-command lock for the lead and reports only the failures |
| `doc-clerk` | Haiku 5.5, max | Drafts CHANGELOG lines, the status page's tables and document-link fixes; the lead checks the draft before it is committed |

A subagent cannot start another subagent, so builders read their own logs (§6) and only the lead uses the Haiku agents.

## 4. Getting it right the first time
1. **A tight brief:** the exact files, contracts and tests, what another slice owns, and when the slice is done.
2. **An early check on Tier A and B:** when the builder has the schema, migrations and commands, it commits, reports and stops; the lead reads that diff (Fable at high for Tier A, Opus at medium for Tier B) before the builder goes on to the screens.
3. **Commits as it goes:** at least every 20 minutes and at each finished layer, so a stopped builder loses nothing.
4. **One fix round:** the builder fixes every finding the review raised in one round; the lead reads that diff, and the reviewer re-checks it only when the review found a critical or high finding. A finding the round cannot fix becomes a follow-up in STATUS.
5. **`main` taken early:** when `main` has moved since the slice branched, it is merged into the slice before the review, not after.

## 5. The budget gate
Before starting any agent, the lead reads three numbers: the 5-hour window, the week and the Fable bar. On the PC it reads them with the session's usage tool. In a cloud session, which cannot read them, the owner posts them at the session's start and whenever the lead asks before an agent, in one line: `usage: 5h 12, week 40, fable 15`. The pace is 14 % of the week per day since Monday's reset.

| Reading | What runs |
|---|---|
| Weekly use at or under the pace and the 5-hour window at or under 50 % | Up to two agents at once on a PC day, three on a cloud day |
| Weekly use over the pace | One agent at a time |
| Weekly use at 85 % or more | No new build; only finishing, reviewing and merging what is in flight |
| The 5-hour window over 50 % | No new builder; a review or a running agent may continue |
| The 5-hour window at 75 % or more | Nothing new starts until it resets |
| The Fable bar at 90 % or more | Fable tasks run on Opus 5.5 at high until Monday's reset |
| A cloud reading older than two hours | One agent at a time |
| No cloud reading that day | Nothing new; the lead finishes, reviews and merges what is in flight, asks again, and never guesses a bar |

A new slice starts only while the week is under 70 %, so it finishes without a gate stop. The week's shape: builds on Monday afternoon and Tuesday, reviews and fixes on Wednesday, integration and the hosted steps on Thursday, documents on Friday, and 15 % of the week kept for the unexpected. The day runs in up to three 5-hour windows, with the expensive work at a window's start: the first for starting the day, the brief or the review triage and the builder; the second for the review and its fixes; the third for integration, `migrate-hosted` and ending the day.

## 6. Habits that save usage on any model
- The builder's tools are a fixed list (the built-in file, shell and skill tools and Context7), not every MCP server.
- Long output (suites, build, journeys, lint) goes to a log file; agents read the summary and failure lines (`tail`, `grep`), never the whole log.
- The reviewer reads the diff and opens a whole file only where the diff points to it.
- One lead conversation per slice event (brief, review triage, integration), closed with a handover in the run file; the prompt cache lasts an hour, so a conversation left idle longer pays to read its whole context again.
- No progress check-ins while agents run.

## 7. Measuring

### What a slice costs
From the run files' Usage lines, as a share of the week:

| Work | Cost | Recorded in |
|---|---|---|
| A Tier B build, Sonnet 5.5 at medium | 6 % | R1, 75 to 81 |
| Five Sonnet fix rounds on one slice | 5 % | K1, 70 to 75 |
| A review, Opus 5.5 at high | under 1 % | S2, 68 to 68 |
| Two reviews and two re-checks on Fable 5.1 | about 5 % (the Fable bar 0 to 10) | A1 and L1, 10-10-2026 |
| The lead's integration of one slice | 1 % | S2, N1, K1 |
| Three builds and a fix slice in one cloud day | 13 % | 10-10-2026, 86 to 99 |

A slice is 10 to 12 % of the week end to end, so a week holds about six slices with the lead's work, the documents and the hosted steps.

### How it is measured
1. Each agent run records the three bars at its start and end, and its model, in the run file's Usage line (`build Opus 20→26, fable 0→0`).
2. Fable's drain factor comes from M1 at no extra cost: the Fable bar's movement during M1's early check and review, against the week's movement, with the Opus reviews above as the baseline. The Fable bar reads in half-percent steps of the week, twice as fine as the week's own bar.
3. Phase 2's first Tier B slice settles two choices with that factor: its review runs on Fable 5.1 at high when the factor is 2 or less, and its build is a measured trial on Sonnet 5.5 at high; Tier B builds move to Sonnet only when that slice's fix round is no larger than an Opus-built slice's.
4. After M1 and G1, the lead compares the week against the tables above and proposes at most two changes; each becomes a DECISIONS row.
