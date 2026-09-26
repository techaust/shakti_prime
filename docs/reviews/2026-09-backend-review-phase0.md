# Backend review, Phase 0 weeks 1 and 2

Date: 2026-09-27. Scope: `packages/db` (schema, migrations 0000 to 0008, `withRequestContext()`, helpers), `packages/domain` (command runner, `org.entity.update`, `crm.lead.create`, `pricing.price.set`, queries, numbering) and `packages/contracts`. Reviewed against DATABASE §2 to §5, SECURITY §3 and §4, ARCHITECTURE §5, ADR 0002, 0004 and 0006, and AGENTS.md. Checks: policy completeness per table, write paths that bypass a root policy, lock and race behaviour, idempotency, error mapping, DTO leaks, indexes for the documented queries, migration safety.

## Fixed (real defects)

| # | Finding | Fix | Proof |
|---|---|---|---|
| A | Child write policies (`contact_phones`, `consents`, `account_contacts`, `customer_sites`) checked that the parent row is visible, which runs under the parent's read policy. A role whose read scope is wider than its write scope could add a phone, consent, site or contact link to a contact or account it may not update. No seeded role has that shape; a custom role from Admin could. | Migration `0010`: the write policies require the parent to be inside the caller's `crm.account.write` scope via `app.scope_ok()`. | `crm-scope.test.ts`: a caller with read at entity scope and write at own scope cannot add a phone to a colleague's contact and updates zero of their sites. |
| B | The lead list cursor carried `updated_at` at millisecond precision. Rows written in one transaction share `now()` to the microsecond, so a page boundary inside such a group skipped the rest of the group. Bulk imports (week 5) would have lost rows from every page. | The cursor carries the Postgres text form of the timestamp and compares as `timestamptz`. | `create-lead.test.ts`: three leads created in one transaction are all returned when paging one at a time. |
| C | A database error inside a handler (unique, check or foreign-key violation, RLS refusal, deadlock) surfaced as the driver's error with the SQL text in the message, not as a `DomainError` with a code and a `details.reason`. | `runCommand` translates SQLSTATE classes: unique, serialization, deadlock and lock failures → `conflict`; check, foreign-key, not-null, cast and exclusion violations → `validation_failed`; insufficient privilege → `forbidden`; anything else → `internal`. The constraint name is in `details`; the SQL is not. | `database-errors.test.ts`: duplicate tier code → `conflict` naming the constraint; bad HSN → `validation_failed`; a policy refusal → `forbidden`. |
| D | `app_user` had no statement, lock or idle-in-transaction timeout. A stuck request would hold its transaction open, and with it a `document_sequences` row lock, blocking every number in that series. | Role settings in `migrate.ts`: `statement_timeout 30s`, `lock_timeout 10s`, `idle_in_transaction_session_timeout 30s`. | `grants.test.ts` asserts the three settings on the application connection. |
| E | `opportunities` had no index leading with `(entity_id, owner_id)` or `(entity_id, team_id)`, which is what the own and team scope predicates filter on for every caller list. `contacts` and `accounts` already had the owner index. | Migration `0009` adds both. | Generated migration reviewed; no behaviour change. |

## Accepted as is (with reason)

- `app.next_document_no()` writes its series row with `gen_random_uuid()` (version 4) rather than UUIDv7. Postgres 17 has no built-in v7 generator and the id is never exposed or ordered on. Revisit when the platform moves to Postgres 18.
- `principals` is readable by any request context (id, kind, display name). Needed for `created_by` and owner joins across the product; contains no contact data.
- `ensureRoles()` re-applies the `app_user` password on every migration run. Acceptable in dev and CI; on the hosted environments the password is managed in Supabase and the statement should be conditional. Tracked for the week 3 environment setup.
- `pricing.price.set` reads then writes the price list item. Two Executives pricing the same item at the same moment now get `conflict` (fix C) instead of a raw error; a retry succeeds. No `on conflict` rewrite needed.
- Commands carry no idempotency key yet. Mobile and webhook callers can retry; `crm.lead.create` retried creates a duplicate lead. This is a design item for weeks 3 to 5 (idempotency keys on the runner, stored with the audit row), not a defect in the current slices, which are called only from tests and the server actions.
- `readonly_reporter` holds `select` on `item_costs`. It has no request context and no `BYPASSRLS`, so it reads zero rows; reporting through it will need a context helper of its own.

## Already covered by the documents and the suite

- Fail-closed policies on every table, forced RLS, no delete grant, append-only enforcement, cost gate, entity scope narrowing in `withRequestContext()`, strict DTOs, permission guard before the handler. All asserted by the suite (317 tests after this review).

## Result

All checks green after the fixes: lint, format, typecheck, unit tests, copy lint, security suite (290 db, 26 domain, 1 web), CI on `main`.
