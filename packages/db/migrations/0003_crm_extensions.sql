-- Trigram search and the ownership-scope helpers used by CRM policies (docs/DATABASE.md §4.2).
create extension if not exists pg_trgm;
--> statement-breakpoint
create or replace function app.team_id() returns uuid language sql stable as $$
  select case when coalesce(current_setting('app.team_id', true), '') = ''
              then null else current_setting('app.team_id', true)::uuid end
$$;
--> statement-breakpoint
-- True when the caller holds `perm` at entity scope or wider, at team scope for the row's team,
-- or at own scope for the row's owner. Null owner or team never matches.
create or replace function app.scope_ok(perm text, row_owner uuid, row_team uuid) returns boolean
language sql stable as $$
  select app.has_perm(perm || ':entity')
      or (app.has_perm(perm || ':team') and row_team is not null and row_team = app.team_id())
      or (app.has_perm(perm || ':own') and row_owner is not null and row_owner = app.user_id())
$$;
--> statement-breakpoint
grant execute on all functions in schema app to app_user, readonly_reporter;
