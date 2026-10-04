# ADR 0020 — The event workers' principal `system:workers` follows an agent's customer rules

**Status:** Proposed (lead, 30-09-2026, for slice P1, migration 0064); the owner confirms or changes it with the handover slice T2 (`docs/design/phase1.md` §8.2) · **Date:** 30-09-2026 · **Deciders:** Lead developer; the owner decides at T2 · **Blueprint:** §6.2, §7.2, §9.3 · **Security:** §3.3 · **Database:** §6.2 · **ADR:** 0004, 0005, 0008

## Context
Event workers change data only through commands (ADR 0004), so they need a principal. Slice P1 seeded one, `system:workers` (principal kind `system`, `SYSTEM_MATRIX` in `packages/contracts/src/system-principal.ts`), scoped to the company of the event it handles.

The customer rules of 0055 to 0059 tell people and agents apart: a person who can read one of a customer's leads in a company reads that customer there, and a person's lead handover moves the customer relationship to the lead's new owner; an agent reads customers only through `crm.account.read` and its handover never moves the relationship (ADR 0008, SECURITY §3.3).

Those rules named only agents, so the new kind would have counted as a person. The round-robin handover of T2 will run as this principal, and whether it should move the customer like a person's handover is a business question for the owner.

## Decision
**Until the owner decides at T2, `system:workers` is held to an agent's customer rules.** Migration 0064 widens the test of a service request in three places to a role key `agent:%` or `system:%`, or a principal row of kind `agent` or `system`:

- `account_entities_read`: a service never reads a customer through a lead, only at its `crm.account.read` scope;
- `app.lead_search_ids()`: a service's lead search applies the customer read rule as well;
- `app.hand_over_customer()`: answers `unchanged` and touches nothing for a service request, so a service's handover never moves the relationship.

The principal holds only `files.process:all` for the file checks; each later worker adds only the grant its command needs, and never a cost, admin, audit, integrations or sensitive-document permission (the agent refusal sweep checks it).

## Consequences
- The safer reading stands until the owner chooses: a worker cannot widen what it sees of customers through leads, and an automated handover leaves the relationship where it is.
- If the owner decides at T2 that a round-robin handover moves the customer as a person's does, a migration narrows `app.hand_over_customer()`'s test (and, if wanted, the read rule) back to agents, and this ADR records the decision.
- The rules of slice C2 test agents only: the note rule of `activities_read` (0088), `app.customer_search_ids()` (0086, 0088) and on `main` the command guard's `peopleOnly` (`isAgent()` in `packages/domain/src/command/run-command.ts`; the sizing slice C4 widens that guard to every principal that is not a person). They do not reach `system:workers` today because it holds no `crm.*` permission; T2, which gives it one, settles them together with this decision.
