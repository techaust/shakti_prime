# ADR 0008 — One customer record for the group, with a relationship per selling entity

**Status:** Accepted (client, 27-09-2026) · **Date:** 27-09-2026 · **Deciders:** Client · **Blueprint:** §1, §6.1, §6.2, §16 · **Database:** §4.2, §6.2 · **PRD:** CRM-03, CRM-04 · **Architecture:** §1

## Context
The four companies share one team and, often, the same customers: a farmer buys a pump from Shakti Motor Pumps and a solar kit from Agro Solar Hub; a dealer trades with two brands. Week 1 built contacts, accounts, sites and consents with an `entity_id` each and bound an opportunity to an account of the same entity, so such a customer was two records with two histories, and PRD CRM-04 ("one account can hold several opportunities across entities") could not be met. The client chose one shared customer record over per-entity copies linked by phone match.

## Decision
- `contacts` and `accounts` carry no entity and no owner. `contact_phones`, `consents`, `account_contacts` and `customer_sites` carry no entity either.
- A new table `account_entities(account_id, entity_id, owner_id, team_id, first_seen_at)` records the relationship of an account with one selling entity and who owns it there. It is the scope root for `crm.account.*`: own, team and entity scope apply to the relationship row, through `app.account_in_scope(account_id, perm)`; contacts follow the accounts they are linked to through `app.contact_in_scope(contact_id, perm)`.
- Opportunities, quotes, orders and every other transaction keep their `entity_id`. A trigger, `app.ensure_account_entity()`, refuses an opportunity whose entity has no relationship with its account, and a site of another account; it replaces the composite foreign keys of review finding I for the customer tables.
- A customer is attached to a further entity through `app.attach_account_entity(account_id, entity_id)`, a security-definer function that requires `crm.lead.write` in that entity and writes the relationship owned by the caller. `crm.lead.create` uses it when given `existingAccountId`; the Phase 1 dedupe card and the Triage agent will offer the match.
- Any customer writer may insert an account or contact row; nobody sees it until its relationship or link exists, which the commands write in the same transaction.

## Consequences
- One name, one phone list, one set of sites and consents per customer; the Account 360 page (CRM-07) reads one record across entities.
- The entity boundary holds: staff see a customer only in an entity they hold a role in, through the relationship at their scope or through one of the customer's leads in that entity that they can read (0057); an agent principal sees a customer only through `crm.account.read`. Two entities' staff can hold different owners for the same customer, and the relationship moves with a lead handed over by its holder (0055).
- Imports of accounts create one relationship per row's entity; a repeated customer across entity files becomes one record with several relationships (week 5).
- Reads on the customer tables cost one membership lookup per row, served by the `(entity_id, owner_id)` and `(entity_id, team_id)` indexes on `account_entities`.
- Every CRM policy pattern in DATABASE §4.2 gains a "shared master" variant; catalogue, pricing and identity tables are unaffected.
