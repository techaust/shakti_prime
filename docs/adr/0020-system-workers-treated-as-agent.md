# ADR 0020 — The event workers' principal `system:workers` follows an agent's customer rules

**Status:** Decided (owner, 09-10-2026, at slice T2, applied by migration 0125). Proposed by the lead on 30-09-2026 for slice P1 (migration 0064) · **Date:** 30-09-2026 · **Deciders:** Lead developer; the owner at T2 · **Blueprint:** §6.2, §7.2, §9.3 · **Security:** §3.3 · **Database:** §6.2 · **ADR:** 0004, 0005, 0008

## Context
Event workers change data only through commands (ADR 0004), so they need a principal. Slice P1 seeded one, `system:workers` (principal kind `system`, `SYSTEM_MATRIX` in `packages/contracts/src/system-principal.ts`), scoped to the company of the event it handles.

The customer rules of 0055 to 0059 tell people and agents apart: a person who can read one of a customer's leads in a company reads that customer there, and a person's lead handover moves the customer relationship to the lead's new owner; an agent reads customers only through `crm.account.read` and its handover never moves the relationship (ADR 0008, SECURITY §3.3).

Those rules named only agents, so the new kind would have counted as a person. The round-robin handover of T2 will run as this principal, and whether it should move the customer like a person's handover is a business question for the owner.

## Decision
**Until the owner decides at T2, `system:workers` is held to an agent's customer rules.** Migration 0064 widens the test of a service request in three places to a role key `agent:%` or `system:%`, or a principal row of kind `agent` or `system`:

- `account_entities_read`: a service never reads a customer through a lead, only at its `crm.account.read` scope;
- `app.lead_search_ids()`: a service's lead search applies the customer read rule as well;
- `app.hand_over_customer()`: answers `unchanged` and touches nothing for a service request, so a service's handover never moves the relationship.

The principal holds only the grants of `SYSTEM_MATRIX` (`packages/contracts/src/system-principal.ts`), each at scope `all`: `files.process` (the file checks), `imports.process` (the import worker stops a job whose last try failed), `crm.score.refresh` (the nightly rescoring), `crm.duplicates.scan` (the nightly duplicate search) and `sales.quote.expire` (the daily quote expiry). Each later worker adds only the grant its command needs, and never a cost, admin, audit, integrations or sensitive-document permission (the agent refusal sweep checks it).

## Outcome (owner, 09-10-2026)
A round-robin handover moves the customer relationship to the lead's new owner, as a person's handover does. Migration 0125 narrows the test in `app.hand_over_customer()` to an agent (a role key `agent:%` or a principal row of kind `agent`) and lets the handover worker, which holds the platform-only `crm.handover.run`, make the move; an agent's handover still never moves it. The read rules (`account_entities_read`, `app.lead_search_ids()`) keep the widened test of 0064, so `system:workers` still reads a customer only at its `crm.account.read` scope, which it does not hold. The worker gives the lead over through narrow definers that check `crm.handover.run`, and holds no `crm.*` permission a person may hold.

## Consequences
- A worker cannot widen what it sees of customers through leads; its automated handover moves the relationship to the new owner as a person's does, and an agent's handover leaves it where it is.
- The rules of slice C2 test agents only: the note rule of `activities_read` (0088), `app.customer_search_ids()` (0086, 0088) and the command guard's `peopleOnly` (`isAgent()` in `packages/domain/src/command/run-command.ts`; `checkPerson()`, from the sizing slice C4, refuses every principal that is not a person). The rules of C2 do not reach `system:workers` because it holds no `crm.*` permission a person's role may hold: its platform-only `crm.score.refresh` and `crm.duplicates.scan` reach leads and customers only through definers that answer the facts and write the scores or candidates (DATABASE §4.1). T2 gave the worker the handover permission `crm.handover.run`, which is platform-only and not a person's, so those rules still do not reach it.
