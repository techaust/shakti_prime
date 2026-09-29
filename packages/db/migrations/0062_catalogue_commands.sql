-- Catalogue and price-list commands (docs/design/phase1.md §6.1, docs/DATABASE.md §6.3).
--
-- 1. One live list per tier and company on any day, among approved lists only. A draft
--    (`approved_by` null) prices nothing, so drafts for the same tier may overlap each other and
--    the live list; `pricing.list.approve` ends the list it replaces where the draft starts.
alter table price_lists drop constraint price_lists_no_overlap;
--> statement-breakpoint
alter table price_lists add constraint price_lists_no_overlap
  exclude using gist (tier_id with =, (coalesce(entity_id, 0)) with =,
                      daterange(effective_from, effective_to, '[)') with &&)
  where (archived_at is null and approved_by is not null);
--> statement-breakpoint

-- 2. A kit's components and a pump's curve are replaced as a set by `catalogue.kit.update` and
--    `catalogue.pump_curve.set`, so they alone among the catalogue tables take a delete, with the
--    same permission as their other writes. The audit trail keeps the set that was replaced.
create policy kit_components_delete on kit_components for delete to app_user
  using ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
create policy pump_curves_delete on pump_curves for delete to app_user
  using ((select app.has_perm('catalogue.write:entity')));
--> statement-breakpoint
grant delete on kit_components, pump_curves to app_user;
