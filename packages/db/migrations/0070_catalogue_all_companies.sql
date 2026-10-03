-- Products are shared by every company (the owner's decision of 29-09-2026): a change to the
-- catalogue (items, pump curves, kits and their components) is written only by a request that acts
-- for every active company, as GST rates (0048) and group price lists (0019) are. A
-- `catalogue.write` grant held in one company does not reach the others. Reads are unchanged.
drop policy items_insert on items;
--> statement-breakpoint
create policy items_insert on items for insert
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy items_update on items;
--> statement-breakpoint
create policy items_update on items for update
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy pump_curves_insert on pump_curves;
--> statement-breakpoint
create policy pump_curves_insert on pump_curves for insert
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy pump_curves_update on pump_curves;
--> statement-breakpoint
create policy pump_curves_update on pump_curves for update
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy kits_insert on kits;
--> statement-breakpoint
create policy kits_insert on kits for insert
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy kits_update on kits;
--> statement-breakpoint
create policy kits_update on kits for update
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy kit_components_insert on kit_components;
--> statement-breakpoint
create policy kit_components_insert on kit_components for insert
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy kit_components_update on kit_components;
--> statement-breakpoint
create policy kit_components_update on kit_components for update
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()))
  with check ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy kit_components_delete on kit_components;
--> statement-breakpoint
create policy kit_components_delete on kit_components for delete to app_user
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy pump_curves_delete on pump_curves;
--> statement-breakpoint
create policy pump_curves_delete on pump_curves for delete to app_user
  using ((select app.has_perm('catalogue.write:entity')) and (select app.request_covers_group()));
