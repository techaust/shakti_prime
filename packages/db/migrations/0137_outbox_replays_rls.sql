-- Send again delivers (audit 2026-10, DATA-1). QStash keeps a deduplication id for 90 days, so a
-- replay published under the event's id again was answered `deduplicated` and delivered nothing.
-- `replays` (previous migration) counts the delivery generations: the publisher sends each
-- generation under its own deduplication id, and a replay is the only change that raises it.
--
-- 1. The trigger keeps every rule of 0064 and adds two: `replays` changes only through a replay,
--    and a replay raises it by exactly one.
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
  if old.dead_lettered_at is null and new.replays is distinct from old.replays then
    raise exception 'only a replay of a dead letter counts a replay'
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
          new.next_attempt_at, new.claimed_until, new.replays)
         is distinct from
         (old.published_at, old.attempts, old.last_error, old.dead_lettered_at,
          old.next_attempt_at, old.claimed_until, old.replays) then
    if new.dead_lettered_at is null and new.attempts = 0 and new.last_error is null
       and new.published_at is null and new.next_attempt_at is null and new.claimed_until is null
       and new.replays = old.replays + 1
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

-- 2. A replay starts the next delivery generation; everything else is as in 0054.
create or replace function app.replay_dead_letter(p_event uuid)
  returns table (event_entity_id smallint, event_type text, previous_attempts integer,
                 was_dead_lettered_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.outbox_events%rowtype;
begin
  if app.user_id() is null or not app.has_perm('integrations.dlq.replay:all') then
    raise exception 'integrations.dlq.replay:all is required' using errcode = '42501';
  end if;
  select o.* into v_row from public.outbox_events o where o.id = p_event for update;
  if not found then
    return;
  end if;
  if v_row.dead_lettered_at is not null then
    perform pg_catalog.set_config('app.dlq_replay', p_event::text, true);
    update public.outbox_events o
       set dead_lettered_at = null, attempts = 0, last_error = null,
           next_attempt_at = null, claimed_until = null,
           replays = o.replays operator(pg_catalog.+) 1
     where o.id = p_event;
    perform pg_catalog.set_config('app.dlq_replay', '', true);
  end if;
  return query select v_row.entity_id, v_row.type, v_row.attempts, v_row.dead_lettered_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.replay_dead_letter(uuid) from public, readonly_reporter, auth_service, outbox_publisher, app_reader;
--> statement-breakpoint
grant execute on function app.replay_dead_letter(uuid) to app_user;
