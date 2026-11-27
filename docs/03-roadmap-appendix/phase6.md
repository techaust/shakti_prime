# Backend and product design: Phase 6 (AI brain and autonomy)

Date: 27-11-2026. Status: approved by the owner on 27-11-2026, with every question of §2 decided as the recommended option. Built slice by slice in the order of §3 once approved; in the push's scope (DECISIONS, 27-11-2026) this phase is built in the second push. Governing documents: BLUEPRINT §7.8, §8.10, §9.2, §9.3; ROADMAP §8; PRD AI-03, AI-04, AI-05, RPT-01, RPT-02; SECURITY §3.3 and §6; ADR 0011, 0014, 0020, 0021; the machines `agent-action` and `inbox-item`; [the Phase 2 design](phase2.md) (A2, A3, G2, V2) and [the Phase 4](phase4.md) and [Phase 5](phase5.md) designs.

**Contents:** [1. Scope](#1-scope) · [2. Decisions for the owner](#2-decisions-for-the-owner) · [3. Slices](#3-slices) · [4. Principals and grants](#4-principals-and-grants) · [5. Slices in detail](#5-slices-in-detail) · [6. Final-phase verification](#6-final-phase-verification) · [7. Tests per slice](#7-tests-per-slice) · [8. Gaps and conflicts](#8-gaps-and-conflicts-in-the-governing-documents)

## 1. Scope
**What exists:** the agent runtime (`packages/domain/src/ai/runtime.ts`, the provider wrapper with masking, the untrusted label, timeouts, a breaker and spend caps), three live agents (Triage, Concierge, Co-pilot) starting in Shadow, `agent_configs` with autonomy per agent, action type and company and the kill switches, the Agent Inbox and its machines, `agent_runs` (model, tokens, cost, outcome; never the prompt or the answer), the recorded-answer eval and injection sets per agent in CI, live-model eval scripts run by hand, the shadow reports (A1, G2), and `AGENT_DEFAULTS.promotion` (200 decided, 95 % unedited, 90 days) checked by `agents.config.set`, which still refuses Automatic (`automaticAvailable: false`), while a stored Automatic files a Needs approval suggestion. `agent:sizing`, `agent:orchestrator` and `agent:chief` are declared with their grants and unused. Voice has Teach and Ask; `VOICE_MODES` names Command. The Executive home has sales and pipeline, no margins; no report library or export exists (`reports.export` is seeded, unused).

**In Phase 6:** the Sizing & Quote, Project Orchestrator and Chief of Staff agents; voice Command mode; autonomy promotion per action type with its report, the Executive's recorded sign-off, Automatic execution and demotion; regression evals on every prompt or model change; run traces; the Executive P&L home and the report library with audited exports (RPT-01, RPT-02).

**In the final phase:** each promotion, which needs 200 real decided cases at 95 % unedited per action type and the Executive's sign-off (the exit gate); the Executive's review of each agent's shadow report on live data.

## 2. Decisions for the owner
1. **Models** (all). **Decided: (a)** Sonnet 5.5 and Haiku 5.5 as the Phase 2 decision of 13-11-2026 names them, each agent's model a named default in `AGENT_DEFAULTS`, a change only with its eval set passing (AU1).
2. **What the Sizing & Quote agent does** (AG1). **Decided: (a)** it proposes a quote (action type `sales.quote.create`) for an opportunity whose sizing a person has recorded (ADR 0021 keeps sizing people-only), at tier prices with each line's availability status (H2), starting in Suggest; it never sends a quote. (b) It also proposes the sizing for a person to record.
3. **The Orchestrator's actions** (AG2). **Decided: (a)** three action types: `projects.visit.propose` (from J5's slot finder), `documents.request` (J7) and `projects.sla.alert` (a nudge to the owner), starting in Shadow.
4. **The Chief of Staff's briefing** (AG3). **Decided: (a)** at 08:00 IST a home card and a browser push for each Executive and General Manager: the deterministic anomalies and figures from report queries run under the viewer at render time, and a short narrative that names no cost, margin or rate (BLUEPRINT §9.3); the narrative is generated from counts and names only.
5. **Promotion and demotion** (AU1). **Decided: (a)** an action type reaches Automatic only when its report shows ≥ 95 % unedited over ≥ 200 decided cases in the window and an Executive records the sign-off (a command, audited, naming the report's figures); Automatic then executes and notifies; it falls back to Needs approval by itself when the rolling 7-day unedited share falls under 90 % or any execution is reversed by a person, and the Executive is told. (b) Manual demotion only.
6. **Regression evals** (AU1). **Decided: (a)** the recorded sets stay in CI; a live-model eval workflow runs on demand and nightly against each agent's set with a spend cap, writing `agent_evals`; a prompt or model change cannot reach an environment until its live eval passes. It needs an `ANTHROPIC_API_KEY` repository secret (the owner's) and is a checks change.
7. **Traces** (AU1). **Decided: (a)** each run keeps its masked prompt and answer for 30 days in a restricted table read only with `audit.read`, so an Executive can see why an agent did what it did; identity numbers are masked before the model, as now. (b) Keep metadata only, as today.
8. **Voice Command** (VC1). **Decided: (a)** for Executives and General Managers first: a spoken request becomes a proposed action of an existing action type, shown as a card the speaker confirms with a tap; nothing runs from speech alone; the same commands, permissions and audit as the screen.
9. **Reports** (RP1). **Decided: (a)** the report library of BLUEPRINT §8.10 as queries under the viewer's permissions, each export a command with `reports.export`, audited with its filters and row count; margins only with `finance.cost.read`.

## 3. Slices
| Wave | Slice | Needs | Tier | Requirements |
|---|---|---|---|---|
| 1 | AU1 Promotion, Automatic, demotion, evals and traces | — | A | AI-04, AI-05 |
| 1 | RP1 Executive P&L home and the report library | FN6 | A | RPT-01, RPT-02 |
| 2 | AG1 Sizing & Quote agent | AU1, H2 | A | BLUEPRINT §9.3 agent 4 |
| 2 | AG2 Project Orchestrator | AU1, J5, J7 | A | agent 5, PRJ-04 |
| 2 | AG3 Chief of Staff | AU1, RP1 | A | agent 6 |
| 3 | VC1 Voice Command mode | AU1 | A | AI-03 (Command) |
| 3 | G6 Phase 6 exit pack | all | A | the exit gate's engineering items |

## 4. Principals and grants
`agent:sizing` keeps `pricing.read`, `inventory.stock.read`, `sales.quote.create` (entity) and gains `crm.opportunity.read` (entity) to read the opportunity it quotes; `agent:orchestrator` keeps its declared grants; `agent:chief` keeps read grants only and gains `reports.read` for counts (no cost report). None holds `finance.cost.read`, `procurement.rate.read`, `documents.sensitive.read` or any tax, price or catalogue write; the refusal sweep covers every Phase 6 action type.

## 5. Slices in detail
- **AU1:** a promotion report per agent, action type and company (decided, unedited, edited, rejected, the window); `agents.promotion.signoff` (Executive) and the Automatic path in `record-run.ts` (execute through the command as the agent principal, then notify); demotion by a nightly check and on a person's reversal; `automaticAvailable` per action type; the live eval workflow and `agent_evals`; `agent_run_traces` (masked, 30 days, `audit.read`); Admin › Agents shows each action type's figures beside its autonomy.
- **RP1:** the Executive home's P&L by company and segment, cash and collections (FN3), project margins (FN6), agent performance and AI spend; the GM's SLAs; the library: funnel by source, campaign and caller; ad ROI; quote to order; order fulfilment time; project cycle time per gate; subsidy and loan status; stock valuation; job-cost variance; incentive statements; each with audited export.
- **AG1:** triggered by a recorded sizing on an opportunity without a quote; the proposal names its sizing, lines, tiers and availability; the filter refuses any price not from the tier, any line out of the sizing's bounds, any cost; a person approves, edits or rejects in the Inbox.
- **AG2:** on project events and a daily scan: proposes visits for milestones waiting, requests missing documents before a gate, and nudges owners on steps past their SLA (named defaults per step); customer messages only through approved templates and the WhatsApp rules.
- **AG3:** the 08:00 IST briefing job; anomalies as deterministic checks (leads unassigned past SLA, quotes expiring, orders blocked on credit, dispatches lapsing e-way bills, reconciliation queue age, cash below a named threshold); the narrative from counts and names; the card renders figures under the viewer.
- **VC1:** `command` joins `VOICE_SESSION_MODES`; the worker maps a request to one of the speaker's permitted action types through a closed tool schema; the BOS files it as a proposal owned by the speaker; the card on screen confirms or discards; latency inside V2's budget for the spoken acknowledgement.
- **G6:** the refusal sweep and injection sets for the three new agents; the promotion path end to end on synthetic decisions; runbooks (an agent misbehaving: kill switch; a bad promotion: demote); Sentry alerts on demotions and eval failures; the final-phase checklist.

## 6. Final-phase verification
Each agent's shadow report reviewed with the Executive on two weeks of live data; each action type promoted only at ≥ 95 % unedited over ≥ 200 decided cases with the Executive's recorded sign-off (the exit gate); voice Command tried by the Executives on production.

## 7. Tests per slice
The base of §13 of the earlier designs, and: AU1, promotion refused below the thresholds and without sign-off, demotion on the 7-day share and on a reversal, traces masked and restricted; RP1, every figure against its list, no margin without the grant, exports audited; AG1–AG3, recorded-answer and injection sets, the filter refusals, no cost in any proposal or narrative; VC1, nothing runs without the tap, the speaker's permissions only.

## 8. Gaps and conflicts in the governing documents
BLUEPRINT §9.3's "full traces" against `agent_runs` keeping no prompt or answer (question 7); BLUEPRINT's model names (Sonnet 5, Haiku 4.5) against the Phase 2 decision; `agent:sizing` lacks a read of the opportunity it quotes (§4).
