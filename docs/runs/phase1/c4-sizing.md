# C4 Sizing (wave 2)

| | |
|---|---|
| Branch | `feat/c4-sizing-r2` on GitHub (c670631, from `main` at #82) |
| PC worktree | `c4-sizing`, slot 8: Postgres 54338, app 3038; its local branch `feat/c4-sizing` is at the same commit and pushes to `feat/c4-sizing-r2` (`git push origin HEAD:feat/c4-sizing-r2`) |
| Runs on | integration list: cloud or PC; merge with `main` and integration: PC |
| State | built, reviewed, review fixes done |
| Next step | take `main` (C1 and C2 are on it), renumber, then the integration list below through a builder |

## Brief
Design: [`docs/design/phase1.md` §6.7](../../design/phase1.md#67-c4-sizing) and §11 (workshop defaults); BLUEPRINT §8.3 (quote validations) and §3 ("LLMs never do this math"); PRD SAL-04; the quote machine's guards `sizingComplete`, `pumpCurveInBounds`, `dcrRuleMet` (`packages/domain/src/state-machines/machines/quote.ts`); the workshop pack; ADR 0007 for the pure-function style. Skills: `supabase-postgres-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`. The owner decided on 30-09-2026 that only people record the sizing a quote relies on; agents may only suggest one ([ADR 0021](../../adr/0021-people-record-sizing.md)).

1. **Pure calculators** in `packages/domain/src/sizing/` (no framework imports; SI units inside, inputs in the units field staff use), each tested with fixture tables, boundary cases and property tests (`fast-check`), with two worked examples per calculator in the test comments: `totalDynamicHead`, `pumpPower`, `solarArrayForPump`, `rooftopSize`, `pumpDutyPoint`, `dcrRule`, `sanctionedLoadRule`. Every result carries `inBounds` and `reasons` (codes) so the quote guard can refuse and say why.
2. **Engineering defaults** under `sizing` in `packages/domain/src/workshop-defaults.ts`, each named with its source and flagged for the client's engineering head to confirm; each in the exit-gate actions and design §11. Never presented as client facts.
3. **Table `sizings`**, a child of a lead (`entity_id`, `opportunity_id` with the composite key, `site_id`, `kind` pump or rooftop, `inputs_json`, `result_json`, `in_bounds`, `reasons_json`, `engine_version`, `item_id` for a pump sized against its curve): RLS as a child of `opportunities`, append-only (the latest row is the one a quote uses), indexed for the latest sizing of a lead, fixture rows per company and a matrix rule.
4. **Command `crm.sizing.record`** (`crm.lead.write`): runs the calculators on the inputs (never trusting results from the client), stores inputs, result, bounds and engine version, audits and emits `crm.sizing.recorded`. Query `latestSizing(opportunityId)`.
5. **Sizing panel** (`apps/web/src/components/sizing/`): pump and rooftop tabs, inputs with units, each part of the head, the standard HP, the duty point against a chosen pump's curve, bounds and reasons in plain words; keyboard-first; loaded on first use.
6. **Documents:** DATABASE §6.2, ARCHITECTURE §5, design §6.7 "Built (C4)", `pnpm db:docs`.

## Report
### 03-10-2026, builder on the PC
- Built, reviewed and fixed. The review confirmed the formulas and found 2 high (the pump's flow short of the need; the suction lift of a surface pump) and 4 medium; all fixed. Engine version 2; `quoteSizingFacts()` for S1; people-only, voice sessions included; six engineering defaults added for the engineering head (flow tolerance, overshoot, suction lift 7 m, sanctioned-load ratio 1.0, motor margin 0.1, pipe velocity 2 m/s).
- Checks on the branch: security suite 1,343, unit tests 2,394.

## Review
Every finding is fixed on the branch; what needs C1 and C2 on `main` is in the integration notes.

## Integration notes
1. **Take `main`:** the branch's 0065 and 0066 clash with P2's on `main`; renumber after `main`'s last ([slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice)).
2. **Drop the branch's `PumpTypeSchema`** (`packages/contracts/src/crm/sizing.ts`) and use C1's in `packages/contracts/src/catalogue/specs.ts`.
3. **The sizing panel in Account 360** (the lead section of `/customers/[accountId]`).
4. **An out-of-bounds sizing creates a `review` task** for the team lead through C2's tasks, with a test.
5. **The timeline row:** `ctx.activity()` with type `sizing_recorded`.
6. Then integrate and make the baselines on the PC.
