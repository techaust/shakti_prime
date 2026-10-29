# Models and usage

Which Claude model and effort level each task runs on, how many agents run at once, the budget gate the lead session checks before starting any agent, and how usage is measured. The owner approved this plan on 29-10-2026 ([DECISIONS](../11-decisions.md)).

**At a glance.** Opus 5.5 at high effort runs every task: the lead session, every agent and every check. No other model or effort is used. The number of agents at once follows the machine's resources: two on the PC with at most one driving a browser, and as many as the cloud VM's free memory and processors allow on a cloud day (§3). Before any agent, the lead reads the 5-hour window against the gate (§5); after the session, `tools/integration/agent-usage.py` shows what each run cost and whether it ran at its setting (§7).

## 1. Principles
- The plan is the claude.ai Team plan with a Premium seat: no weekly limit, and a 5-hour window shared by every model. Extra usage stays off; only the owner switches it on.
- One model and one effort do all the work: Opus 5.5 (`claude-opus-5-5`) at high, pinned in every agent file. Sonnet 5.5, Haiku 5.5 and Fable 5.1 are not used, and neither are the low, medium, xhigh and max efforts. The pin stays on Opus 5.5 for the whole project; only when Anthropic retires it does its successor in the Opus family take its place, at high, and the lead tells the owner.
- Rework and test re-runs cost more than any setting (§7), so the brief carries the review's checklist and builders test their own screens before they report.
- A session runs entirely on the PC or entirely in a cloud session, as the owner chooses that day; the model, the effort and the gate are the same in both places, and only the number of agents at once differs (§3).

## 2. Slice tiers
The lead sets the tier when it writes the brief, and the run file's header records it. A slice takes the highest tier of anything it holds. The tier decides the checks a slice gets (§3, §4), not its model or effort. Every phase's slices are tiered by this table: for example the Tally connector, payments and stock (A), the voice agent and the WhatsApp Concierge as agent principals (A), the field app's offline writes and their sync (B), and the field app's screens over existing commands (C).

| Tier | What puts a slice in it | Phase 1 slices |
|---|---|---|
| A | Money, credit, tax, ledgers, row-level security, AI agent principals, deleting or anonymising data | S2, A1, M1, G1 |
| B | State machines, permissions, workers, notifications | N1, K1, T2, R1 |
| C | Screens composed from existing commands | L1 |

## 3. Who runs what

### The lead session
The owner sets Opus 5.5 at high in the app for every lead conversation, on the PC or in the cloud: starting and ending the day, briefs, starting agents, early checks, fix diffs, integration, pull requests, merging, `migrate-hosted`, documents, phase design and unexplained failures. A change of effort in the middle of a conversation reads its whole context again, so the effort is set before the conversation starts.

### Agents per slice
Every agent runs on Opus 5.5 at high, the setting its file holds; the lead passes the same model and effort when it starts one.

| Work | Tier A | Tier B | Tier C |
|---|---|---|---|
| Build (`slice-builder`), with the reviewer's checklist in the brief and the slice's own journeys run before the report | yes | yes | yes |
| Early check of the schema, migrations and commands, by the lead, before the screens (§4) | yes | yes | none |
| Finish checks after a stop (`slice-builder`) | yes | yes | yes |
| Review (`slice-reviewer`), once | yes | yes | yes |
| Fix every finding, in one round (`slice-builder`) | yes | yes | yes |
| Check the fix diff, by the lead | yes | yes | yes |
| Re-check the fix diff (`slice-reviewer`), only when the review found a critical or high finding | yes | yes | yes |

### Built-in agents
The built-in `Plan` and `general-purpose` agents are not used: the lead plans in its own conversation and gives building to `slice-builder`. The built-in `Explore` agent is replaced by the project's `Explore` agent (below), which carries the repository's map.

### Helper agents
They skip `CLAUDE.md` (`omitClaudeMd`) and never touch migrations, row-level security, commands, tax or credit logic, product copy or reviews.

| Agent | Model and effort | Job |
|---|---|---|
| `Explore` | Opus 5.5, high | Finds where code lives and answers "where is X"; it takes the place of the built-in Explore agent |
| `test-runner` | Opus 5.5, high | Runs one suite or check through the heavy-command lock for the lead and reports only the failures |
| `doc-clerk` | Opus 5.5, high | Drafts CHANGELOG lines, the status page's tables and document-link fixes; the lead checks the draft before it is committed |

A subagent cannot start another subagent, so builders read their own logs (§6) and only the lead uses the helper agents.

### How many at once
The number of agents follows the machine's resources. Every agent the lead starts counts, the helper agents too. A browser agent is one that drives a browser: the journeys, the Linux screenshots (`e2e:snap`) or the browser pane.

| Machine | Agents at once | Browser agents at once |
|---|---|---|
| The owner's PC (8 GB) | At most two | At most one of the two |
| A cloud VM (about 4 vCPUs, 16 GB) | Another agent starts while the VM has at least 3 GB of memory available (`free -m`) and its 1-minute load average (`uptime`) is below its processor count (`nproc`), up to five | At most two |

On a cloud day the lead runs `bash tools/integration/cloud-capacity.sh --agents <running> --browser-agents <running in a browser>` (with `--browser` for an agent that will drive one) before each start; it starts the agent only on a `yes`, and records the memory and load it printed beside the 5-hour reading in the run file's Usage line. Heavy commands take turns through the lock on both machines, whatever the number of agents.

### What runs where on a PC day
The PC runs every check of `integrate.sh` but only the slice's own journeys (`E2E_SPECS`), and makes the Linux screenshots of the slice's own screens (`e2e:snap -- --grep`); CI runs every journey and compares every screenshot on the pull request. A screen whose picture shows figures other journeys make gets no screenshot until it has seeded figures of its own ([slice-integration §10](slice-integration.md#10-lessons)).

### Where the settings take effect
- The Agent tool takes a model and an effort for each agent it starts; the effort needs Claude Code 2.1.292 or later. The desktop app's Agent tool offers it; before a lead session starts from a terminal, `claude --version` shows whether that command does. Where the Agent tool offers no effort, each agent runs at its file's setting, Opus 5.5 at high.
- `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` override every agent's setting, so neither is set in any settings file or environment of this project.

## 4. Getting it right the first time
1. **A tight brief:** the exact files, contracts and tests, what another slice owns, and when the slice is done.
2. **An early check on Tier A and B:** when the builder has the schema, migrations and commands, it commits, reports and stops; the lead reads that diff before the builder goes on to the screens.
3. **Commits as it goes:** at least every 20 minutes and at each finished layer, so a stopped builder loses nothing.
4. **One fix round:** the builder fixes every finding the review raised in one round; the lead reads that diff, and the reviewer re-checks it only when the review found a critical or high finding. A finding the round cannot fix becomes a follow-up in STATUS.
5. **`main` taken early:** when `main` has moved since the slice branched, it is merged into the slice before the review, not after.

## 5. The budget gate
Before starting any agent, the lead reads one number: the 5-hour window (the plan has no weekly limit). On the PC it reads it with the session's usage tool. In a cloud session, which cannot read it, the owner posts it at the session's start and whenever the lead asks before an agent, in one line: `usage: 5h 12`. The limit is the owner's (29-10-2026).

| Reading | What runs |
|---|---|
| The 5-hour window at or under 95 % | New agents start, up to the machine's number (§3) |
| The 5-hour window over 95 % | Nothing new starts until it resets; a review or a running agent continues and commits as it goes |
| A cloud reading older than two hours | One agent at a time |
| No cloud reading that day | Nothing new; the lead finishes, reviews and merges what is in flight, asks again, and never guesses a reading |

The usage card also shows a Fable bar where the plan has one. It stays at 0 %; a higher reading means a conversation or an agent ran on Fable 5.1, and the lead tells the owner.

The day runs in 5-hour windows, with the expensive work at a window's start: the first for starting the day, the brief or the review triage and the builder; the second for the review and its fixes; the third for integration, `migrate-hosted` and ending the day. A builder started near 95 % commits as it goes, so a window that runs out loses nothing and a fresh agent continues after the reset.

## 6. Habits that save usage on any model
- The builder's tools are a fixed list (the built-in file, shell and skill tools and Context7), not every MCP server.
- Long output (suites, build, journeys, lint) goes to a log file; agents read the summary and failure lines (`tail`, `grep`), never the whole log.
- The reviewer reads the diff and opens a whole file only where the diff points to it.
- One lead conversation per slice event (brief, review triage, integration), closed with a handover in the run file; the prompt cache lasts an hour, so a conversation left idle longer pays to read its whole context again.
- No progress check-ins while agents run.

## 7. Measuring

### What a slice cost before 29-10-2026
From the run files' Usage lines of October 2026, as a share of the weekly allowance the earlier Max 5x plan had, on the models and efforts each run used then; they show what each kind of work costs against the others:

| Work | Cost | Recorded in |
|---|---|---|
| A Tier B build on Sonnet 5.5 at medium with its review on Opus 5.5 | 6 % | R1, 75 at the build's start to 81 at the fixes' start |
| A slice's fix rounds, merge with `main`, re-check fixes and integration, after its build | 5 % | K1, 70 to 75 |
| A review, Opus 5.5 at high or medium | under 1 % | S2 (high), 68 to 68; N1 (medium), 69 to 69 |
| The lead's integration of one slice | 1 % | S2, N1, K1 |
| A cloud day: A1, L1 and the journey fixes built by three agents, reviewed, integrated, with the day's documents | 13 % | 10-10-2026, 86 during the builds to 99 |

What the reviews found: S2 and K1, built on Opus 5.5 and finished or fixed on Sonnet 5.5 at medium, had 2 and 3 high findings; K1's fixes on Sonnet 5.5 at medium took four runs (the review fixes, the PDFium swap, the re-check fixes, findings 15 and 16) and two re-checks, 5 % of the week; A1, built on Opus 5.5 at medium, had 1 high finding and one fix round; L1, built on Sonnet 5.5 at high, had 1 medium. A fix round on a weaker setting than the build's is what multiplied K1's rounds. A slice built with one fix round was about 9 % of the week (R1, 75 to 82 plus its integration); a slice with several fix rounds reached about 20 %.

### How it is measured
1. Each agent run records its model and effort and the 5-hour bar at its start and end in the run file's Usage line (`build Opus high, 5h 10→48`), and on a cloud day the VM's available memory and load at its start (`mem 6.1 GB, load 2.4/4`).
2. `python3 tools/integration/agent-usage.py` (from the repository root, after `. tools/integration/lib.sh`) reads the session's own transcripts and prints, for the lead and each agent it started, the model and effort of every request and its tokens, counted per request. Agents that ran at the same time are told apart: `--since` and `--until` take the time the bar was read, and `--week-delta <points>` shares out what the 5-hour bar moved by within one window, weighted by each row's cost at the API's list prices. The end of each session runs it ([end-session](../../.claude/skills/end-session/SKILL.md)); a cloud session keeps its transcripts in the VM, and where the script finds none there, the bars in the Usage lines are the record.
3. A run on anything but Opus 5.5 at high is recorded in its run file and told to the owner, and the next run goes back to it.
4. What a run costs is a record: it decides how many slices the gate lets a window hold, never a model or an effort.
