# G2 Shadow review pack (wave 4)

| | |
|---|---|
| Branch | `feat/g2-shadow-pack` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): reports over AI agent principals' work, read under row-level security |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; built on Opus 5.5 at high effort (start and early check) |
| State | early check |
| Next step | the lead reads the early check and sends "continue" |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §8.1](../../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack), its first bullet (the shadow reports and the 50-pair samples), §12 (rows A3, A2: the reports are reviewed with the Executive on real traffic in the final phase; here they are built and tested on seeded data), §14 (G2: "the shadow report queries").
- What exists: [a3-concierge.md](a3-concierge.md) and [a2-copilot.md](a2-copilot.md) (their Built and shadow report parts), the Phase 1 report (`docs/03-roadmap-appendix/phase1.md` §9, A1). Code: `packages/domain/src/queries/agents/` (`shadow-report.ts`, `concierge.ts`, `copilot.ts`, `spend.ts`), `apps/web/src/screens/shadow-report.ts`, `apps/web/src/screens/concierge/concierge-report.tsx`, `apps/web/src/screens/copilot/copilot-report.tsx`, `apps/web/src/components/agents/shadow-report-screen.tsx`, the pages under `apps/web/src/app/(bos)/admin/agents/`, and the print path in `apps/web/src/print` if you print.
- SECURITY §3.2 to §3.4 (who reads agent reports; cost isolation), `docs/08-design-system.md` §11 (copy).

Build, in this order:
1. **The gap list.** Compare what the Concierge and Co-pilot reports show today with §8.1: per action type the proposals, the agreement with what people did, the filter refusals, the handoffs, and the spend per lead. Write the list into your report first; build only the gaps, reusing the existing queries and screens (extend, never duplicate).
2. **Queries** in `packages/domain/src/queries/agents/`: for each agent and period, per action type: proposals, decided, agreed, disagreed, open; refusals by filter reason; handoffs by reason (the Concierge's hand-offs to people; for the Co-pilot, state in the report what its nearest equivalent is, or that it has none); AI spend per lead (the agent's spend in the period over the distinct leads it worked on, from what `spend.ts` reads). Spend here is the agents' AI spend, never item cost or supplier rates: no `finance.cost.read` or `procurement.rate.read` data is read. The same permission as today's reports gates them; read under the viewer's own context, never a definer that widens it.
3. **The review sample:** 50 draft-and-reply pairs per agent for a period, chosen deterministically (spread evenly over the period, the same period always giving the same 50), each with its action type, the draft, what the person sent or did, and the filter's verdict; customer text masked as the reports already mask it and shown as data. A read-only page per agent built to print (a print stylesheet on the screen, or the existing HTML print path, always light); the Executive reviews it offline, so nothing is recorded.

**Early check (Tier A):** once steps 1 to 3's queries are committed with their tests (on real Postgres: per action type counts on seeded proposals, the sample's determinism and size, a role without the report's permission refused, another company's rows never counted), write a short report here, push `report: g2-shadow-pack early check` and stop. The lead reads the diff and sends "continue" to this session.

4. **Screens:** the new figures on the Concierge and Co-pilot reports, and the sample pages linked from them; copy in `en.json`; journeys with axe and light, dark and 400 px snapshots; the JavaScript budget (`pnpm --filter web js-budget` after the build).
5. **Evidence and documents:** `EXPLAIN (ANALYZE)` for each new query on the seeded database in your report; the design's "Built (G2 shadow pack)" lines under §8.1; the agents' document where it lists the reports.

Files owned: the queries above, `apps/web/src/screens/concierge/`, `apps/web/src/screens/copilot/` report files (not `draft-line.tsx`), `apps/web/src/screens/shadow-report.ts`, `apps/web/src/components/agents/`, the report pages under `apps/web/src/app/(bos)/admin/agents/`.

Do not touch: `packages/domain/src/ai/concierge/rules.ts` and `apps/web/src/screens/concierge/draft-line.tsx` (`p2-fixes`), `apps/web/src/observability/` and the jobs check (`g2-alerts`), `docs/runbooks/` and `docs/13-client-packs/` (`g2-runbooks`), `docs/04-architecture-appendix/` (`g2-measures`), `apps/web/src/workers/messaging/` (`p2-fixes`, `w2-media-retention`).

Review checklist (check before your report): every figure reads under the viewer's own permissions and one company's rows; no cost or supplier figure; customer text masked and never rendered as markup; the sample is deterministic and capped at 50; the queries have indexes behind them (EXPLAIN); the pages print light; every word is plain final English.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/g2-shadow-pack` is on GitHub with this file. Start with `git fetch origin && git switch feat/g2-shadow-pack` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: g2-shadow-pack <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: g2-shadow-pack done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: g2-shadow-pack fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: g2-shadow-pack blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

### 20-11-2026, cloud session: the gap list (step 1)
What the two reports show today against §8.1's first bullet (per action type: proposals, agreement with what people did, filter refusals, handoffs, spend per lead; a sample of 50 draft-and-reply pairs per agent):

| §8.1 asks for | Concierge report (`/admin/agents/concierge`) today | Co-pilot report (`/admin/agents/copilot`) today | Gap built here |
|---|---|---|---|
| Proposals per action type | `proposals`: per type shadowed, waiting, approved, rejected | the same | kept; extended with decided |
| Agreement with what people did, per type | only for replies, as draft states (sent, edited, discarded) and `answered`; none for the facts or the callback | outcome and fact agreement of the call summaries (not an action type); none per proposal type | per type agreed, edited, disagreed and open, by a rule per type (below) |
| Filter refusals | by reason for the whole agent | the same | by action type and reason, beside each type |
| Handoffs | none (the chat's current `handoff_reason` only, which a chat given back loses) | none | the Concierge's hand-offs by reason and by whom (the assistant's rules or a person), from the audit trail; the Co-pilot has no hand-off, stated on its report |
| Spend per lead | none (Integration health shows spend per agent, not per lead) | none | the agent's spend, runs and distinct leads in the period, and spend per lead |
| 50 draft-and-reply pairs | none (a paged list of every draft) | none (a paged list of every summary) | a sample query per agent and a print page each (step 4) |

### 20-11-2026, cloud session: early check (steps 1 to 3, queries)
**Built** (commit `feat(agents): shadow pack figures, …`):
- `packages/contracts/src/shadow-pack.ts`: `AgentProposalFiguresDto` (per action type: proposals, shadowed, waiting, approved, rejected, decided, agreed, edited, disagreed, open, and the refusals of that type by reason), `AgentSpendPerLeadDto`, `ConciergeHandoffCountDto`, `ShadowSampleInput` (a period of at most 92 IST days, as the reports), `ShadowSampleDto` (at most 50 items). `ConciergeReportDto` and `CopilotReportDto` take the figures in `proposals` (extended, not a second list) and gain `spend`; the Concierge's gains `handoffs` (null for a viewer without `audit.read`).
- `packages/domain/src/queries/agents/shadow-pack.ts`: `shadowActionsSql()` (one statement for the figures and the sample: each proposal, its lead, and how what people did compares), `proposalFigures()`, `agentRefusals()` and `refusalsByReason()`, `spendPerLead()`, `conciergeHandoffs()`, `loadConciergeSample()` and `loadCopilotSample()` (exported from `@shakti/domain`); `replyLaterals()` moved here from `conciergeDraftsSql()`, which now uses it, so the report and the sample read a draft's two messages by one statement. `loadConciergeReport()` and `loadCopilotReport()` call the shared figures in place of their own proposals and refusals queries; the three reports' identical reader checks are one, `checkShadowReader()` in `shadow-report.ts`.
- Migration `0219_shadow_pack_hand_off_index` (renumbered at the merge): `audit_logs_hand_off_idx` on `(entity_id, created_at)` where the command is one of the two hand-offs; `docs/data/` regenerated.

**Agreement rules** (the brief left them to the build):
- A person's decision first: approved as proposed agrees, approved after an edit counts as edited (its own figure), rejected or dismissed disagrees, waiting is open.
- In Shadow, per action type: qualification facts agree when every fact the lead records of those proposed equals it, disagree when one differs, open when the lead records none (the five measures; a DISCOM consumer number is neither compared nor shown); a task (the Concierge's callback, the Co-pilot's follow-up) or a template agrees when a person made a task on the lead, or sent that template on the lead's chat, at or after the proposal, disagrees when the lead was won or lost without one, else open; a reply in Shadow stays open, since only a reader can set two texts side by side, which is what the sample is for.

**Handoffs:** the Concierge's, from the audit trail (`messaging.thread.record_hand_off`, the assistant's rules and answers; `messaging.thread.hand_off`, a person who took the chat), only those that moved the chat from the assistant, by reason and by whom. The Co-pilot has none and no near equivalent: it never answers a customer, a caller makes every call; its report carries no hand-off figure and says so.

**Spend per lead:** the sum of `agent_runs.cost_paise` of the agent in the company and period (every run, refused and stopped ones too), over the distinct leads its proposals name (a reply through its chat's lead) and, for the Co-pilot, the leads of its briefs and summaries; rounded half up to the paisa. No `finance.cost.read` or `procurement.rate.read` data is read.

**The sample:** the period's proposals in time order cut into 50 runs of equal length (`ntile(50)` over `(created_at, id)`), the first of each, oldest first; every proposal when there are 50 or fewer. Each item: action type, the proposal (reply text, facts, task or template), what people sent or did (the first message a person sent after the draft and before the customer wrote again; the lead's recorded facts; the first task a person made on the lead after it; the template a person sent), the state and the agreement; the customer's message as stored (masked), plain text.

**Tests:** `packages/domain/tests/queries/shadow-pack.test.ts`, 10 cases on real Postgres, rows seeded into a random 30-day period of 2001 to 2020 in company 3 with company 1's rows beside them: per action type counts and agreement for the three Concierge types (decided, edited, Shadow by rule), refusals per type, hand-offs by reason and whom (a no-op hand-off and company 1's not counted; a GM reads them; a viewer without `audit.read` gets none), spend per lead for both agents (company 1's ₹999.99 runs never counted), the Co-pilot's template agreement, the sample of 12 (all, oldest first, with the asked message, the person's reply, the facts with no consumer number, the task) and of 121 (exactly 50, the expected `ntile` picks, the same on a second read), a caller and an agent refused, a company outside the request refused, a period over 92 days refused. `reader-parity.test.ts` covers the two samples on both pools.

**Checks in this VM:** `pnpm --filter <contracts, db, domain, web> typecheck` clean; `pnpm exec eslint --max-warnings 0` on `packages/domain/src/queries/agents`, `packages/domain/tests/queries`, `packages/contracts/src`, `packages/db/src/schema` clean; `@shakti/contracts` unit tests 322 passed; `@shakti/domain` unit tests 2590 passed (108 files); the new file and `reader-parity`, `shadow-report`, `concierge-runs`, `copilot-runs` on Postgres 62 passed; `pnpm db:docs` regenerated; `pnpm test:security`: `@shakti/db` 1508 passed (58 files); `@shakti/domain` 1375 passed, 24 failed, all in `tests/commands/whatsapp-quotes.test.ts`; `web` (run on its own, since Turbo stopped after the domain suite) 429 passed, 16 failed, all in `tests/whatsapp-quotes.test.ts`. Both failing files are the known clock-dependent fault (a test number starting with 91 until about 19:00 UTC today) that the lead's session reported on every branch, fixed by techaust/shakti_prime#269; nothing else fails. A first run failed `fail-closed.test.ts` (8 agent principals for 6): the new test had made an agent principal row of its own; it now uses the seeded agent's id with no row (commit `test(agents): refuse the review sample…`), and the two rows made locally were removed.

**Assumptions:**
- The filter's verdict per pair: every proposal kept passed the filter (a refused answer keeps only its reason, never its words, and records no chat or lead), so the sample shows each pair's state and agreement and, beside the pairs, the period's refusals by action type and reason; a per-pair "refused" line would need the refused answers stored, which §7.2 and the runtime rule out.
- Hand-offs come from the audit trail, readable by the Executive and the General Manager; a custom role holding an agent control without `audit.read` sees the other figures and no hand-offs (null, not zero).
- Spend per lead uses the leads the agent proposed on (and the Co-pilot's notes), not every chat it read: a run that proposed nothing has no lead to count but its cost counts.

**Next:** step 4 (the figures on both reports, the sample pages, copy, journeys) on "continue".

## Review

## Integration
