# AI0 Agent runtime and Inbox (wave 3)

| | |
|---|---|
| Branch | `feat/ai0-agent-runtime` on GitHub, from `main` at #99 |
| PC worktree | `ai0-agent-runtime`, slot 12: Postgres 54342, app 3042 (`bash tools/integration/setup-worktree.sh ai0-agent-runtime feat/ai0-agent-runtime 54342 3042`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026) |
| State | brief |
| Next step | a builder starts |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.1](../../design/phase1.md#71-ai0-agent-runtime-and-inbox), §4 and §12
- BLUEPRINT §9.3 (agent autopilot) and §7.8 (AI threat model)
- PRD AI-04 (Phase 1 part: the runtime and the Agent Inbox; Triage in shadow is A1's)
- SECURITY §3.2 (`agents.inbox.act`, `agents.autonomy.write`, `agents.killswitch` are in the catalogue already), §3.3 (agent principals) and §6 (AI security)
- ADR 0020 (agents and `system:workers` under the customer rules)
- The masking helpers in `packages/domain/src/privacy`; the event workers and `system:workers` (`apps/web/src/workers/events`); P1's Redis and observability
- Skills: `add-command`, `add-table`, `claude-api` (model ids, the SDK, prompt caching), `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Provider wrapper** in `packages/domain/src/ai`, with no framework imports:
   - every call names its agent and purpose, and the text is masked before it leaves (`packages/domain/src/privacy`);
   - a timeout, bounded retries, a circuit breaker in Redis, and a per-agent daily spend cap in paise, checked before the call and recorded after;
   - Claude through `@anthropic-ai/sdk` (already a dependency of `packages/domain`), Haiku 4.5 (`claude-haiku-4-5-20251001`) by default; Voyage embeddings through `fetch`;
   - a fake transport for tests.
   - No key is set on any environment yet: without `ANTHROPIC_API_KEY` (or `VOYAGE_API_KEY`) the wrapper answers `integration_unavailable` and nothing calls out. Add the variables to `turbo.json`, `.env.example` and DEPLOY as optional; a hosted runtime must not refuse to start without them.
2. **Tables**, each with RLS, forced and failing closed, in its `*_TABLES` list, with fixture rows, matrix rules and `app_reader` grants (AGENTS §6):
   - `agent_configs` (`agent`, `action_type`, `autonomy` suggest / needs approval / automatic, `daily_spend_cap_paise`, `enabled`, `entity_id` null for all): kill switches global, per agent and per company, resolved most specific first;
   - `agent_runs` (one per invocation: agent, purpose, model, tokens, cost in paise, outcome, duration, request id; no prompt or response text holding personal data);
   - `agent_actions`, append-only except its decision columns, which only the inbox command changes;
   - `agent_evals`;
   - `inbox_items` (`kind`, `assignee_id`, `team_id`, `subject_type`, `subject_id`, `state`), holding agent suggestions and routed work.
3. **Commands:**
   - `agents.inbox.approve`, `.edit` and `.reject`, with `agents.inbox.act` and `peopleOnly`. Approving runs the suggested command as the person who approves, through `ctx.run()` and under that person's permissions, never the agent's.
   - `agents.config.set` (`agents.autonomy.write`) and `agents.killswitch.set` (`agents.killswitch`), both `peopleOnly`.
   - Denied, wrong-company and happy-path tests for each; the agent refusal sweep.
4. **The runtime's own path:** a helper an agent worker uses to record a run and either propose an action (an inbox item), or act when its config says automatic and no switch is off. Test it with the fake transport and a stand-in agent defined in the test only. No real agent ships in AI0: Triage is A1's.
5. **Screens:**
   - The Agent Inbox in the top bar (a count) and at `/inbox` (`agents.inbox.act`): approve, edit or reject, keyboard-first.
   - `/admin/agents` (`agents.autonomy.write`, `agents.killswitch`): autonomy per agent and action type, spend caps, kill switches.
   - Both are menu pages with `screenAccess()`, copy in `en.json`, journeys with axe, and the JavaScript budget.
6. **Documents:** DATABASE (the tables), SECURITY §3.3 and §6, ARCHITECTURE (the AI layer as built), API if a route is added, design §7.1 "Built (AI0)", `pnpm db:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a stand-in agent's suggestion goes through the Inbox end to end in a journey (proposed, approved, and the approved command run as the approver), with the kill switch refusing it when off.

Not in AI0: real agents (A1, Phase 2), the vault (K1), voice (Phase 2), any client data or prompt wording the client must give.

## Report
None yet.

## Review
None yet.

## Integration notes
1. Hosted keys wait on the owner (STATUS, Waiting on the owner): until `ANTHROPIC_API_KEY` is set, hosted agents answer unavailable.
