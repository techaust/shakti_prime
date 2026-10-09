# A1 Triage in shadow (wave 5)

| | |
|---|---|
| Branch | `feat/a1-triage`, from `main` at 2e4ad05a (#144) |
| PC worktree | cloud day: `/home/user/shakti-wt/a1-triage`, slot 3: Postgres 54333 (container `shakti-pg-a1-triage`), app 3033 |
| Runs on | cloud, beside L1 and the journey fixes (owner, 09-10-2026: all pending Phase 1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | A (AI agent principal, row-level security): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | not readable in the cloud session; the owner ran the day past the budget gate by instruction |
| State | building |
| Next step | build |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §9](../../03-roadmap-appendix/phase1.md#9-wave-5) (A1), §3 (A1 needs N1, D1, C3), §7.1 "Built (AI0)" (the runtime you build on) and §12.
- PRD AI-04 ("Agent runtime, Agent Inbox and the Triage agent in shadow"; rollout shadow → approval → automatic) and AI-05 (guardrails the Triage agent needs: untrusted-input labelling, deterministic output filters, PII masking, no cost access, injection test set passing), with their trace rows; BLUEPRINT §6.2 (dedupe), the scoring line ("rules-based, refined within bounds by the Triage agent") and the agent table (Intake & Triage on Haiku 4.5); SECURITY §3.3 (agent principals) and §5–§6 (masking); ADR 0020 (`system:workers`).
- What exists: `packages/domain/src/ai` (`provider.ts` with the spend reservation, `models.ts`, `agent-defaults.ts`, `transport.ts` with the fake transport, `runtime.ts` `runAgentStep()`, `config.ts`), `privacy/model-text.ts`, the agent tables of migrations 0107–0108 (`agent_configs`, `agent_runs`, `agent_actions`, `inbox_items`, `agent_evals`), the `agent_action` machine, `AGENT_MATRIX['agent:triage']` in `packages/contracts/src/agent-principals.ts`, the event `crm.lead.created` and the event workers (`apps/web/src/workers/events`), C3's scoring rules and pipelines, D1's duplicate candidates, the assignment commands, Admin › Integration health (`apps/web/src/app/(bos)/admin/integrations`), the agent refusal sweep `packages/domain/tests/security/agent-refusals.test.ts`.
- Skills: `add-command`, `add-table`, `claude-api` (model ids; the provider wrapper already pins Haiku 4.5 — keep it), `supabase-postgres-best-practices`.

1. **Shadow as a rollout level.** A way for an agent's action type to run in shadow: the proposal is recorded as an agent action that never acts and never reaches the Inbox. Choose and state the design (a `shadow` autonomy below `suggest`, or a shadow flag on the config) with its migration, machine change (`machines:docs`), contracts and Admin › Agents control; Triage's action types start in shadow by default (`agent-defaults.ts`). Raising it to Suggest or above stays an Executive's choice on Admin › Agents.
2. **The Triage agent** `agent:triage`, run by an event worker on `crm.lead.created` through `runAgentStep()`:
   - reads the lead through a narrow read with no names, phone numbers, addresses or identity numbers (masked text only, `privacy/model-text.ts`); every field from the customer is labelled untrusted in the prompt;
   - proposes, through tools that wrap existing commands (never a write of its own): the pipeline, a score adjustment within the bounds C3 sets, duplicate links from D1's candidates, and an assignee among people eligible to take the lead;
   - a deterministic output filter rejects any proposal outside those bounds, any unknown id, and any text field carrying a phone number, an identity number or an instruction; rejected proposals are recorded with their reason;
   - each proposal is recorded as a shadowed action, with the run's cost through the provider wrapper's caps; with no `ANTHROPIC_API_KEY` the run is recorded as unavailable, as AI0 does.
   - The agent holds no cost or supplier-rate permission; if a grant in `AGENT_MATRIX['agent:triage']` is broader than these tools need, narrow it and say so.
3. **The shadow report:** for a company and a period, each shadowed proposal beside what people actually did to that lead (pipeline, score, merge, assignee), with agreement rates per proposal kind; a query through `executeQuery()` and a page under Admin › Agents (Executive and GM per their existing agent-settings access), no customer names beyond what the viewer may read.
4. **AI spend per agent on Integration health:** the day's and month's spend and runs per agent per company from `agent_runs`, beside the caps.
5. **Eval and injection sets:** a recorded-answer eval set (`agent_evals` or fixtures under `packages/domain/tests`) and a prompt-injection set (instructions hidden in the lead's notes, source fields and names) that run in CI against the fake transport with recorded model answers and assert the filter's verdicts; a script `pnpm --filter @shakti/domain eval:triage` that runs the same sets by hand against the live model when the key is present (never in CI).
6. **Tests:** the filter and the prompt builder (pure, unit-tested); the worker end to end on Postgres with the fake transport (a lead created → a shadowed action, no Inbox item, no change to the lead); the agent refusal sweep over any new command; RLS for any new table or definer in the role × company matrix (`per(e, 0x58)` to `0x5f`); the shadow report query and its `EXPLAIN (ANALYZE)` under RLS; a journey in `apps/web/e2e/agents.spec.ts` or a new spec (a lead created by the stand-in path shows a shadowed proposal on the report, nothing in the Inbox, the Integration health spend line), with axe and snapshots in light, dark and 400 px on seeded figures of its own.
7. **Documents:** design §9 "Built (A1)", DATABASE, SECURITY §3.3 and §6 (the Triage tools and filters), the PRD trace for AI-04 and AI-05, `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch; the injection set passes on recorded answers; a created lead yields a shadowed proposal and changes nothing else.

Not in A1: the Concierge and Co-pilot (Phase 2), any automatic action by Triage, any change to the scoring rules themselves, enrichment from outside sources. L1 is built at the same time on `feat/l1-converting` (`/converting`, the next-best-action function): do not edit those. A third builder fixes the journeys on `claude/vibrant-cori-5kst85` (`apps/web/e2e/support`, `calling.spec.ts`, `customers.spec.ts`, `targets.spec.ts`, `notifications.spec.ts`): do not edit those files. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue, `copy-lint.config.json`) are append-only.

**Migrations:** start at 0128 (L1 may also start at 0128; the lead renumbers at the merge).

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service. If a tool you need is missing, stop and report.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
