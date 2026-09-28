-- Outbox reliability (docs/design/backend-weeks-3-5.md §4.1 and §4.2, ADR 0005).
--
-- 1. The append-only trigger now knows the two new delivery columns (0053): `next_attempt_at`,
--    when a failed event is due again after its backoff, and `claimed_until`, the lease of the
--    publisher run sending it. A dead letter still changes only by a replay, which now clears
--    both. A delete is refused, except the retention purge of an event published more than 30
--    days ago, made only by app.purge_outbox_events() below while it has its setting on; a
--    pending or dead-lettered event is never removed.
create or replace function app.outbox_delivery_only() returns trigger language plpgsql
set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.outbox_retention', true) = 'purge'
       and old.published_at is not null
       and old.dead_lettered_at is null
       and old.published_at < now() - interval '30 days' then
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

-- 2. A replay puts the event back in the queue due at once: no backoff and no lease left over.
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
           next_attempt_at = null, claimed_until = null
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
--> statement-breakpoint

-- 3. The publisher sets the backoff and the lease; it still may not change anything else.
grant update (next_attempt_at, claimed_until) on outbox_events to outbox_publisher;
--> statement-breakpoint

-- 4. Retention runs: written only by the jobs, which pg_cron runs as the table owner; read with
--    `audit.read:all`, and an empty company scope reads nothing (as audit rows of no company).
alter table retention_runs enable row level security;
--> statement-breakpoint
alter table retention_runs force row level security;
--> statement-breakpoint
create policy retention_runs_read on retention_runs for select to app_user
  using ((select app.has_perm('audit.read:all')) and cardinality((select app.entity_ids())) > 0);
--> statement-breakpoint
revoke all on retention_runs from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on retention_runs to app_user;
--> statement-breakpoint

-- 5. Removes events published more than 30 days ago and records the run; run by the migrator and
--    by pg_cron, never by a request role. A failure is recorded on its run and leaves the outbox
--    as it was.
create or replace function app.purge_outbox_events() returns int
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
declare
  v_run uuid := app.uuid_v7();
  v_removed int := 0;
begin
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'outbox-events-purge', clock_timestamp());
  begin
    perform set_config('app.outbox_retention', 'purge', true);
    delete from public.outbox_events
     where published_at < now() - interval '30 days' and dead_lettered_at is null;
    get diagnostics v_removed = row_count;
    perform set_config('app.outbox_retention', '', true);
  exception when others then
    update public.retention_runs
       set finished_at = clock_timestamp(), error = left(sqlerrm, 500)
     where id = v_run;
    raise warning 'outbox-events-purge failed: %', sqlerrm;
    return null;
  end;
  update public.retention_runs
     set finished_at = clock_timestamp(), rows_affected = v_removed
   where id = v_run;
  return v_removed;
end
$$;
--> statement-breakpoint
revoke execute on function app.purge_outbox_events() from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select cron.schedule('outbox-events-purge', '45 2 * * *', 'select app.purge_outbox_events()');
