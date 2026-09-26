-- Shared customer master (ADR 0008, docs/DATABASE.md §4.2, §6.2). Contacts and accounts are one
-- record for the group; account_entities holds the relationship with each selling entity and
-- carries the owner and team that own/team/entity scope apply to. Children follow the shared
-- parent through two helpers; a trigger keeps an opportunity inside an entity the account deals
-- with, replacing the composite foreign keys of 0011.

-- helpers: security definer so the membership lookup is not itself filtered by the policies it
-- serves; the predicate inside does the scoping. Executable by the application and reporting roles.
create or replace function app.account_in_scope(p_account uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from account_entities ae
     where ae.account_id = p_account
       and ae.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and app.scope_ok(p_perm, ae.owner_id, ae.team_id))
$$;
--> statement-breakpoint
create or replace function app.contact_in_scope(p_contact uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from account_contacts ac
     where ac.contact_id = p_contact and app.account_in_scope(ac.account_id, p_perm))
$$;
--> statement-breakpoint
-- Attaches a customer the caller may not see yet to one of the caller's entities (a dedupe
-- match or a referral). Requires crm.lead.write in that entity; the new relationship is owned
-- by the caller. Answers false when the account does not exist.
create or replace function app.attach_account_entity(p_account uuid, p_entity smallint) returns boolean
language plpgsql security definer set search_path = public, app as $$
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from accounts a where a.id = p_account and a.archived_at is null) then
    return false;
  end if;
  insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
  values (gen_random_uuid(), p_account, p_entity, app.user_id(), app.team_id(), app.user_id())
  on conflict (account_id, entity_id) do nothing;
  return true;
end
$$;
--> statement-breakpoint
revoke all on function app.account_in_scope(uuid, text), app.contact_in_scope(uuid, text),
  app.attach_account_entity(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.account_in_scope(uuid, text), app.contact_in_scope(uuid, text)
  to app_user, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_account_entity(uuid, smallint) to app_user;
--> statement-breakpoint

-- an opportunity sits only in an entity its account deals with, on a site of that account
create or replace function app.ensure_account_entity() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from account_entities ae
                  where ae.account_id = new.account_id and ae.entity_id = new.entity_id) then
    raise exception 'account % has no relationship with entity %', new.account_id, new.entity_id
      using errcode = 'foreign_key_violation', constraint = 'opportunities_account_entity_check';
  end if;
  if new.site_id is not null and not exists (select 1 from customer_sites s
                  where s.id = new.site_id and s.account_id = new.account_id) then
    raise exception 'site % does not belong to account %', new.site_id, new.account_id
      using errcode = 'foreign_key_violation', constraint = 'opportunities_site_account_check';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger opportunities_account_entity before insert or update of account_id, entity_id, site_id
  on opportunities for each row execute function app.ensure_account_entity();
--> statement-breakpoint

-- account_entities: the scope root
create trigger set_updated_at before update on account_entities for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table account_entities enable row level security;
--> statement-breakpoint
alter table account_entities force row level security;
--> statement-breakpoint
create policy account_entities_read on account_entities for select
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.read', owner_id, team_id));
--> statement-breakpoint
create policy account_entities_insert on account_entities for insert
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint
create policy account_entities_update on account_entities for update
  using (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[]) and app.scope_ok('crm.account.write', owner_id, team_id));
--> statement-breakpoint
grant select, insert, update on account_entities to app_user;
--> statement-breakpoint
grant select on account_entities to readonly_reporter;
--> statement-breakpoint

-- (the old policies were dropped in 0015, before the columns they referenced)
-- accounts: visible through a relationship in scope; any customer writer may create a row,
-- which nobody sees until its relationship row exists (written in the same transaction)
create policy accounts_read on accounts for select
  using (app.account_in_scope(id, 'crm.account.read'));
--> statement-breakpoint
create policy accounts_insert on accounts for insert
  with check ((select app.has_perm('crm.account.write:own')));
--> statement-breakpoint
create policy accounts_update on accounts for update
  using (app.account_in_scope(id, 'crm.account.write'))
  with check (app.account_in_scope(id, 'crm.account.write'));
--> statement-breakpoint

-- contacts: visible through a linked account
create policy contacts_read on contacts for select
  using (app.contact_in_scope(id, 'crm.account.read'));
--> statement-breakpoint
create policy contacts_insert on contacts for insert
  with check ((select app.has_perm('crm.account.write:own')));
--> statement-breakpoint
create policy contacts_update on contacts for update
  using (app.contact_in_scope(id, 'crm.account.write'))
  with check (app.contact_in_scope(id, 'crm.account.write'));
--> statement-breakpoint

-- children of accounts
create policy account_contacts_read on account_contacts for select
  using (app.account_in_scope(account_id, 'crm.account.read'));
--> statement-breakpoint
create policy account_contacts_insert on account_contacts for insert
  with check (app.account_in_scope(account_id, 'crm.account.write'));
--> statement-breakpoint
create policy account_contacts_update on account_contacts for update
  using (app.account_in_scope(account_id, 'crm.account.write'))
  with check (app.account_in_scope(account_id, 'crm.account.write'));
--> statement-breakpoint
create policy customer_sites_read on customer_sites for select
  using (app.account_in_scope(account_id, 'crm.account.read'));
--> statement-breakpoint
create policy customer_sites_insert on customer_sites for insert
  with check (app.account_in_scope(account_id, 'crm.account.write'));
--> statement-breakpoint
create policy customer_sites_update on customer_sites for update
  using (app.account_in_scope(account_id, 'crm.account.write'))
  with check (app.account_in_scope(account_id, 'crm.account.write'));
--> statement-breakpoint

-- children of contacts
create policy contact_phones_read on contact_phones for select
  using (app.contact_in_scope(contact_id, 'crm.account.read'));
--> statement-breakpoint
create policy contact_phones_insert on contact_phones for insert
  with check (app.contact_in_scope(contact_id, 'crm.account.write'));
--> statement-breakpoint
create policy contact_phones_update on contact_phones for update
  using (app.contact_in_scope(contact_id, 'crm.account.write'))
  with check (app.contact_in_scope(contact_id, 'crm.account.write'));
--> statement-breakpoint
create policy consents_read on consents for select
  using (app.contact_in_scope(contact_id, 'crm.account.read'));
--> statement-breakpoint
create policy consents_insert on consents for insert
  with check (app.contact_in_scope(contact_id, 'crm.account.write'));
--> statement-breakpoint
create policy consents_update on consents for update
  using (app.contact_in_scope(contact_id, 'crm.account.write'))
  with check (app.contact_in_scope(contact_id, 'crm.account.write'));
