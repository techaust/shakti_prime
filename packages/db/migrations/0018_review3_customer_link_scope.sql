-- Review 3 (2026-09-26, docs/reviews/2026-09-review3-audit.md). A direct insert into the two link
-- tables of the shared customer master could widen the caller's scope: a row in account_entities
-- for any account id made that account, its contacts and their phones visible, and a row in
-- account_contacts could link a customer of another entity to the caller's own account. Both
-- links now require the caller to see the other side already, except for a first link on a row
-- nobody holds yet (the create-lead path). Every other attach goes through
-- app.attach_account_entity(), which checks the permission the design names.

-- helpers: security definer so they see rows the caller cannot; they answer a yes/no only
create or replace function app.account_unclaimed(p_account uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select not exists (select 1 from account_entities ae where ae.account_id = p_account)
$$;
--> statement-breakpoint
create or replace function app.contact_unlinked(p_contact uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select not exists (select 1 from account_contacts ac where ac.contact_id = p_contact)
$$;
--> statement-breakpoint
revoke all on function app.account_unclaimed(uuid), app.contact_unlinked(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.account_unclaimed(uuid), app.contact_unlinked(uuid) to app_user;
--> statement-breakpoint

-- account_entities: a relationship may be written for a new account, or for one the caller sees
drop policy account_entities_insert on account_entities;
--> statement-breakpoint
create policy account_entities_insert on account_entities for insert
  with check (entity_id = any ((select app.entity_ids())::int[])
    and app.scope_ok('crm.account.write', owner_id, team_id)
    and (app.account_unclaimed(account_id) or app.account_in_scope(account_id, 'crm.account.read')));
--> statement-breakpoint
drop policy account_entities_update on account_entities;
--> statement-breakpoint
create policy account_entities_update on account_entities for update
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
    and app.scope_ok('crm.account.write', owner_id, team_id)
    and (app.account_unclaimed(account_id) or app.account_in_scope(account_id, 'crm.account.read')));
--> statement-breakpoint

-- account_contacts: a contact may be linked when it is new, or when the caller may write it
drop policy account_contacts_insert on account_contacts;
--> statement-breakpoint
create policy account_contacts_insert on account_contacts for insert
  with check (app.account_in_scope(account_id, 'crm.account.write')
    and (app.contact_unlinked(contact_id) or app.contact_in_scope(contact_id, 'crm.account.write')));
--> statement-breakpoint
drop policy account_contacts_update on account_contacts;
--> statement-breakpoint
create policy account_contacts_update on account_contacts for update
  using (app.account_in_scope(account_id, 'crm.account.write'))
  with check (app.account_in_scope(account_id, 'crm.account.write')
    and (app.contact_unlinked(contact_id) or app.contact_in_scope(contact_id, 'crm.account.write')));
--> statement-breakpoint

-- users: the admin commands change profile and status only; sign-in state (email, verification,
-- the authenticator flag, last login) belongs to the auth module (docs/DATABASE.md §3)
revoke update on users from app_user;
--> statement-breakpoint
grant update (name, phone, locale, theme, status, image, updated_at, updated_by) on users to app_user;
--> statement-breakpoint

-- user_grants: a role in an archived entity no longer resolves
create or replace function app.user_grants(p_user uuid)
returns table (
  status text, locale text, theme text, name text, email text, two_factor_enabled boolean,
  entity_id smallint, entity_name text, role_key text, team_id uuid, permission_key text, scope text
)
language sql stable security definer set search_path = public, app as $$
  select u.status, u.locale, u.theme, u.name, u.email, u.two_factor_enabled,
         uer.entity_id, e.brand_name, r.key, uer.team_id, rp.permission_key, rp.scope
    from users u
    left join user_entity_roles uer
      on uer.user_id = u.id
     and exists (select 1 from entities x where x.id = uer.entity_id and x.archived_at is null)
    left join entities e on e.id = uer.entity_id
    left join roles r on r.id = uer.role_id and r.archived_at is null
    left join role_permissions rp on rp.role_id = r.id
   where u.id = p_user
$$;
