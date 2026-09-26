-- RLS, triggers, integrity constraints and grants for the catalogue, pricing, tax and numbering
-- tables (docs/DATABASE.md §4, §5, §6.3; ADR 0002, ADR 0006).
-- Shared masters (items, pump_curves, kits, kit_components, price_tiers, tax_rates,
-- composite_supply_rules) are readable with any context. Price lists need pricing.read and, when
-- they belong to one entity, that entity in scope; their items and the change log follow the list.
-- item_costs is the first cost-gated table: entity scope plus finance.cost.read.
-- document_sequences is written only by app.next_document_no().

-- updated_at triggers
create trigger set_updated_at before update on items for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on pump_curves for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on item_costs for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on kits for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on kit_components for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on price_tiers for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on price_lists for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on price_list_items for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on tax_rates for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on composite_supply_rules for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on document_sequences for each row execute function app.set_updated_at();
--> statement-breakpoint

-- effective-date integrity: one rate per HSN, item or segment at any date (SAL-02)
alter table tax_rates add constraint tax_rates_hsn_period_excl
  exclude using gist (hsn with =, daterange(effective_from, effective_to, '[)') with &&)
  where (hsn is not null);
--> statement-breakpoint
alter table tax_rates add constraint tax_rates_item_period_excl
  exclude using gist (item_id with =, daterange(effective_from, effective_to, '[)') with &&)
  where (item_id is not null);
--> statement-breakpoint
alter table composite_supply_rules add constraint composite_supply_rules_period_excl
  exclude using gist (segment with =, daterange(effective_from, effective_to, '[)') with &&);
--> statement-breakpoint

-- append-only price history (docs/DATABASE.md §5)
create trigger price_change_log_append_only before update or delete on price_change_log
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- shared catalogue masters
alter table items enable row level security;
--> statement-breakpoint
alter table items force row level security;
--> statement-breakpoint
create policy items_read on items for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy items_insert on items for insert with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
create policy items_update on items for update
  using ((select app.has_perm('catalogue.write:entity')))
  with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint

alter table pump_curves enable row level security;
--> statement-breakpoint
alter table pump_curves force row level security;
--> statement-breakpoint
create policy pump_curves_read on pump_curves for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy pump_curves_insert on pump_curves for insert with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
create policy pump_curves_update on pump_curves for update
  using ((select app.has_perm('catalogue.write:entity')))
  with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint

alter table kits enable row level security;
--> statement-breakpoint
alter table kits force row level security;
--> statement-breakpoint
create policy kits_read on kits for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy kits_insert on kits for insert with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
create policy kits_update on kits for update
  using ((select app.has_perm('catalogue.write:entity')))
  with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint

alter table kit_components enable row level security;
--> statement-breakpoint
alter table kit_components force row level security;
--> statement-breakpoint
create policy kit_components_read on kit_components for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy kit_components_insert on kit_components for insert with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
create policy kit_components_update on kit_components for update
  using ((select app.has_perm('catalogue.write:entity')))
  with check ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint

-- price tiers (shared, Executive-only edits)
alter table price_tiers enable row level security;
--> statement-breakpoint
alter table price_tiers force row level security;
--> statement-breakpoint
create policy price_tiers_read on price_tiers for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy price_tiers_insert on price_tiers for insert with check ((select app.has_perm('pricing.write:entity')));
--> statement-breakpoint
create policy price_tiers_update on price_tiers for update
  using ((select app.has_perm('pricing.write:entity')))
  with check ((select app.has_perm('pricing.write:entity')));
--> statement-breakpoint

-- price lists: pricing.read, shared or in the caller's entity scope
alter table price_lists enable row level security;
--> statement-breakpoint
alter table price_lists force row level security;
--> statement-breakpoint
create policy price_lists_read on price_lists for select
  using ((select app.has_perm('pricing.read:entity'))
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy price_lists_insert on price_lists for insert
  with check ((select app.has_perm('pricing.write:entity'))
              and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy price_lists_update on price_lists for update
  using ((select app.has_perm('pricing.write:entity'))
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('pricing.write:entity'))
              and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint

-- price list items follow their list (the EXISTS runs under the list's own policies)
alter table price_list_items enable row level security;
--> statement-breakpoint
alter table price_list_items force row level security;
--> statement-breakpoint
create policy price_list_items_read on price_list_items for select
  using ((select app.has_perm('pricing.read:entity'))
         and exists (select 1 from price_lists l where l.id = price_list_items.price_list_id));
--> statement-breakpoint
create policy price_list_items_insert on price_list_items for insert
  with check ((select app.has_perm('pricing.write:entity'))
              and exists (select 1 from price_lists l where l.id = price_list_items.price_list_id));
--> statement-breakpoint
create policy price_list_items_update on price_list_items for update
  using ((select app.has_perm('pricing.write:entity'))
         and exists (select 1 from price_lists l where l.id = price_list_items.price_list_id))
  with check ((select app.has_perm('pricing.write:entity'))
              and exists (select 1 from price_lists l where l.id = price_list_items.price_list_id));
--> statement-breakpoint

-- price change log: readable with the list, insert-only, always signed by the caller
alter table price_change_log enable row level security;
--> statement-breakpoint
alter table price_change_log force row level security;
--> statement-breakpoint
create policy price_change_log_read on price_change_log for select
  using ((select app.has_perm('pricing.read:entity'))
         and exists (select 1 from price_list_items i where i.id = price_change_log.price_list_item_id));
--> statement-breakpoint
create policy price_change_log_insert on price_change_log for insert
  with check ((select app.has_perm('pricing.write:entity'))
              and changed_by = (select app.user_id())
              and exists (select 1 from price_list_items i where i.id = price_change_log.price_list_item_id));
--> statement-breakpoint

-- tax tables (shared, maintained by Accounts)
alter table tax_rates enable row level security;
--> statement-breakpoint
alter table tax_rates force row level security;
--> statement-breakpoint
create policy tax_rates_read on tax_rates for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy tax_rates_insert on tax_rates for insert with check ((select app.has_perm('tax.rates.write:entity')));
--> statement-breakpoint
create policy tax_rates_update on tax_rates for update
  using ((select app.has_perm('tax.rates.write:entity')))
  with check ((select app.has_perm('tax.rates.write:entity')));
--> statement-breakpoint

alter table composite_supply_rules enable row level security;
--> statement-breakpoint
alter table composite_supply_rules force row level security;
--> statement-breakpoint
create policy composite_supply_rules_read on composite_supply_rules for select using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy composite_supply_rules_insert on composite_supply_rules for insert with check ((select app.has_perm('tax.rates.write:entity')));
--> statement-breakpoint
create policy composite_supply_rules_update on composite_supply_rules for update
  using ((select app.has_perm('tax.rates.write:entity')))
  with check ((select app.has_perm('tax.rates.write:entity')));
--> statement-breakpoint

-- item_costs: restricted (docs/DATABASE.md §4.2 cost_gate template)
alter table item_costs enable row level security;
--> statement-breakpoint
alter table item_costs force row level security;
--> statement-breakpoint
create policy cost_gate on item_costs for select
  using (entity_id = any ((select app.entity_ids())::int[]) and (select app.has_perm('finance.cost.read:entity')));
--> statement-breakpoint
create policy item_costs_insert on item_costs for insert
  with check (entity_id = any ((select app.entity_ids())::int[]) and (select app.has_perm('finance.cost.read:entity')));
--> statement-breakpoint
create policy item_costs_update on item_costs for update
  using (entity_id = any ((select app.entity_ids())::int[]) and (select app.has_perm('finance.cost.read:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[]) and (select app.has_perm('finance.cost.read:entity')));
--> statement-breakpoint

-- document_sequences: readable in scope; written only through app.next_document_no()
alter table document_sequences enable row level security;
--> statement-breakpoint
alter table document_sequences force row level security;
--> statement-breakpoint
create policy document_sequences_read on document_sequences for select
  using (entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint

-- grants (delete is never granted to app_user)
grant select, insert, update on items, pump_curves, kits, kit_components, price_tiers, price_lists,
  price_list_items, tax_rates, composite_supply_rules, item_costs to app_user;
--> statement-breakpoint
grant select, insert on price_change_log to app_user;
--> statement-breakpoint
grant select on document_sequences to app_user;
--> statement-breakpoint
grant select on items, pump_curves, kits, kit_components, price_tiers, price_lists, price_list_items,
  price_change_log, tax_rates, composite_supply_rules, item_costs, document_sequences to readonly_reporter;
