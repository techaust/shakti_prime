-- The Phase 0 final fix wave (the final adversarial audit of 62c62f6).
--
-- 1. app.reset_two_factor() asked only for admin.users.write:all, so an administrator acting for
--    one company removed the authenticator app of a person who also works in another, round the
--    rule the admin commands and the users and sessions policies follow (0056). It now asks the
--    same question: the person holds no role outside the request's companies.
create or replace function app.reset_two_factor(p_user uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_enabled boolean;
begin
  if v_actor is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  if p_user = v_actor then
    raise exception 'a user cannot reset their own authenticator app' using errcode = '42501';
  end if;
  if app.user_roles_outside_request(p_user) <> '{}'::smallint[] then
    raise exception 'the user also works in a company outside the request' using errcode = '42501';
  end if;
  select two_factor_enabled into v_enabled from public.users where id = p_user for update;
  if not found then
    return false;
  end if;
  delete from public.user_two_factor where user_id = p_user;
  update public.users
     set two_factor_enabled = false, updated_at = pg_catalog.now(), updated_by = v_actor
   where id = p_user;
  return v_enabled;
end
$$;
--> statement-breakpoint
revoke execute on function app.reset_two_factor(uuid) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.reset_two_factor(uuid) to app_user;
--> statement-breakpoint

-- 2. A person with no role rows answered '{}' (no company outside the request), so an
--    administrator of any one company could change them and sign them out. Such a person now
--    counts as working in every active company the request leaves out, so only an administrator
--    acting for the whole group (the rule of app.request_covers_group(), 0019) changes them. The
--    users and sessions policies keep the caller's own row apart (0056). It still answers
--    company ids only, and only to a caller holding admin.users.write:all.
create or replace function app.user_roles_outside_request(p_user uuid) returns smallint[]
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_request int[] := coalesce(app.entity_ids(), '{}'::int[]);
begin
  if app.user_id() is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_entity_roles uer where uer.user_id = p_user) then
    return coalesce(
      (select pg_catalog.array_agg(e.id order by e.id)
         from public.entities e
        where e.archived_at is null and not (e.id = any (v_request))),
      '{}'::smallint[]);
  end if;
  return coalesce(
    (select pg_catalog.array_agg(distinct uer.entity_id order by uer.entity_id)
       from public.user_entity_roles uer
      where uer.user_id = p_user
        and not (uer.entity_id = any (v_request))),
    '{}'::smallint[]);
end
$$;
--> statement-breakpoint
revoke execute on function app.user_roles_outside_request(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_roles_outside_request(uuid) to app_user;
--> statement-breakpoint

-- 3. readonly_reporter holds select on user_entity_roles (0014), but 0049's read policy names
--    app_user only, so reporting read nothing and said nothing. It now reads under the same rule
--    as the application (DATABASE §3: select only, RLS applies): the request's companies and its
--    own rows, and nothing without a context.
drop policy user_entity_roles_read on user_entity_roles;
--> statement-breakpoint
create policy user_entity_roles_read on user_entity_roles for select to app_user, readonly_reporter
  using (entity_id = any ((select app.entity_ids())::int[]) or user_id = (select app.user_id()));
--> statement-breakpoint

-- 4. An agent's lead handover wrote the customer master: agent:triage holds crm.lead.assign and no
--    crm.account permission, and SECURITY §3.3 forbids agent writes to customers. For an agent
--    request (the two markers of 0057: an agent role key, or a principal of kind agent) the
--    handover answers `unchanged` and touches nothing; the lead still moves, and a staff owner
--    reads its customer through the lead (0057).
create or replace function app.hand_over_customer(p_opportunity uuid, p_previous_owner uuid)
  returns table (status text, relationship_id uuid, previous_team_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_account uuid;
  v_entity smallint;
  v_owner uuid;
  v_team uuid;
  v_relationship uuid;
  v_held_by uuid;
  v_held_team uuid;
begin
  if v_actor is null or not app.has_perm('crm.lead.assign:own') then
    raise exception 'permission crm.lead.assign:own required' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
     or exists (select 1 from public.principals p where p.id = v_actor and p.kind = 'agent') then
    return query select 'unchanged'::text, null::uuid, null::uuid;
    return;
  end if;
  -- The lead as it now stands, only when the caller may write it (opportunities_update).
  select o.account_id, o.entity_id, o.owner_id, o.team_id
    into v_account, v_entity, v_owner, v_team
    from public.opportunities o
   where o.id = p_opportunity
     and o.archived_at is null
     and o.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and app.scope_ok('crm.lead.write', o.owner_id, o.team_id);
  if not found then
    raise exception 'opportunity % is outside the caller''s write scope', p_opportunity
      using errcode = '42501';
  end if;
  select ae.id, ae.owner_id, ae.team_id
    into v_relationship, v_held_by, v_held_team
    from public.account_entities ae
   where ae.account_id = v_account and ae.entity_id = v_entity
     for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_held_by is not distinct from v_owner then
    return query select 'unchanged'::text, v_relationship, null::uuid;
    return;
  end if;
  if v_held_by is distinct from p_previous_owner
     or not app.scope_ok('crm.lead.write', v_held_by, v_held_team) then
    return query select 'held_by_other'::text, v_relationship, null::uuid;
    return;
  end if;
  update public.account_entities
     set owner_id = v_owner, team_id = v_team, updated_at = pg_catalog.now(), updated_by = v_actor
   where id = v_relationship;
  return query select 'moved'::text, v_relationship, v_held_team;
end
$$;
--> statement-breakpoint
revoke execute on function app.hand_over_customer(uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.hand_over_customer(uuid, uuid) to app_user;
--> statement-breakpoint

-- 5. A person reads a customer through one of its leads (0057), but no longer through an archived
--    one: a lead taken off the books (an import rolled back) gives no reason to read the
--    customer. Lost and won leads are not archived and keep it. app.lead_search_ids() needs no
--    change: it keeps only leads that are not archived, and for a person the customer of such a
--    lead is readable through it.
drop policy account_entities_read on account_entities;
--> statement-breakpoint
create policy account_entities_read on account_entities for select using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.account.read:entity'))
    or ((select app.has_perm('crm.account.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.account.read:own')) and owner_id = (select app.user_id()))
    or ((select coalesce(current_setting('app.role', true), '') not like 'agent:%'
               and not exists (select 1 from principals p
                                where p.id = app.user_id() and p.kind = 'agent'))
        and exists (select 1 from opportunities o
                     where o.account_id = account_entities.account_id
                       and o.entity_id = account_entities.entity_id
                       and o.archived_at is null))));
--> statement-breakpoint

-- 6. app.attach_account_entity() searched pg_catalog, public, app and pg_temp (0057); it now pins
--    an empty search path and names everything it uses (AUDIT M2).
create or replace function app.attach_account_entity(p_account uuid, p_entity smallint) returns text
language plpgsql security definer set search_path = '' as $$
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
  if exists (select 1 from public.account_entities ae
              where ae.account_id = p_account and ae.entity_id = p_entity
                and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)) then
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

-- 7. A dead letter changed when app.dlq_replay named it, but any role may set that setting and
--    outbox_publisher may update the delivery columns, so the publisher connection could revive a
--    dead letter by itself. The reset must now also run as the owner of app.replay_dead_letter(),
--    which a statement does only inside that definer (no request role owns it). The owner is read
--    from the catalogue, which every role may read, since the publisher may not use schema app.
--    The trigger also pins an empty search path.
create or replace function app.outbox_delivery_only() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('app.outbox_retention', true) = 'purge'
       and old.published_at is not null
       and old.dead_lettered_at is null
       and old.published_at < pg_catalog.now() - interval '30 days' then
      return old;
    end if;
    raise exception 'outbox_events is append-only' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.sequence, new.entity_id, new.type, new.aggregate_type, new.aggregate_id,
      new.payload_json, new.created_at)
     is distinct from
     (old.id, old.sequence, old.entity_id, old.type, old.aggregate_type, old.aggregate_id,
      old.payload_json, old.created_at) then
    raise exception 'only the delivery columns of outbox_events may change'
      using errcode = 'insufficient_privilege';
  end if;
  if old.dead_lettered_at is not null
     and (new.published_at, new.attempts, new.last_error, new.dead_lettered_at,
          new.next_attempt_at, new.claimed_until)
         is distinct from
         (old.published_at, old.attempts, old.last_error, old.dead_lettered_at,
          old.next_attempt_at, old.claimed_until) then
    if new.dead_lettered_at is null and new.attempts = 0 and new.last_error is null
       and new.published_at is null and new.next_attempt_at is null and new.claimed_until is null
       and pg_catalog.current_setting('app.dlq_replay', true) = old.id::text
       and current_user = (select pg_catalog.pg_get_userbyid(p.proowner)
                             from pg_catalog.pg_proc p
                             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname = 'replay_dead_letter') then
      return new;
    end if;
    raise exception 'a dead-lettered event changes only by a replay'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint

-- 8. The retention purge recorded a failure, raised a warning and returned, so pg_cron reported
--    the run as a success. It is now a procedure: it records the run and commits, purges, and on
--    a failure records the error, commits that, and raises, so the run stays recorded and pg_cron
--    reports it failed. A procedure that commits may not pin a search path, so every name and
--    operator is qualified; it is run only by pg_cron and the migrator as the table owner, never
--    by a request role.
drop routine if exists app.purge_outbox_events();
--> statement-breakpoint
create procedure app.purge_outbox_events()
language plpgsql as $$
declare
  v_run uuid := app.uuid_v7();
  v_removed int := 0;
  v_error text;
begin
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'outbox-events-purge', pg_catalog.clock_timestamp());
  commit;
  begin
    perform pg_catalog.set_config('app.outbox_retention', 'purge', true);
    delete from public.outbox_events
     where published_at operator(pg_catalog.<)
             (pg_catalog.now() operator(pg_catalog.-) interval '30 days')
       and dead_lettered_at is null;
    get diagnostics v_removed = row_count;
    perform pg_catalog.set_config('app.outbox_retention', '', true);
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is not null then
    update public.retention_runs
       set finished_at = pg_catalog.clock_timestamp(), error = pg_catalog.left(v_error, 500)
     where id = v_run;
    commit;
    raise exception 'outbox-events-purge failed: %', v_error;
  end if;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(), rows_affected = v_removed
   where id = v_run;
end
$$;
--> statement-breakpoint
revoke execute on procedure app.purge_outbox_events() from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select cron.schedule('outbox-events-purge', '45 2 * * *', 'call app.purge_outbox_events()');
--> statement-breakpoint

-- 9. Leads go only to people who can work. app_user reads no other person's users row (M3, 0024),
--    so the assign command and the list of people a lead may go to ask this helper. It answers
--    yes only for an active user who holds a role in a company of the request, to a caller who may
--    hand out leads, and nothing else about anyone.
create or replace function app.user_is_active(p_user uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.lead.assign:own') then
    raise exception 'permission crm.lead.assign:own required' using errcode = '42501';
  end if;
  return exists (
    select 1
      from public.users u
     where u.id = p_user
       and u.status = 'active'
       and exists (select 1 from public.user_entity_roles uer
                    where uer.user_id = u.id
                      and uer.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))));
end
$$;
--> statement-breakpoint
revoke execute on function app.user_is_active(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_is_active(uuid) to app_user;
--> statement-breakpoint

-- 10. The import commit counts its batches on the job (0058), a count the commit writes as it
--     writes the others.
grant update (batch_count) on import_jobs to app_user;
