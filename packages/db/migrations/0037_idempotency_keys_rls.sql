-- Idempotency keys (docs/design/backend-weeks-3-5.md §5): each caller reads and writes its own
-- keys only, and only the answer of a key it has just claimed may change. Nobody deletes a key
-- by request; pg_cron removes expired ones.
alter table idempotency_keys enable row level security;
--> statement-breakpoint
alter table idempotency_keys force row level security;
--> statement-breakpoint
create policy idempotency_keys_read on idempotency_keys for select to app_user
  using (principal_id = (select app.user_id()));
--> statement-breakpoint
create policy idempotency_keys_insert on idempotency_keys for insert to app_user
  with check (principal_id = (select app.user_id()));
--> statement-breakpoint
create policy idempotency_keys_update on idempotency_keys for update to app_user
  using (principal_id = (select app.user_id()))
  with check (principal_id = (select app.user_id()));
--> statement-breakpoint
grant select, insert, update (response_json) on idempotency_keys to app_user;
--> statement-breakpoint
-- Removes expired keys; run by the migrator and by pg_cron, never by a request role.
create or replace function app.purge_idempotency_keys() returns int
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
declare
  removed int;
begin
  delete from public.idempotency_keys where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end
$$;
--> statement-breakpoint
revoke execute on function app.purge_idempotency_keys() from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select cron.schedule('idempotency-keys-purge', '30 2 * * *', 'select app.purge_idempotency_keys()');
