---
name: add-command
description: Add a domain command (a write) to Shakti Prime BOS, from the contract to the screen. Use whenever data must change through a new action, route, worker, import or agent tool.
---

# Add a command

**Both** (cloud and PC). Every write goes through a typed domain command. The recipe, with a working example, is `AGENTS.md` §5; follow it step by step. Before calling the command done, check each line:

- [ ] Input and strict DTO in `packages/contracts`; only types imported into browser code (`apps/web/src/screens/contract-values.ts` for values).
- [ ] `defineCommand` in `packages/domain/src/commands/<module>` with the permission, `alsoRequires` if any, `auditFields` (each with an Activity log label in `apps/web/src/screens/audit.ts`), `peopleOnly` when no agent may run it, `constraintReasons` for constraints it can race against.
- [ ] `ctx.audit()` once per changed aggregate with before and after; `ctx.emit()` only for catalogue events (ids, codes and counts); state changes through `transition()` of the machine.
- [ ] Registered in `packages/domain/src/command/registry.ts`.
- [ ] Tests on real Postgres in `packages/domain/tests`: denied, wrong company, happy path.
- [ ] The agent refusal sweep (`packages/domain/tests/security/agent-refusals.test.ts`) picks commands from the registry by permission: `isRestricted()` marks the cost and other agent-forbidden permissions, every `admin.*`, `audit.*` and `integrations.*` permission, `tax.rates.write`, `pricing.write` and `catalogue.write`. A command that needs one of them fails the sweep's first test until it has a valid input in `INPUTS`; a command that needs `crm.account.write` fails the customer-write test until it has one in `CUSTOMER_INPUTS`. Add the input in the same change.
- [ ] Server action in `apps/web/src/actions` through `executeCommand()` with `signedIn()`, `commandOptions(meta, idempotencyKey)` and `toResult()`; one idempotency key per form.
- [ ] Every user-facing word in `apps/web/messages/en.json`; every error reason has its `errors.*` sentence; `pnpm copy-lint` clean.
- [ ] `pnpm lint`, `pnpm typecheck`, the unit tests and the security suite for the touched files pass; the documents the command changes say so (API, SECURITY, DATABASE as needed).
