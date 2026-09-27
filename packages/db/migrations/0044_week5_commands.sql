-- Week 5 commands (docs/design/backend-weeks-3-5.md §7.2, §4.4, API §3.7).
--
-- 1. An opportunity's state_changed_at starts from its last change. The updated_at trigger is
--    held off for the backfill so no lead looks touched by the migration.
alter table opportunities disable trigger set_updated_at;
--> statement-breakpoint
update opportunities set state_changed_at = updated_at;
--> statement-breakpoint
alter table opportunities enable trigger set_updated_at;
--> statement-breakpoint

-- 2. The outbox stays append-only, and a dead letter changes in exactly one way: a replay puts it
--    back in the queue with its attempts and error cleared, and only from
--    app.replay_dead_letter(), which marks the row it resets in a transaction setting.
create or replace function app.outbox_delivery_only() returns trigger language plpgsql
set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if tg_op = 'DELETE' then
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
     and (new.published_at, new.attempts, new.last_error, new.dead_lettered_at)
         is distinct from
         (old.published_at, old.attempts, old.last_error, old.dead_lettered_at) then
    if new.dead_lettered_at is null and new.attempts = 0 and new.last_error is null
       and new.published_at is null
       and current_setting('app.dlq_replay', true) = old.id::text then
      return new;
    end if;
    raise exception 'a dead-lettered event changes only by a replay'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint

-- 3. integrations.dlq.replay (Executive only): the one request path that writes outbox_events
--    beyond an insert. No row answers an unknown event; a row with a null dead_lettered_at answers
--    one that is not dead-lettered and is left as it is. The command writes the audit row.
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
       set dead_lettered_at = null, attempts = 0, last_error = null
     where o.id = p_event;
    perform pg_catalog.set_config('app.dlq_replay', '', true);
  end if;
  return query select v_row.entity_id, v_row.type, v_row.attempts, v_row.dead_lettered_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.replay_dead_letter(uuid) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.replay_dead_letter(uuid) to app_user;
