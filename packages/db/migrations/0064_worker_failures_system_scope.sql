-- Phase 1, slice P1, after review.
--
-- 1. A worker that fails after QStash's last retry, or refuses an event for good, is reported by
--    QStash's failure callback (`POST /api/v1/workers/outbox/failed`), which, as
--    outbox_publisher, turns the event back into a dead letter: `published_at` cleared,
--    `dead_lettered_at` set, `last_error` `worker_failed` or `worker_refused`, nothing else
--    changed. The trigger allows a delivered event to become undelivered only in exactly that way
--    and only to that role; every other rule of 0059 stands.
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
  if old.published_at is not null and new.published_at is null then
    if current_user = 'outbox_publisher'
       and old.dead_lettered_at is null
       and new.dead_lettered_at is not null
       and new.last_error in ('worker_failed', 'worker_refused')
       and new.attempts = old.attempts
       and new.next_attempt_at is null
       and new.claimed_until is null then
      return new;
    end if;
    raise exception 'a delivered event comes back only as a dead letter from its worker'
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

-- 2. The system principal of the event workers (`system:workers`, principal kind `system`) is held
--    to the customer rules of an agent (SECURITY §3.3) until the owner decides otherwise with the
--    handover slice: it never reads a customer through a lead and never moves a customer
--    relationship. The request is a service's when its role key is an agent or system role, or its
--    principal row is of kind agent or system.
drop policy account_entities_read on account_entities;
--> statement-breakpoint
create policy account_entities_read on account_entities for select using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.account.read:entity'))
    or ((select app.has_perm('crm.account.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.account.read:own')) and owner_id = (select app.user_id()))
    or ((select coalesce(current_setting('app.role', true), '') not like 'agent:%'
               and coalesce(current_setting('app.role', true), '') not like 'system:%'
               and not exists (select 1 from principals p
                                where p.id = app.user_id() and p.kind in ('agent', 'system')))
        and exists (select 1 from opportunities o
                     where o.account_id = account_entities.account_id
                       and o.entity_id = account_entities.entity_id
                       and o.archived_at is null))));
--> statement-breakpoint
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
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'system:%'
     or exists (select 1 from public.principals p
                 where p.id = v_actor and p.kind in ('agent', 'system')) then
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
-- The lead search (0057) keeps its body; only its test of a service request widens, replaced in
-- the function's own text, which must hold the old test exactly once.
do $$
declare
  v_old text := $old$v_agent boolean := coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
    or exists (select 1 from public.principals p where p.id = v_user and p.kind = 'agent');$old$;
  v_new text := $new$v_agent boolean := coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
    or coalesce(pg_catalog.current_setting('app.role', true), '') like 'system:%'
    or exists (select 1 from public.principals p
                where p.id = v_user and p.kind in ('agent', 'system'));$new$;
  v_def text := pg_catalog.pg_get_functiondef(
    'app.lead_search_ids(text, boolean, text, integer)'::pg_catalog.regprocedure);
begin
  if (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, '')))
     / pg_catalog.length(v_old) <> 1 then
    raise exception 'app.lead_search_ids() does not hold its agent test exactly once';
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end
$$;
