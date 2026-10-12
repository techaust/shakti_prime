# Models and usage

Which Claude model and effort level each task runs on, the budget gate the lead session checks before starting any agent, and how usage is measured. The owner approved this plan on 12-10-2026 ([DECISIONS](../11-decisions.md)).

**At a glance.** Opus 5.5 builds and checks, Sonnet 5.5 builds screens, Haiku 5.5 searches, runs suites and drafts documents; Fable 5.1 is not used. Effort is medium to carry out, high for judgement, xhigh where a miss reaches production. The lead names the day's model in its opening paragraph, so the owner only follows it. Before any agent, the lead reads the gate (§5); after the session, `tools/integration/agent-usage.py` shows what each run cost and whether it ran at its setting (§7).

## 1. Principles
- The plan is Claude Max 5x: one weekly allowance shared by every model, reset each Monday at 10:00 UTC (15:30 IST), and a 5-hour window. Extra usage stays off; only the owner switches it on.
- Three models do all the work: Opus 5.5, Sonnet 5.5 and Haiku 5.5, each pinned by its id (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) in the agent files. Fable 5.1 is not used. At the start of a session the lead says when a newer version exists, and the owner decides whether to move the pins.
- The cheapest model and effort that get a task right the first time run it. Rework and test re-runs cost more than any model choice (§7), so the brief carries the review's checklist and builders test their own screens before they report.
- Effort follows one rule:

| Effort | Used for |
|---|---|
| medium | Carrying out work whose thinking the brief or a checklist has already done |
| high | Work that needs judgement, or code that touches deep rules |
| xhigh | A task where one missed defect reaches production or costs a fix round |
| max, low | Not used: max has no limit on its thinking and gives little more than xhigh; low saves too little to be worth a miss |

- An agent file's defaults are the strictest setting the agent runs at, so a setting the lead forgets to pass costs usage, never quality.
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
The owner sets the lead's model and effort in the app when a conversation starts, on the PC or in the cloud. Each named task runs in a conversation of its own, since a model switch in the middle of a conversation reads its whole context again; the lead says when a task calls for one.

| Day or task | Model and effort |
|---|---|
| A build day: Tier B and C briefs, starting agents, Tier B early checks, fix diffs, routine integration, pull requests | Opus 5.5, medium |
| An operations day: merging, `migrate-hosted`, documents, a start or end of day with no agent | Sonnet 5.5, medium |
| A named task: a Tier A brief or early check; taking `main` into a slice whose migrations move or redefine a function, check constraint or foreign key; an unexplained failure; designing a phase or wave | Opus 5.5, xhigh |

On an operations day, a failed check, a merge conflict or an error from a hosted step is an unexplained failure: the Sonnet conversation stops and hands it, with a short note, to a new Opus 5.5 conversation at xhigh.

### Agents per slice
The lead passes the model and effort for the slice's tier when it starts the agent. The agent files hold the Tier A settings as defaults: `slice-builder` Opus 5.5 at high, `slice-reviewer` Opus 5.5 at xhigh.

| Work | Tier A | Tier B | Tier C |
|---|---|---|---|
| Build (`slice-builder`), with the reviewer's checklist in the brief and the slice's own journeys run before the report | Opus 5.5, high | Opus 5.5, medium | Sonnet 5.5, high |
| Early check of the schema, migrations and commands, before the screens (§4) | the lead, Opus 5.5, xhigh | the lead, Opus 5.5, medium | none |
| Finish checks after a stop | Sonnet 5.5, high | Sonnet 5.5, high | Sonnet 5.5, high |
| Review (`slice-reviewer`), once | Opus 5.5, xhigh | Opus 5.5, high | Opus 5.5, medium |
| Fix every finding, in one round (`slice-builder`) | the build's model and effort | the build's model and effort | the build's model and effort |
| Check the fix diff | the lead | the lead | the lead |
| Re-check the fix diff (`slice-reviewer`), only when the review found a critical or high finding | the review's model and effort | the review's model and effort | the review's model and effort |

A Tier A slice builds at high and is reviewed at xhigh because one missed finding in money, tax, row-level security, an agent principal or deleted data is a production defect, and a fix round costs more than the extra effort. Reviews on Opus 5.5 found S2's defects at high and N1's at medium for under 1 % of the week each.

### Built-in agents
The built-in `Plan` and `general-purpose` agents run on the lead's own model, so the lead does not use them: it plans in its own conversation and gives building to `slice-builder`. The built-in `Explore` agent is replaced by the project's `Explore` agent on Haiku (below).

### How many at once
At most two builders on a PC day (8 GB, every heavy command through the lock) and three on a cloud day.

### What runs where on a PC day
The PC runs every check of `integrate.sh` but only the slice's own journeys (`E2E_SPECS`), and makes the Linux screenshots of the slice's own screens (`e2e:snap -- --grep`); CI runs every journey and compares every screenshot on the pull request. A screen whose picture shows figures other journeys make gets no screenshot until it has seeded figures of its own ([slice-integration §10](slice-integration.md#10-lessons)).

### Haiku agents
They skip `CLAUDE.md` (`omitClaudeMd`) and never touch migrations, row-level security, commands, tax or credit logic, product copy or reviews.

| Agent | Model and effort | Job |
|---|---|---|
| `Explore` | Haiku 5.5, high | Finds where code lives and answers "where is X"; it takes the place of the built-in Explore agent, which runs on the lead's model |
| `test-runner` | Haiku 5.5, medium | Runs one suite or check through the heavy-command lock for the lead and reports only the failures |
| `doc-clerk` | Haiku 5.5, high | Drafts CHANGELOG lines, the status page's tables and document-link fixes; the lead checks the draft before it is committed |

A subagent cannot start another subagent, so builders read their own logs (§6) and only the lead uses the Haiku agents.

### Where the settings take effect
- The Agent tool takes a model and an effort for each agent it starts; the effort needs Claude Code 2.1.292 or later. The desktop app's Agent tool offers it; before a lead session starts from a terminal, `claude --version` shows whether that command does. Where the Agent tool offers no effort, each agent runs at its file's default, the Tier A setting.
- `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` override every agent's setting, so neither is set in any settings file or environment of this project.

## 4. Getting it right the first time
1. **A tight brief:** the exact files, contracts and tests, what another slice owns, and when the slice is done.
2. **An early check on Tier A and B:** when the builder has the schema, migrations and commands, it commits, reports and stops; the lead reads that diff (Opus at xhigh for Tier A, at medium for Tier B) before the builder goes on to the screens.
3. **Commits as it goes:** at least every 20 minutes and at each finished layer, so a stopped builder loses nothing.
4. **One fix round:** the builder fixes every finding the review raised in one round; the lead reads that diff, and the reviewer re-checks it only when the review found a critical or high finding. A finding the round cannot fix becomes a follow-up in STATUS.
5. **`main` taken early:** when `main` has moved since the slice branched, it is merged into the slice before the review, not after.

## 5. The budget gate
Before starting any agent, the lead reads two numbers: the 5-hour window and the week. On the PC it reads them with the session's usage tool. In a cloud session, which cannot read them, the owner posts them at the session's start and whenever the lead asks before an agent, in one line: `usage: 5h 12, week 40`. The pace is 14 % of the week per day since Monday's reset.

| Reading | What runs |
|---|---|
| Weekly use at or under the pace and the 5-hour window at or under 50 % | Up to two agents at once on a PC day, three on a cloud day |
| Weekly use over the pace | One agent at a time |
| Weekly use at 85 % or more | No new build; only finishing, reviewing and merging what is in flight |
| The 5-hour window over 50 % | No new builder; a review or a running agent may continue |
| The 5-hour window at 75 % or more | Nothing new starts until it resets |
| A cloud reading older than two hours | One agent at a time |
| No cloud reading that day | Nothing new; the lead finishes, reviews and merges what is in flight, asks again, and never guesses a reading |

The usage card also shows a Fable bar. It stays at 0 %; a higher reading means a conversation or an agent ran on Fable 5.1, and the lead tells the owner.

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
| A Tier B build on Sonnet 5.5 at medium with its review on Opus 5.5 | 6 % | R1, 75 at the build's start to 81 at the fixes' start |
| A slice's fix rounds, merge with `main`, re-check fixes and integration, after its build | 5 % | K1, 70 to 75 |
| A review, Opus 5.5 at high or medium | under 1 % | S2 (high), 68 to 68; N1 (medium), 69 to 69 |
| The lead's integration of one slice | 1 % | S2, N1, K1 |
| A cloud day: A1, L1 and the journey fixes built by three agents, reviewed, integrated, with the day's documents | 13 % | 10-10-2026, 86 during the builds to 99 |

What the reviews found: S2 and K1, built on Opus 5.5 and finished or fixed on Sonnet 5.5 at medium, had 2 and 3 high findings; K1's fixes on Sonnet 5.5 at medium took four runs (the review fixes, the PDFium swap, the re-check fixes, findings 15 and 16) and two re-checks, 5 % of the week; A1, built on Opus 5.5 at medium, had 1 high finding and one fix round; L1, built on Sonnet 5.5 at high, had 1 medium. A fix round on a weaker setting than the build's is what multiplied K1's rounds, so the fix round runs on the build's model and effort. A slice built with one fix round is about 9 % of the week (R1, 75 to 82 plus its integration); a slice with several fix rounds reaches about 20 %. A week holds four to six slices with the lead's work, the documents and the hosted steps.

### How it is measured
1. Each agent run records its model and effort and the two bars at its start and end in the run file's Usage line (`build Opus high 20→27, 5h 10→48`).
2. `python3 tools/integration/agent-usage.py` (from the repository root, after `. tools/integration/lib.sh`) reads the session's own transcripts and prints, for the lead and each agent it started, the model and effort of every request and its tokens, counted per request. Agents that ran at the same time are told apart: `--since` and `--until` take the time the bars were read, and `--week-delta <points>` shares out what the week's bar moved by, weighted by each row's cost at the API's list prices. The end of each session runs it ([end-session](../../.claude/skills/end-session/SKILL.md)); a cloud session keeps its transcripts in the VM, and its first run there confirms the script finds them.
3. A run whose model or effort differs from its setting in §3 is recorded in its run file and told to the owner, with the reason.
4. M1 calibrates the shares: its build and its review each run with no other agent at the same time, so the week's bar movement belongs to that run and the lead, whose rows the script prints apart; the bar's points per API dollar over those rows check the script's weights, and the lead records them here.
5. M1 is the first Tier A slice built at high and reviewed at xhigh; its cost and its review's findings are compared with A1's (built at medium, 1 high finding; A1's review ran on Fable 5.1 at high, so the two are compared by their high and critical findings only).
6. Phase 2's first Tier B slice is a measured trial of a build on Sonnet 5.5 at high; Tier B builds move to Sonnet only when that slice's fix round is no larger than an Opus-built slice's.
7. The first operations day on Sonnet 5.5 is a trial: the lead records anything an Opus conversation had to redo; one redo, and operations days return to Opus 5.5 at medium.
8. After M1 and G1, the lead compares the week against the tables above and proposes at most two changes; each becomes a DECISIONS row.

### Limits that correct the plan
A run that costs more than its limit runs one effort step lower in the next slice of its tier, and the lead tells the owner. A slice over its limit steps down the run that cost it the most, by the script's shares. A review steps down only when it found no critical or high finding; one that found one keeps its effort.

| Work | Limit, in points of the week |
|---|---|
| A Tier A build on Opus 5.5 at high, to its report | 9 |
| A review on Opus 5.5 at xhigh, with its re-check | 2 |
| A Tier A slice from its brief to its merge | 15 |
| A Tier B slice from its brief to its merge | 12 |
| A Tier C slice from its brief to its merge | 8 |
