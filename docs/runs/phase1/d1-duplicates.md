# D1 Duplicates (wave 3)

| | |
|---|---|
| Branch | `feat/d1-duplicates` on GitHub, from `main` when the slice starts |
| PC worktree | `d1-duplicates`, slot 14: Postgres 54344, app 3044 (`bash tools/integration/setup-worktree.sh d1-duplicates feat/d1-duplicates 54344 3044`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026) |
| State | built; awaiting review |
| Next step | the slice reviewer reviews the branch; the lead session then takes `main` (P2b is merged there) and renumbers the migrations |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.4](../../design/phase1.md#74-d1-duplicates), §3 (D1 owns `crm.lead.create`, `crm.opportunity.stage.move` and the board in wave 3) and §12
- PRD CRM-03 (a matching phone suggests a link or merge with a confidence score; a repeat enquiry with the same intent within 30 days attaches to the open opportunity)
- ADR 0008 (customers shared through `account_entities`)
- SECURITY §3.2 (`crm.lead.merge`), §3.3 (`agent:triage` holds `crm.lead.merge:entity`, suggest only), §4 (the colleague's-customer rule, `customer_held_by_colleague`)
- DECISIONS 28-09-2026 (imports take no number lock; the duplicate cards catch the rare second customer) and 05-10-2026 (a customers import links a row to the existing customer it can see)
- C2's lead creation and Account 360; C3's attribution and scoring in `crm.lead.create`; P2b's imports (on its branch until it merges; do not depend on unmerged code)
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Table `duplicate_candidates`:** `entity_id`, the two leads or the two customers, `reason` (phone, or name and village), `confidence`, `state`, `decided_by`, `decided_at`. RLS as the leads' and customers' scope (customers through `account_entities`), fixture rows, matrix rules, `app_reader`, the testing lists.
2. **Finding candidates:**
   - when a lead is made, inside `crm.lead.create`;
   - by a nightly pass as `system:workers`, with a platform-only permission like `crm.score.refresh` on `main`, never a `crm.*` grant (ADR 0020). It includes two customers made at the same moment by an import and a form.
   - The confidence is a pure, tested function in `packages/domain` with its reasons.
   - The nightly schedule goes in `apps/web/scripts/qstash-schedule.ts` and DEPLOY §2 step 6. Give each schedule id an environment suffix (`<id>-${BOS_ENVIRONMENT}`): one QStash account serves dev and staging, so a fixed id would overwrite the other environment's schedule. Apply the same suffix to the existing `outbox-publish` and `lead-rescore` ids, with a note in DEPLOY.
3. **Repeat enquiries:** `crm.lead.create` answers `attached` when the same customer has an open lead of the same segment with activity in the last 30 days. It adds an activity to that lead instead of making a new one. The attribution and score rules of C3 still apply.
4. **Merges:**
   - `crm.customer.merge` and `crm.customer.unmerge`, with `customer_merges` keeping everything the merge moved: contacts, sites, relationships, leads, consents, tasks, tags and activities. Audited and reversible.
   - `crm.lead.merge`.
   - All `peopleOnly`, except that an agent may only suggest (a candidate), as SECURITY §3.3 says.
   - A merge never crosses into a customer the caller cannot see. It respects the colleague's-customer rule.
5. **Screens:**
   - duplicate cards on the lead and on Account 360;
   - `/duplicates`, the list for a team lead and above: keyset, with `EXPLAIN` under RLS;
   - the merge dialog, showing what moves, and undo.
   - Journeys with axe, copy in `en.json`, the JavaScript budget.
6. **Documents:** DATABASE, SECURITY (the platform-only permission, the merge rules), API (the nightly worker), DEPLOY (the schedule ids per environment), design §7.4 "Built (D1)", `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch; a journey finds a duplicate made by a form beside an existing customer, merges it and undoes the merge; and a repeat enquiry within 30 days attaches.

Not in D1: fuzzy name matching beyond name and village (the ⌘K search work of M1 and G1); any threshold the client must give. The 30 days is PRD CRM-03's own figure.

## Report
None yet.

## Review
None yet.

## Integration notes
1. P2b's imports (the customers kind, `account_link`) merge before or after D1. Whichever is second makes the nightly pass cover the other's import rows.
