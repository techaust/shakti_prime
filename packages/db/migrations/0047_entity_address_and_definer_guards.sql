ALTER TABLE "entities" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "pin" text;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_pin_check" CHECK ("entities"."pin" is null or "entities"."pin" ~ '^[1-9][0-9]{5}$');--> statement-breakpoint
-- The registered address of each company is entered in Admin by an Executive (workshop pack
-- SALE-2) through org.entity.update; its state is the existing state_code. The columns above stay
-- empty until the workshop answers arrive.

-- Final audit, finding 1: app.attach_account_entity() writes account_entities past that table's
-- insert policy, which needs crm.account.write. It now checks that permission as well as
-- crm.lead.write, so the definer can never do more than the direct write would. Everything else
-- is as in 0026; `create or replace` keeps its grants, which are restated below.
create or replace function app.attach_account_entity(p_account uuid, p_entity smallint) returns text
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
declare
  v_inserted int;
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.account.write:own') then
    raise exception 'permission crm.account.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.accounts a where a.id = p_account and a.archived_at is null) then
    return 'missing';
  end if;
  insert into public.account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
  values (app.uuid_v7(), p_account, p_entity, app.user_id(), app.team_id(), app.user_id())
  on conflict (account_id, entity_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return 'attached';
  end if;
  if app.account_in_scope(p_account, 'crm.account.write') then
    return 'already_yours';
  end if;
  return 'held_by_other';
end
$$;
--> statement-breakpoint
revoke all on function app.attach_account_entity(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_account_entity(uuid, smallint) to app_user;
--> statement-breakpoint

-- Finding 2: the opportunities trigger function is a definer that was never closed to everyone.
-- A trigger fires whatever the caller's grants, so nobody needs to call it directly.
revoke all on function app.ensure_account_entity() from public, readonly_reporter;
--> statement-breakpoint

-- Finding 3: the two link-policy helpers answer yes or no about rows the caller cannot see. They
-- now answer only inside a signed-in request that holds crm.account.write, which every policy
-- that calls them already requires (account_entities and account_contacts, insert and update,
-- 0018: app.scope_ok('crm.account.write', …) or app.account_in_scope(…, 'crm.account.write')).
-- Anyone else is answered "no", so neither is an oracle about another company's customers.
create or replace function app.account_unclaimed(p_account uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
  select app.user_id() is not null
     and app.has_perm('crm.account.write:own')
     and not exists (select 1 from public.account_entities ae where ae.account_id = p_account)
$$;
--> statement-breakpoint
create or replace function app.contact_unlinked(p_contact uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
  select app.user_id() is not null
     and app.has_perm('crm.account.write:own')
     and not exists (select 1 from public.account_contacts ac where ac.contact_id = p_contact)
$$;
--> statement-breakpoint
revoke all on function app.account_unclaimed(uuid), app.contact_unlinked(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.account_unclaimed(uuid), app.contact_unlinked(uuid) to app_user;
