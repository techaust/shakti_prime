-- Review fix (docs/reviews/2026-09-backend-review-phase0.md, finding A).
-- The child write policies of 0005 checked that the parent row is *visible*, which runs under
-- the parent's SELECT policy, so a caller whose read scope is wider than their write scope could
-- add a phone, consent, site or contact link to a contact or account they may not update. The
-- seeded matrix has no such role today; custom roles from Admin could. Writes now require the
-- parent to be within the caller's crm.account.write scope.

drop policy contact_phones_insert on contact_phones;
--> statement-breakpoint
drop policy contact_phones_update on contact_phones;
--> statement-breakpoint
create policy contact_phones_insert on contact_phones for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from contacts c where c.id = contact_phones.contact_id
                          and app.scope_ok('crm.account.write', c.owner_id, c.team_id)));
--> statement-breakpoint
create policy contact_phones_update on contact_phones for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from contacts c where c.id = contact_phones.contact_id
                     and app.scope_ok('crm.account.write', c.owner_id, c.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from contacts c where c.id = contact_phones.contact_id
                          and app.scope_ok('crm.account.write', c.owner_id, c.team_id)));
--> statement-breakpoint

drop policy consents_insert on consents;
--> statement-breakpoint
drop policy consents_update on consents;
--> statement-breakpoint
create policy consents_insert on consents for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from contacts c where c.id = consents.contact_id
                          and app.scope_ok('crm.account.write', c.owner_id, c.team_id)));
--> statement-breakpoint
create policy consents_update on consents for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from contacts c where c.id = consents.contact_id
                     and app.scope_ok('crm.account.write', c.owner_id, c.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from contacts c where c.id = consents.contact_id
                          and app.scope_ok('crm.account.write', c.owner_id, c.team_id)));
--> statement-breakpoint

drop policy account_contacts_insert on account_contacts;
--> statement-breakpoint
drop policy account_contacts_update on account_contacts;
--> statement-breakpoint
create policy account_contacts_insert on account_contacts for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from accounts a where a.id = account_contacts.account_id
                          and app.scope_ok('crm.account.write', a.owner_id, a.team_id)));
--> statement-breakpoint
create policy account_contacts_update on account_contacts for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from accounts a where a.id = account_contacts.account_id
                     and app.scope_ok('crm.account.write', a.owner_id, a.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from accounts a where a.id = account_contacts.account_id
                          and app.scope_ok('crm.account.write', a.owner_id, a.team_id)));
--> statement-breakpoint

drop policy customer_sites_insert on customer_sites;
--> statement-breakpoint
drop policy customer_sites_update on customer_sites;
--> statement-breakpoint
create policy customer_sites_insert on customer_sites for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from accounts a where a.id = customer_sites.account_id
                          and app.scope_ok('crm.account.write', a.owner_id, a.team_id)));
--> statement-breakpoint
create policy customer_sites_update on customer_sites for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from accounts a where a.id = customer_sites.account_id
                     and app.scope_ok('crm.account.write', a.owner_id, a.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and exists (select 1 from accounts a where a.id = customer_sites.account_id
                          and app.scope_ok('crm.account.write', a.owner_id, a.team_id)));
