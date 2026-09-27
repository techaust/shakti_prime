-- AUDIT batch 6: database hardening before anything is hosted.

-- M1: the Supabase API roles hold nothing on application objects, now or on later ones. On a
-- hosted project the Data API is also switched off; these revokes keep the data closed if it is
-- ever switched on.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on all functions in schema app from %I', r);
      execute format('revoke usage on schema app from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
      execute format('alter default privileges in schema app revoke all on functions from %I', r);
    end if;
  end loop;
end
$$;
--> statement-breakpoint

-- M2: no session may create temporary objects, and every definer function searches pg_temp
-- last, so a temporary table can never stand in for an application table.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
end
$$;
--> statement-breakpoint
alter function app.account_unclaimed(uuid) set search_path = pg_catalog, public, app, pg_temp;
--> statement-breakpoint
alter function app.contact_unlinked(uuid) set search_path = pg_catalog, public, app, pg_temp;
--> statement-breakpoint
alter function app.ensure_account_entity() set search_path = pg_catalog, public, app, pg_temp;
--> statement-breakpoint
alter function app.next_document_no(smallint, text, text, text)
  set search_path = pg_catalog, public, app, pg_temp;
--> statement-breakpoint

-- L1: the customer scope helpers answer only for the permissions their policies use, so they are
-- not a yes/no oracle for any other permission.
create or replace function app.account_in_scope(p_account uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if p_perm not in ('crm.account.read', 'crm.account.write') then
    raise exception 'account_in_scope answers only for crm.account.read or crm.account.write'
      using errcode = 'invalid_parameter_value';
  end if;
  return exists (
    select 1 from public.account_entities ae
     where ae.account_id = p_account
       and ae.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and app.scope_ok(p_perm, ae.owner_id, ae.team_id));
end
$$;
--> statement-breakpoint
create or replace function app.contact_in_scope(p_contact uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if p_perm not in ('crm.account.read', 'crm.account.write') then
    raise exception 'contact_in_scope answers only for crm.account.read or crm.account.write'
      using errcode = 'invalid_parameter_value';
  end if;
  return exists (
    select 1 from public.account_contacts ac
     where ac.contact_id = p_contact and app.account_in_scope(ac.account_id, p_perm));
end
$$;
--> statement-breakpoint

-- L4, M18: ids written by the database follow ADR 0006 (UUIDv7), like the ones the app writes.
create or replace function app.uuid_v7() returns uuid
language sql volatile set search_path = pg_catalog, pg_temp as $$
  select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
    placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
    from 1 for 6), 52, 1), 53, 1), 'hex')::uuid
$$;
--> statement-breakpoint
revoke all on function app.uuid_v7() from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.uuid_v7() to app_user;
--> statement-breakpoint

create or replace function app.attach_account_entity(p_account uuid, p_entity smallint) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.accounts a where a.id = p_account and a.archived_at is null) then
    return false;
  end if;
  insert into public.account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
  values (app.uuid_v7(), p_account, p_entity, app.user_id(), app.team_id(), app.user_id())
  on conflict (account_id, entity_id) do nothing;
  return true;
end
$$;
--> statement-breakpoint

-- M3: a request reads its own user row; only user administrators read everyone's email, phone
-- and sign-in state. Owner names on screens come from principals.
drop policy users_read on users;
--> statement-breakpoint
create policy users_read on users for select to app_user
  using (id = (select app.user_id()) or (select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

-- M17: consent evidence is fixed once written. A writer may only record the withdrawal, and a
-- withdrawal stands.
revoke update on consents from app_user;
--> statement-breakpoint
grant update (withdrawn_at, updated_at, updated_by) on consents to app_user;
--> statement-breakpoint
create or replace function app.consent_evidence_fixed() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if (new.id, new.contact_id, new.channel, new.purpose, new.source, new.text_version,
      new.given_at, new.created_at, new.created_by)
     is distinct from
     (old.id, old.contact_id, old.channel, old.purpose, old.source, old.text_version,
      old.given_at, old.created_at, old.created_by) then
    raise exception 'consent evidence cannot be changed; record a new consent instead'
      using errcode = 'check_violation', constraint = 'consents_evidence_fixed';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a withdrawn consent stays withdrawn; record a new consent instead'
      using errcode = 'check_violation', constraint = 'consents_withdrawal_fixed';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger consents_evidence_fixed before update on consents
  for each row execute function app.consent_evidence_fixed();
--> statement-breakpoint

-- M18: price history is written by the database from the price change itself, so it cannot be
-- forged, skipped or given a stale old price. The command passes its reason through a
-- transaction-local setting.
create or replace function app.log_price_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.price is not distinct from old.price then
    return new;
  end if;
  insert into public.price_change_log (id, price_list_item_id, old_price, new_price, reason, changed_by)
  values (app.uuid_v7(), new.id, case when tg_op = 'UPDATE' then old.price end, new.price,
          nullif(current_setting('app.price_reason', true), ''),
          coalesce(app.user_id(), new.updated_by, new.created_by));
  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.log_price_change() from public, readonly_reporter;
--> statement-breakpoint
create trigger price_list_items_log_change after insert or update of price on price_list_items
  for each row execute function app.log_price_change();
--> statement-breakpoint
drop policy price_change_log_insert on price_change_log;
--> statement-breakpoint
revoke insert on price_change_log from app_user;
--> statement-breakpoint

-- M19: at most one live price list per tier and company on any day. effective_to is exclusive:
-- a list ending on 2027-04-01 prices up to and including 2027-03-31.
alter table price_lists add constraint price_lists_no_overlap
  exclude using gist (tier_id with =, (coalesce(entity_id, 0)) with =,
                      daterange(effective_from, effective_to, '[)') with &&)
  where (archived_at is null);
