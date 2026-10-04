# C3 Pipelines, scoring and referrals (wave 2)

| | |
|---|---|
| Branch | `feat/c3-pipelines-r2` on GitHub (3856caf, from `main` at #82) |
| PC worktree | `c3-pipelines`, slot 7: Postgres 54337, app 3037; its local branch `feat/c3-pipelines-scoring` is at the same commit and pushes to `feat/c3-pipelines-r2` (`git push origin HEAD:feat/c3-pipelines-r2`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026); later the integration list may run in the cloud |
| State | integrating |
| Next step | the lead's integration run and baselines |

## Brief
Design: [`docs/design/phase1.md` §6.6](../../design/phase1.md#66-c3-pipelines-scoring-and-referrals), §4 (the permission `crm.config.write`) and §11 (workshop defaults); BLUEPRINT §8.1 and §8.2; PRD CRM-01, CRM-05, CRM-06, CRM-09, TEL-01; DESIGN.md §6 and §11; workshop pack CRM-1, CRM-2, CRM-3, CRM-5, CALL-1, CALL-3, CALL-4; SECURITY §3.2. Skills: `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

Lead creation belonged to C2 in wave 2: C3 put what lead creation must do for it (the referral code's partner, the score and its reasons) in `packages/domain/src/commands/crm/lead-attribution.ts` as `applyLeadAttribution(ctx, { opportunityId, entityId, input })`, tested on its own, and extended `CreateLeadInput` only with the optional `referralCode`.

1. **Permission `crm.config.write`** (Executive at `all`, nobody else): contracts, seed, SECURITY §3.2, the permission-matrix oracle, the agent refusal sweep.
2. **Pipelines and stages** at `/settings/pipelines`: `crm.pipeline.update` (name, lock hours 1 to 720, `first_contact_sla_minutes`, null for none), `crm.stage.create`, `.update` (name, exit rules), `.reorder`, `.archive` (never a stage with open leads or the first open stage); exit rules from a fixed list of lead fields in `packages/contracts/src/crm`, stored as `{ requiredFields }`. Seeds keep code-owned columns only; an Executive's edits survive a re-seed.
3. **Call outcomes** `call_dispositions` (group or company, all segments or one, `key` 1 to 9, `code`, `label`, `next_action`, `position`, `archived_at`) with RLS, `crm.disposition.set` (a scope's list replaced as a set) and an editor. The workshop pack's CALL-1 list is the group's default, flagged in `workshop-defaults.ts` and the exit-gate actions.
4. **Scoring** (CRM-06): `lead_score_rules` with RLS like the outcomes; the pure `scoreLead(lead, rules, now)` in `packages/domain/src/crm/score.ts` (base 50, clamped 0 to 100, reasons); `opportunities.score_reasons_json`, `score_changed_at`, `score_changed_by`; `crm.lead.rescore` and `crm.score_rule.set`; the Score column on the leads grid, sorted on the server; property tests. Workshop default: no rules, every lead at 50 (CRM-3).
5. **Referral partners** (CRM-09): `referral_partners` (a `referral_partner` customer, a case-insensitive `code` of 4 to 12 letters and digits, `is_active`), `opportunities.referral_partner_id`, `commission_rules` (empty until the workshop answers CRM-5); `crm.referral_partner.set`, `crm.commission_rule.set`. A referral code resolves to its partner, or the lead is refused with a plain reason. Accruals are S2's.
6. **Walk-in form** `/leads/walk-in` (Store Manager and anyone with `crm.lead.write`): name, mobile, village or PIN, interest, consent with its text version, optional referral code; source `walk_in`; keyboard-first, under 30 seconds for a practised user; through `crm.lead.create` and its number check.
7. **Workshop defaults** in `packages/domain/src/workshop-defaults.ts`, each in the exit-gate actions and design §11.
8. **Documents:** DATABASE §6.2, SECURITY §3.2, design §6.6 "Built (C3)", `pnpm db:docs`.

## Report
### 03-10-2026, builder on the PC
- Built, reviewed (2 high: the referral box unwired, the Qualified stage archivable; 8 medium) and fixed, then taken onto `main` at #82 with its migrations as 0065 and 0066, journeys and Linux baselines for the pipelines settings and the walk-in form. Security suite 1,355 on the branch.
- The record of what is built is the design's "Built (C3)" paragraph on the branch.

## Review
The findings were fixed on the branch, except those that need C2's lead creation on `main`; they are the integration notes below (H1, M1, M2, M4, M5, L1).

## Integration notes
1. **Take `main`:** the branch's 0065 and 0066 clash with P2's on `main`; renumber after `main`'s last ([slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice)).
2. **Wire attribution and scoring** (H1, M4): `applyLeadAttribution()` and `scoreLeads()` called from `crm.lead.create` and from the import batch (`packages/domain/src/imports/commit-leads.ts`), each with its audit.
3. **`REFERRAL_CODE_BOX` true**, so the lead form and the walk-in form show the referral code box.
4. **The rescore worker** (M1, M2).
5. **The partner-code and commission screens** (M5).
6. **`FOR SHARE` on the target stage** in `crm.opportunity.stage.move` (L1).
7. Then integrate and make the baselines on the PC.
