# J4 PM Surya Ghar and subsidy gates (Phase 4, wave 2)

| | |
|---|---|
| Branch | `feat/j4-subsidy` on GitHub, from `main` after J1 and J3 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): subsidy gates on a regulated scheme, the sanctioned load locked |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase4 §7.1](../../03-roadmap-appendix/phase4.md#71-j4-pm-surya-ghar-and-subsidy-gates) as written, with question 3 (a) (portal and DISCOM steps entered by hand: no scraping, no portal API) and question 5 (a) (DCR serials are J8's; until then `material.delivered` checks the items' DCR flags). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables:**
   - `subsidy_applications`: one per PM Surya Ghar project, holding the portal application number, the consumer number, the DISCOM, `sanctioned_load_kw` (locked once `feasibility.approved`, by a guard trigger and the command), and the dates the portal shows.
   - `subsidy_gates`: one row per gate of the flow, with its state by `subsidy-gate`, the submitter, the approver, and each rejection's reason kept in `subsidy_gate_events` (append-only), so the history of rejections stays.
   - Row security through the project (`app.project_is_mine()` for `own`), `projects.read` and `projects.write`. Approving needs `projects.gate.approve`.
2. **The machines** `project-surya-ghar` and `subsidy-gate` come into use (`MACHINES_IN_USE`), one command per event. J1 drafts a PM Surya Ghar project with no steps: J4 gives it its flow when the project is drafted or opened (J1's report names the hook; follow it).
   - `qc.signoff` needs `projects.qc.signoff`. When J6 is on `main`, read its signed-off inspection. Until then, the gate is approved by the signoff permission alone, recorded as a named follow-up for J6.
   - Each gate's documents come from J3's requirements (`app.project_missing_documents()` for the gate's step): a gate is submitted only when its mandatory documents are filed.
3. **Screens:** the project page's Subsidy tab (each gate with its documents, submit, approve or reject with a reason, and the history of rejections) and `/projects/subsidy` (the gates waiting per stage, per company). Journey: a Project Manager submits a gate, a GM rejects it with a reason, it is resubmitted and approved, and the sanctioned load cannot change after feasibility. With axe and snapshots.
4. **Acceptance:** PRJ-02's criteria, each through every path (UI, `/api/v1` if any, agent refusal).

**Early check (Tier A):** once the tables, the machines' commands, the locked load and their tests are committed, write a short report and push `report: j4-subsidy early check`, then stop.

Files owned: the subsidy tables and migrations; `packages/domain/src/commands/projects/subsidy*.ts` and their queries; the Subsidy tab; `/projects/subsidy`.

Do not touch: DCR/ALMM serial checks and the loan gate on dispatch (J8); DISCOM packs (J10).

Review checklist: the sanctioned load immutable after feasibility on every path; a rejection keeps its reason in the history; no gate submitted with a missing mandatory document; approve needs `projects.gate.approve` and never by the submitter.
