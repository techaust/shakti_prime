-- RLS, grants and helpers for the identity tables (docs/DATABASE.md §3, §4, §6.1;
-- docs/design/backend-weeks-3-5.md §2.1). The auth module connects as auth_service and owns the
-- five Better Auth tables; app_user reads users, user_entity_roles and the non-secret columns of
-- sessions, writes them only through admin commands, and never sees a token, hash or secret.
-- The role auth_service is created by src/migrate.ts before this runs.
grant usage on schema public, app to auth_service;
--> statement-breakpoint
grant execute on function app.set_updated_at() to auth_service;
--> statement-breakpoint

-- updated_at triggers
create trigger set_updated_at before update on users for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on sessions for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on auth_accounts for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on auth_verifications for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on user_entity_roles for each row execute function app.set_updated_at();
--> statement-breakpoint

-- users: readable with any context (names for admin screens and the entity switcher);
-- written by app_user only with admin.users.write:all; the auth module updates sign-in state.
alter table users enable row level security;
--> statement-breakpoint
alter table users force row level security;
--> statement-breakpoint
create policy users_auth_service on users for all to auth_service using (true) with check (true);
--> statement-breakpoint
create policy users_read on users for select to app_user using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy users_insert on users for insert to app_user
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy users_update on users for update to app_user
  using ((select app.has_perm('admin.users.write:all')))
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

-- sessions: the token column is granted to auth_service only. app_user sees its own sessions and,
-- with admin.users.write:all, everyone's; it revokes by setting revoked_at, never by deleting.
alter table sessions enable row level security;
--> statement-breakpoint
alter table sessions force row level security;
--> statement-breakpoint
create policy sessions_auth_service on sessions for all to auth_service using (true) with check (true);
--> statement-breakpoint
create policy sessions_read on sessions for select to app_user
  using (user_id = (select app.user_id()) or (select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy sessions_update on sessions for update to app_user
  using ((select app.has_perm('admin.users.write:all')))
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

-- auth_accounts, auth_verifications, user_two_factor: the auth module only
alter table auth_accounts enable row level security;
--> statement-breakpoint
alter table auth_accounts force row level security;
--> statement-breakpoint
create policy auth_accounts_auth_service on auth_accounts for all to auth_service using (true) with check (true);
--> statement-breakpoint
alter table auth_verifications enable row level security;
--> statement-breakpoint
alter table auth_verifications force row level security;
--> statement-breakpoint
create policy auth_verifications_auth_service on auth_verifications for all to auth_service using (true) with check (true);
--> statement-breakpoint
alter table user_two_factor enable row level security;
--> statement-breakpoint
alter table user_two_factor force row level security;
--> statement-breakpoint
create policy user_two_factor_auth_service on user_two_factor for all to auth_service using (true) with check (true);
--> statement-breakpoint

-- user_entity_roles: the user's access list. Readable with any context; replaced as a set by
-- admin.user.role.set, which is why this table alone grants delete to app_user (audit_logs keeps
-- the history from week 3 slice 2).
alter table user_entity_roles enable row level security;
--> statement-breakpoint
alter table user_entity_roles force row level security;
--> statement-breakpoint
create policy user_entity_roles_read on user_entity_roles for select to app_user
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy user_entity_roles_insert on user_entity_roles for insert to app_user
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy user_entity_roles_update on user_entity_roles for update to app_user
  using ((select app.has_perm('admin.users.write:all')))
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy user_entity_roles_delete on user_entity_roles for delete to app_user
  using ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

-- grants
grant select, insert, update on users to app_user;
--> statement-breakpoint
grant select, update on users to auth_service;
--> statement-breakpoint
grant select (id, user_id, expires_at, ip_address, user_agent, last_seen_at, revoked_at, revoked_reason, created_at, updated_at)
  on sessions to app_user;
--> statement-breakpoint
grant update (revoked_at, revoked_reason) on sessions to app_user;
--> statement-breakpoint
grant select, insert, update, delete on sessions, auth_accounts, auth_verifications, user_two_factor to auth_service;
--> statement-breakpoint
grant select, insert, update, delete on user_entity_roles to app_user;
--> statement-breakpoint
-- the reporting role never sees the auth module's tables
revoke all on sessions, auth_accounts, auth_verifications, user_two_factor from readonly_reporter;
--> statement-breakpoint
grant select on users, user_entity_roles to readonly_reporter;
--> statement-breakpoint

-- Principal resolution runs before a request context exists, so it reads through one
-- security-definer function that returns role and grant metadata only (no secret column).
-- Executable by app_user only.
create or replace function app.user_grants(p_user uuid)
returns table (
  status text,
  locale text,
  theme text,
  name text,
  email text,
  two_factor_enabled boolean,
  entity_id smallint,
  entity_name text,
  role_key text,
  team_id uuid,
  permission_key text,
  scope text
)
language sql stable security definer set search_path = public, app as $$
  select u.status, u.locale, u.theme, u.name, u.email, u.two_factor_enabled,
         uer.entity_id, e.brand_name, r.key, uer.team_id, rp.permission_key, rp.scope
    from users u
    left join user_entity_roles uer on uer.user_id = u.id
    left join entities e on e.id = uer.entity_id
    left join roles r on r.id = uer.role_id and r.archived_at is null
    left join role_permissions rp on rp.role_id = r.id
   where u.id = p_user
$$;
--> statement-breakpoint
revoke all on function app.user_grants(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_grants(uuid) to app_user;
