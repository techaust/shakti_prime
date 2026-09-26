-- Request-context helpers read by every RLS policy (docs/DATABASE.md §4.2).
-- The roles app_user and readonly_reporter are created by src/migrate.ts before this runs.
create schema if not exists app;
--> statement-breakpoint
grant usage on schema app to app_user, readonly_reporter;
--> statement-breakpoint
grant usage on schema public to app_user, readonly_reporter;
--> statement-breakpoint
-- Null when the setting is missing or empty, so `= any(null)` never matches: fail closed.
create or replace function app.entity_ids() returns int[] language sql stable as $$
  select case when coalesce(current_setting('app.entity_ids', true), '') = ''
              then null else current_setting('app.entity_ids', true)::int[] end
$$;
--> statement-breakpoint
create or replace function app.user_id() returns uuid language sql stable as $$
  select case when coalesce(current_setting('app.user_id', true), '') = ''
              then null else current_setting('app.user_id', true)::uuid end
$$;
--> statement-breakpoint
-- `p` is `permission.key:scope`; the setting is a comma-separated list of such pairs.
create or replace function app.has_perm(p text) returns boolean language sql stable as $$
  select position(',' || p || ',' in ',' || coalesce(current_setting('app.permissions', true), '') || ',') > 0
$$;
--> statement-breakpoint
create or replace function app.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
--> statement-breakpoint
grant execute on all functions in schema app to app_user, readonly_reporter;
--> statement-breakpoint
alter default privileges in schema app grant execute on functions to app_user, readonly_reporter;
