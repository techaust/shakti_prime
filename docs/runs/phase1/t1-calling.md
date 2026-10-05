# T1 Cold Caller workspace (wave 3)

| | |
|---|---|
| Branch | `feat/t1-calling` on GitHub, from `main` at cbec38fc (#105) |
| PC worktree | `t1-calling`, slot 15: Postgres 54345, app 3045 (`bash tools/integration/setup-worktree.sh t1-calling feat/t1-calling 54345 3045`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026) |
| State | building |
| Next step | the builder's report, then the review |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.2](../../design/phase1.md#72-t1-cold-caller-workspace), §3 (T1 needs P1, C2 and C3; D1 owns `crm.lead.create`, `crm.opportunity.stage.move` and the board in wave 3), §4 (`calls.log`), §11 (workshop defaults) and §12
- PRD TEL-01 (Phase 1: manual call logging and the number shown to dial; click-to-dial is Phase 2), CRM-06 (the score), CRM-10 (consent)
- BLUEPRINT §8.1 and §8.2; SECURITY §3.2 (`calls.log`, `calls.dial`), the telecom section (TRAI hours 9 AM to 9 PM, DND, consent) and §11; ADR 0014 (Hinglish only in caller scripts)
- DESIGN.md §6 and §11; workshop pack CALL-1 to CALL-5
- C2's Account 360, tasks and consent; C3's call outcomes (`call_dispositions` with `next_action`), pipelines and stages with exit rules, scores and the first-contact SLA; `packages/domain/src/telecom/dial-policy.ts` (`withinCallingHours`, `nextCallingWindowStart`, `checkDial`)
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Table `calls`:** `entity_id`, `opportunity_id`, `caller_id`, `direction`, `number_series` (`manual` beside `140`, `160` and `inbound`; every Phase 1 call is `manual`, dialled by hand on a phone outside the system), `disposition_id`, `attempt_no`, `started_at`, `duration_s`. Append-only. RLS as the leads' scope (own, team, entity), fixture rows, matrix rules, `app_reader`, the testing lists, `NARROWER` and `enum-sync` where they apply.
2. **`calls.log`** (people only; the matrix in design §4): records the call, its timeline activity and its next action from the outcome's `next_action`:
   - a callback: a task at the time the caller picks, inside calling hours;
   - a retry, by the owner's default of 05-10-2026 (CALL-3, `WORKSHOP_DEFAULTS.calling`): three attempts in all, on the day of the first call, the next day and day 3, each due at the start of that day's calling hours (`nextCallingWindowStart`); after the third unanswered attempt the lead moves to nurture;
   - nurture, by the owner's default of 05-10-2026 (CALL-5): call tasks on day 7, 30 and 90 after the lead enters nurture, then none (WhatsApp follow-up is Phase 2);
   - qualified: the stage move that asks for the handover (through the existing stage-move command and its exit rules; the handover itself is T2's);
   - lost, with its reason.
   - A customer who withdrew consent is marked in the queue and cannot be logged as called; a log outside calling hours is refused with a plain reason.
   - The defaults go in `packages/domain/src/workshop-defaults.ts`, the workshop pack's CALL-3 and CALL-5 "Today" lines, design §11 and the exit-gate actions, each named as a default the sales head confirms.
3. **Queue `listCallQueue`:** the caller's open leads in their pipeline's first stages, ordered by due callbacks, then SLA breach, then score, then age; keyset paging; `EXPLAIN (ANALYZE)` under RLS at a realistic size (a spike like the others, numbers in the report).
4. **`/calling`:** keyboard-first: `N` next lead, `1` to `9` the outcomes, `D` shows the number to dial (only inside calling hours; the policy's plain sentence otherwise), `/` search.
   - The script card for the lead's segment and the customer's language. There are no scripts yet (CALL-2, the client's): the card says so in plain words and shows no sample, placeholder or made-up script.
   - The stage's exit-rule checklist and the lead's recent activity.
   - A team lead's view of the team's queues.
   - Journeys with axe, copy in `en.json` (English on screen), the JavaScript budget with a named budget for `/calling`.
5. **Documents:** DATABASE (`calls`), SECURITY (`calls.log`), API if a route is added, design §7.2 "Built (T1)", DECISIONS rows for the two defaults (owner, 05-10-2026), `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a journey has a tele-caller work the queue by keyboard, log an unanswered call (its retry task appears), a callback, and a qualified lead (it moves stage), and a team lead see the team's queues.

## Report

## Review

## Integration notes
