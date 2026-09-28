-- GST rates and composite-supply splits carry no company: one row prices every company. A
-- tax.rates.write grant held in one company therefore reached all four, so only a request acting
-- for every active company may write them, the rule shared price lists follow (0019, AUDIT H2).
-- app.request_covers_group() is the definer check 0019 made for that rule. Reads are unchanged.
drop policy tax_rates_insert on tax_rates;
--> statement-breakpoint
create policy tax_rates_insert on tax_rates for insert
  with check ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy tax_rates_update on tax_rates;
--> statement-breakpoint
create policy tax_rates_update on tax_rates for update
  using ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy composite_supply_rules_insert on composite_supply_rules;
--> statement-breakpoint
create policy composite_supply_rules_insert on composite_supply_rules for insert
  with check ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy composite_supply_rules_update on composite_supply_rules;
--> statement-breakpoint
create policy composite_supply_rules_update on composite_supply_rules for update
  using ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('tax.rates.write:entity')) and (select app.request_covers_group()));
