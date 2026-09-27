# ADR 0004 — Domain command layer as the single mutation path

**Status:** Accepted · **Date:** 2026-09-26 · **Blueprint:** §3, §6.1, §7.2, §9.3 · **Architecture:** §4, §5 · **Agents:** §5

## Context
Data is changed from many surfaces: web server actions, `/api/v1` for the field app, the Tally connector, provider webhooks, the import framework, six AI agents and the voice agent. Prices come only from Price Master tiers, tax only from the tax engine, state changes only from state machines, and every mutation must be permission-checked, entity-scoped and audited. If each surface wrote to the database itself, these rules would be re-implemented and eventually bypassed.

## Decision
Every mutation is a **typed domain command** in `packages/domain`, and nothing else writes to the database.

- `defineCommand({ name, permission, input, output, handler })`: input and output are Zod schemas from `packages/contracts`; `permission` is declared, not checked inline; the handler receives `ctx = { principal, entityIds, activeEntityId, tx, emit, now, requestId }` and never opens its own connection.
- The **command runner** resolves the principal's permissions and scope (own / team / entity / all), runs the permission guard, executes the handler inside the `withRequestContext()` transaction, writes `audit_logs` (actor, before/after, IP, device, request ID) for every mutating command, and returns only the declared DTO.
- State transitions go through `packages/domain/state-machines`; commands call `transition(machine, record, event, ctx)` and never set a status column directly.
- Prices, tax, sizing, availability and credit checks are pure functions in `packages/domain`; UI and agents never do this arithmetic.
- Side effects are events appended to `outbox_events` through `ctx.emit()` in the same transaction (ADR 0005).
- The registry of commands is the complete list of what the system can do. Server actions, route handlers, agent tools, the voice agent and the import committer call commands by name. An ESLint rule forbids importing the raw database client outside `packages/db`; `packages/domain` receives the transaction through the command context.
- Cost fields appear only in DTOs of commands whose permission is `finance.cost.read` or `procurement.rate.read`; no agent principal holds either.

## Consequences
- One place to test permission denied, wrong entity and the happy path for every business action; agents and UI cannot diverge from the rules.
- Adding a feature follows one order: contract → command and tests → RLS test if a table is new → server action or route → UI.
- Reads for pages also run through `withRequestContext()` via typed query functions, so RLS applies to reads and writes alike.
- Commands are the natural unit for idempotency (field-app sync, connector batches) and for the audit trail.
- The layer adds indirection for trivial edits; the trade is accepted because the rules it protects (no discounts, no cost leaks, no side doors) are the product's core guarantees.
