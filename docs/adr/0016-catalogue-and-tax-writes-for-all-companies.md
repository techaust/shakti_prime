# ADR 0016 — Catalogue, tax and group-wide price writes only in a request for every company

**Status:** Accepted (owner, 29-09-2026, for the catalogue); the same rule covers GST rates (migration 0048) and group price lists (the audit ([2026-09-audit](../reviews/2026-09-audit.md)) H2) · **Date:** 29-09-2026 · **Deciders:** Owner · **Blueprint:** §6.1, §7.2, §8.3 · **Database:** §4.1, §6.3 · **Security:** §3.2 · **ADR:** 0002, 0008

## Context
Some rows belong to no single company: the catalogue (`items`, `kits`, `kit_components`, `pump_curves`), the GST rates and composite-supply splits (`tax_rates`, `composite_supply_rules`) and the group-wide price lists (`price_lists.entity_id` null and their `price_list_items`). One such row decides what all four companies sell, charge or quote.

A permission is granted per company (`user_entity_roles`), so a `catalogue.write`, `tax.rates.write` or `pricing.write` grant held in one company would, on a shared row, change what the other three do. A person whose request is narrowed to one company by the company switcher should not be able to do that either, even when they hold the grant everywhere.

## Decision
**A shared row is written only by a request that acts for every active company, and by a caller holding the grant there.**

- `app.request_covers_group()` (migration 0019, a `security definer` with an empty search path) answers whether the request's companies include every active company. It is a definer because row-level security hides the companies outside the request from `app_user`; it answers only yes or no and is one of the documented definers that check no permission (DATABASE §4.1).
- The write policies of the shared tables add `(select app.request_covers_group())`: group price lists and their items (0019), `tax_rates` and `composite_supply_rules` (0048), and `items`, `kits`, `kit_components` and `pump_curves` (0070). Reads are unchanged.
- The catalogue commands check the same rule before writing (`assertCatalogueGroupScope()` in `packages/domain/src/commands/catalogue/shared.ts`) and refuse with `forbidden`, reason `catalogue_needs_all_companies`, so the screen says why rather than failing on a policy.
- `app_reader` may call the function (0072), so the catalogue and GST screens, which read on the reader pool, can say before a change is tried that it needs All companies.
- The role editor follows the same rule for `role_permissions` and `roles` (0073), since a role's grants reach every company, and a tag for the whole group is made or archived only in such a request (0080).

## Consequences
- A General Manager or Inventory Manager who holds `catalogue.write` in one company reads the catalogue there and changes it only from All companies, holding the grant in every company (SECURITY §3.2).
- A change to what the group sells or charges is made once, in one place, by someone entitled in every company; there is no per-company copy of an item or a rate to drift.
- Company-specific price lists (`price_lists.entity_id` set) keep the ordinary company rule.
- When a company is added, a request covers the group only once it includes that company too, so the caller needs a role there before changing a shared row.
