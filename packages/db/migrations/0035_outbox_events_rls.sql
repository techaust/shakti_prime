-- Outbox (ADR 0005, docs/design/backend-weeks-3-5.md §4.1): append-only for the application,
-- delivery bookkeeping for the publisher. The role outbox_publisher is created by src/migrate.ts
-- before this runs; it may read this table and update its four delivery columns, nothing else.
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
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.outbox_delivery_only() from public, app_user, readonly_reporter, auth_service;
--> statement-breakpoint
-- Every role, the owner included: a delivered event is never rewritten or removed.
create trigger outbox_events_delivery_only before update or delete on outbox_events
  for each row execute function app.outbox_delivery_only();
--> statement-breakpoint
alter table outbox_events enable row level security;
--> statement-breakpoint
alter table outbox_events force row level security;
--> statement-breakpoint
-- A command writes the events of the entities in its own scope; with no request context the
-- scope is empty and nothing is written.
create policy outbox_events_insert on outbox_events for insert to app_user
  with check (entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
-- The publisher has no request context: it delivers every entity's events.
create policy outbox_events_publisher_read on outbox_events for select to outbox_publisher
  using (true);
--> statement-breakpoint
create policy outbox_events_publisher_update on outbox_events for update to outbox_publisher
  using (true) with check (true);
--> statement-breakpoint
grant insert on outbox_events to app_user;
--> statement-breakpoint
grant usage on schema public to outbox_publisher;
--> statement-breakpoint
grant select, update (published_at, attempts, last_error, dead_lettered_at) on outbox_events to outbox_publisher;
