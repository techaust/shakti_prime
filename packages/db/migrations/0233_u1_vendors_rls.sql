-- U1 Vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3, question 6 (a)): row
-- security, grants and triggers for the group's vendor master and the restricted supplier quotes.
-- One vendor list for the group: vendors, their contacts and their item links carry no company,
-- and are read by any principal holding inventory.stock.read or procurement.po.write while acting
-- in some company (a request with no company reads nothing, so every policy fails closed), and
-- written only by holders of procurement.po.write, through the procurement commands.
-- vendor_quotes holds every supplier rate (docs/05-database.md §4.3): read only with
-- procurement.rate.read, a group quote (entity_id null) acting in any company, a company's quote
-- acting in that company; recorded and withdrawn only with procurement.rate.read and
-- procurement.po.write in the quote's company, or in a request covering every company for a group
-- quote. A quote is written once: afterwards only its withdrawal changes (column grants), and only
-- while it is live. No agent principal holds procurement.po.write or procurement.rate.read.

-- 1. updated_at
create trigger set_updated_at before update on vendors
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on vendor_contacts
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on item_vendors
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on vendor_quotes
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. vendors: the group's master. The permission tests and the company test are initplans, run
--    once per query; the read rule is stated inline on each table, since none of the three has a
--    scope of its own beyond it.
alter table vendors enable row level security;
--> statement-breakpoint
alter table vendors force row level security;
--> statement-breakpoint
create policy vendors_read on vendors for select to app_user, app_reader
  using (cardinality((select app.entity_ids())) > 0
         and ((select app.has_perm('inventory.stock.read:own'))
              or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy vendors_insert on vendors for insert to app_user
  with check (cardinality((select app.entity_ids())) > 0
              and (select app.has_perm('procurement.po.write:entity'))
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy vendors_update on vendors for update to app_user
  using (cardinality((select app.entity_ids())) > 0
         and (select app.has_perm('procurement.po.write:entity')))
  with check (cardinality((select app.entity_ids())) > 0
              and (select app.has_perm('procurement.po.write:entity'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
revoke all on vendors from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on vendors to app_user;
--> statement-breakpoint
grant update (name, gstin, state_code, pan, address_json, payment_terms_days, lead_time_days,
              is_active, notes, updated_at, updated_by) on vendors to app_user;
--> statement-breakpoint
grant select on vendors to app_reader, readonly_reporter;
--> statement-breakpoint

-- 3. vendor_contacts: replaced as a set (procurement.vendor.contact.set), so inserted and deleted,
--    never updated.
alter table vendor_contacts enable row level security;
--> statement-breakpoint
alter table vendor_contacts force row level security;
--> statement-breakpoint
create policy vendor_contacts_read on vendor_contacts for select to app_user, app_reader
  using (cardinality((select app.entity_ids())) > 0
         and ((select app.has_perm('inventory.stock.read:own'))
              or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy vendor_contacts_insert on vendor_contacts for insert to app_user
  with check (cardinality((select app.entity_ids())) > 0
              and (select app.has_perm('procurement.po.write:entity'))
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy vendor_contacts_delete on vendor_contacts for delete to app_user
  using (cardinality((select app.entity_ids())) > 0
         and (select app.has_perm('procurement.po.write:entity')));
--> statement-breakpoint
revoke all on vendor_contacts from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert, delete on vendor_contacts to app_user;
--> statement-breakpoint
grant select on vendor_contacts to app_reader, readonly_reporter;
--> statement-breakpoint

-- 4. item_vendors: a link changes only its code and preferred mark, and is removed when the vendor
--    no longer supplies the item.
alter table item_vendors enable row level security;
--> statement-breakpoint
alter table item_vendors force row level security;
--> statement-breakpoint
create policy item_vendors_read on item_vendors for select to app_user, app_reader
  using (cardinality((select app.entity_ids())) > 0
         and ((select app.has_perm('inventory.stock.read:own'))
              or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy item_vendors_insert on item_vendors for insert to app_user
  with check (cardinality((select app.entity_ids())) > 0
              and (select app.has_perm('procurement.po.write:entity'))
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy item_vendors_update on item_vendors for update to app_user
  using (cardinality((select app.entity_ids())) > 0
         and (select app.has_perm('procurement.po.write:entity')))
  with check (cardinality((select app.entity_ids())) > 0
              and (select app.has_perm('procurement.po.write:entity'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
create policy item_vendors_delete on item_vendors for delete to app_user
  using (cardinality((select app.entity_ids())) > 0
         and (select app.has_perm('procurement.po.write:entity')));
--> statement-breakpoint
revoke all on item_vendors from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert, delete on item_vendors to app_user;
--> statement-breakpoint
grant update (vendor_item_code, is_preferred, updated_at, updated_by) on item_vendors to app_user;
--> statement-breakpoint
grant select on item_vendors to app_reader, readonly_reporter;
--> statement-breakpoint

-- 5. vendor_quotes: restricted to procurement.rate.read. The reporting role gets no grant at all.
alter table vendor_quotes enable row level security;
--> statement-breakpoint
alter table vendor_quotes force row level security;
--> statement-breakpoint
create policy vendor_quotes_read on vendor_quotes for select to app_user, app_reader
  using ((select app.has_perm('procurement.rate.read:entity'))
         and ((entity_id is null and cardinality((select app.entity_ids())) > 0)
              or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy vendor_quotes_insert on vendor_quotes for insert to app_user
  with check ((select app.has_perm('procurement.rate.read:entity'))
              and (select app.has_perm('procurement.po.write:entity'))
              and recorded_by = (select app.user_id())
              and withdrawn_at is null
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy vendor_quotes_withdraw on vendor_quotes for update to app_user
  using ((select app.has_perm('procurement.rate.read:entity'))
         and (select app.has_perm('procurement.po.write:entity'))
         and withdrawn_at is null
         and ((entity_id is null and (select app.request_covers_group()))
              or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('procurement.rate.read:entity'))
              and (select app.has_perm('procurement.po.write:entity'))
              and withdrawn_at is not null
              and withdrawn_by = (select app.user_id())
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
revoke all on vendor_quotes from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on vendor_quotes to app_user;
--> statement-breakpoint
grant update (withdrawn_at, withdrawn_by, updated_at) on vendor_quotes to app_user;
--> statement-breakpoint
grant select on vendor_quotes to app_reader;
