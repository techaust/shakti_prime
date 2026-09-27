-- AUDIT M32: the customer tables' read policies become plain correlated EXISTS subqueries on
-- account_entities (and account_contacts for contacts), which that table's own policy filters.
-- The old form called a security-definer helper per row, which the planner could neither see
-- into nor use an index for, so a name search tested every customer in the group. An EXISTS
-- lets it probe the (account_id, entity_id) key for a short list of ids and hash for a broad
-- search. What a caller may read is unchanged: account_entities applies the same entity and
-- own/team/entity scope the helpers did. The write policies keep the helpers, which must see
-- past visibility. Measured on 50,000 customers (batch 10 pull request).
drop policy accounts_read on accounts;
--> statement-breakpoint
create policy accounts_read on accounts for select
  using (exists (select 1 from account_entities ae where ae.account_id = accounts.id));
--> statement-breakpoint
drop policy account_contacts_read on account_contacts;
--> statement-breakpoint
create policy account_contacts_read on account_contacts for select
  using (exists (select 1 from account_entities ae where ae.account_id = account_contacts.account_id));
--> statement-breakpoint
drop policy customer_sites_read on customer_sites;
--> statement-breakpoint
create policy customer_sites_read on customer_sites for select
  using (exists (select 1 from account_entities ae where ae.account_id = customer_sites.account_id));
--> statement-breakpoint
drop policy contacts_read on contacts;
--> statement-breakpoint
create policy contacts_read on contacts for select
  using (exists (select 1 from account_contacts ac where ac.contact_id = contacts.id));
--> statement-breakpoint
drop policy contact_phones_read on contact_phones;
--> statement-breakpoint
create policy contact_phones_read on contact_phones for select
  using (exists (select 1 from account_contacts ac where ac.contact_id = contact_phones.contact_id));
--> statement-breakpoint
drop policy consents_read on consents;
--> statement-breakpoint
create policy consents_read on consents for select
  using (exists (select 1 from account_contacts ac where ac.contact_id = consents.contact_id));
--> statement-breakpoint

-- AUDIT M33: the two scope roots state app.scope_ok() inline, each permission test wrapped in a
-- subselect so it runs once per query (an initplan) instead of once per row. The rows a caller
-- reads are the same: the widest scope held, own and team matched only when set.
drop policy account_entities_read on account_entities;
--> statement-breakpoint
create policy account_entities_read on account_entities for select using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.account.read:entity'))
    or ((select app.has_perm('crm.account.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.account.read:own')) and owner_id = (select app.user_id()))));
--> statement-breakpoint
drop policy opportunities_read on opportunities;
--> statement-breakpoint
create policy opportunities_read on opportunities for select using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.lead.read:entity'))
    or ((select app.has_perm('crm.lead.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.lead.read:own')) and owner_id = (select app.user_id()))));
