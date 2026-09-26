-- RLS, triggers and grants for the CRM core (docs/DATABASE.md §4, §6.2; ADR 0002).
-- Roots (accounts, contacts, opportunities) carry owner_id/team_id and use app.scope_ok().
-- Children (contact_phones, consents, account_contacts, customer_sites) are visible when their
-- parent row is visible: the EXISTS runs under the parent's own policies.
-- Shared reference tables (teams, lead_sources, pipelines, pipeline_stages) are readable with any
-- context; rows with an entity_id are limited to the caller's scope.

-- updated_at triggers
create trigger set_updated_at before update on teams for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on lead_sources for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on pipelines for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on pipeline_stages for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on contacts for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on contact_phones for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on accounts for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on account_contacts for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on customer_sites for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on opportunities for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on consents for each row execute function app.set_updated_at();
--> statement-breakpoint

-- shared reference tables
alter table teams enable row level security;
--> statement-breakpoint
alter table teams force row level security;
--> statement-breakpoint
create policy teams_read on teams for select
  using ((select app.user_id()) is not null and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy teams_insert on teams for insert
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy teams_update on teams for update
  using ((select app.has_perm('admin.users.write:all')))
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

alter table lead_sources enable row level security;
--> statement-breakpoint
alter table lead_sources force row level security;
--> statement-breakpoint
create policy lead_sources_read on lead_sources for select
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy lead_sources_insert on lead_sources for insert
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint
create policy lead_sources_update on lead_sources for update
  using ((select app.has_perm('admin.entities.write:all')))
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint

alter table pipelines enable row level security;
--> statement-breakpoint
alter table pipelines force row level security;
--> statement-breakpoint
create policy pipelines_read on pipelines for select
  using ((select app.user_id()) is not null and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy pipelines_insert on pipelines for insert
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint
create policy pipelines_update on pipelines for update
  using ((select app.has_perm('admin.entities.write:all')))
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint

alter table pipeline_stages enable row level security;
--> statement-breakpoint
alter table pipeline_stages force row level security;
--> statement-breakpoint
create policy pipeline_stages_read on pipeline_stages for select
  using ((select app.user_id()) is not null and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy pipeline_stages_insert on pipeline_stages for insert
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint
create policy pipeline_stages_update on pipeline_stages for update
  using ((select app.has_perm('admin.entities.write:all')))
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint

-- contacts (root, crm.account.*)
alter table contacts enable row level security;
--> statement-breakpoint
alter table contacts force row level security;
--> statement-breakpoint
create policy contacts_read on contacts for select
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.read', owner_id, team_id));
--> statement-breakpoint
create policy contacts_insert on contacts for insert
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint
create policy contacts_update on contacts for update
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint

-- contact_phones (child of contacts)
alter table contact_phones enable row level security;
--> statement-breakpoint
alter table contact_phones force row level security;
--> statement-breakpoint
create policy contact_phones_read on contact_phones for select
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from contacts c where c.id = contact_phones.contact_id));
--> statement-breakpoint
create policy contact_phones_insert on contact_phones for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from contacts c where c.id = contact_phones.contact_id));
--> statement-breakpoint
create policy contact_phones_update on contact_phones for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('crm.account.write:own'))
         and exists (select 1 from contacts c where c.id = contact_phones.contact_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from contacts c where c.id = contact_phones.contact_id));
--> statement-breakpoint

-- consents (child of contacts; never deleted, withdrawal is an update)
alter table consents enable row level security;
--> statement-breakpoint
alter table consents force row level security;
--> statement-breakpoint
create policy consents_read on consents for select
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from contacts c where c.id = consents.contact_id));
--> statement-breakpoint
create policy consents_insert on consents for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from contacts c where c.id = consents.contact_id));
--> statement-breakpoint
create policy consents_update on consents for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('crm.account.write:own'))
         and exists (select 1 from contacts c where c.id = consents.contact_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from contacts c where c.id = consents.contact_id));
--> statement-breakpoint

-- accounts (root, crm.account.*)
alter table accounts enable row level security;
--> statement-breakpoint
alter table accounts force row level security;
--> statement-breakpoint
create policy accounts_read on accounts for select
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.read', owner_id, team_id));
--> statement-breakpoint
create policy accounts_insert on accounts for insert
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint
create policy accounts_update on accounts for update
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint

-- account_contacts (child of accounts)
alter table account_contacts enable row level security;
--> statement-breakpoint
alter table account_contacts force row level security;
--> statement-breakpoint
create policy account_contacts_read on account_contacts for select
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from accounts a where a.id = account_contacts.account_id));
--> statement-breakpoint
create policy account_contacts_insert on account_contacts for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from accounts a where a.id = account_contacts.account_id));
--> statement-breakpoint
create policy account_contacts_update on account_contacts for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('crm.account.write:own'))
         and exists (select 1 from accounts a where a.id = account_contacts.account_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from accounts a where a.id = account_contacts.account_id));
--> statement-breakpoint

-- customer_sites (child of accounts)
alter table customer_sites enable row level security;
--> statement-breakpoint
alter table customer_sites force row level security;
--> statement-breakpoint
create policy customer_sites_read on customer_sites for select
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from accounts a where a.id = customer_sites.account_id));
--> statement-breakpoint
create policy customer_sites_insert on customer_sites for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from accounts a where a.id = customer_sites.account_id));
--> statement-breakpoint
create policy customer_sites_update on customer_sites for update
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('crm.account.write:own'))
         and exists (select 1 from accounts a where a.id = customer_sites.account_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('crm.account.write:own'))
              and exists (select 1 from accounts a where a.id = customer_sites.account_id));
--> statement-breakpoint

-- opportunities (root, crm.lead.*)
alter table opportunities enable row level security;
--> statement-breakpoint
alter table opportunities force row level security;
--> statement-breakpoint
create policy opportunities_read on opportunities for select
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.lead.read', owner_id, team_id));
--> statement-breakpoint
create policy opportunities_insert on opportunities for insert
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.lead.write', owner_id, team_id));
--> statement-breakpoint
create policy opportunities_update on opportunities for update
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.lead.write', owner_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.lead.write', owner_id, team_id));
--> statement-breakpoint

-- grants
grant select, insert, update on teams, lead_sources, pipelines, pipeline_stages, contacts, contact_phones,
  accounts, account_contacts, customer_sites, opportunities, consents to app_user;
--> statement-breakpoint
revoke delete on teams, lead_sources, pipelines, pipeline_stages, contacts, contact_phones,
  accounts, account_contacts, customer_sites, opportunities, consents from app_user;
--> statement-breakpoint
grant select on teams, lead_sources, pipelines, pipeline_stages, contacts, contact_phones,
  accounts, account_contacts, customer_sites, opportunities, consents to readonly_reporter;
