-- RLS, triggers and grants for the org core tables (docs/DATABASE.md §4, §6.1; ADR 0002).
-- Shared org tables (principals, roles, permissions, role_permissions) are readable with any
-- request context and hidden without one. `entities` is scoped to the caller's entity ids.

-- updated_at triggers
create trigger set_updated_at before update on entities for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on principals for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on roles for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on permissions for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on role_permissions for each row execute function app.set_updated_at();
--> statement-breakpoint

-- entities: visible only inside the caller's scope; written only with admin.entities.write
alter table entities enable row level security;
--> statement-breakpoint
alter table entities force row level security;
--> statement-breakpoint
create policy entities_read on entities for select
  using (id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy entities_insert on entities for insert
  with check ((select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint
create policy entities_update on entities for update
  using (id = any ((select app.entity_ids())::int[]) and (select app.has_perm('admin.entities.write:all')))
  with check (id = any ((select app.entity_ids())::int[]) and (select app.has_perm('admin.entities.write:all')));
--> statement-breakpoint

-- principals
alter table principals enable row level security;
--> statement-breakpoint
alter table principals force row level security;
--> statement-breakpoint
create policy principals_read on principals for select
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy principals_insert on principals for insert
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy principals_update on principals for update
  using ((select app.has_perm('admin.users.write:all')))
  with check ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint

-- roles
alter table roles enable row level security;
--> statement-breakpoint
alter table roles force row level security;
--> statement-breakpoint
create policy roles_read on roles for select
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy roles_insert on roles for insert
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint
create policy roles_update on roles for update
  using ((select app.has_perm('admin.roles.write:all')))
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint

-- permissions (catalogue rows are seeded; edits go through admin.roles.write)
alter table permissions enable row level security;
--> statement-breakpoint
alter table permissions force row level security;
--> statement-breakpoint
create policy permissions_read on permissions for select
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy permissions_insert on permissions for insert
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint
create policy permissions_update on permissions for update
  using ((select app.has_perm('admin.roles.write:all')))
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint

-- role_permissions
alter table role_permissions enable row level security;
--> statement-breakpoint
alter table role_permissions force row level security;
--> statement-breakpoint
create policy role_permissions_read on role_permissions for select
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy role_permissions_insert on role_permissions for insert
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint
create policy role_permissions_update on role_permissions for update
  using ((select app.has_perm('admin.roles.write:all')))
  with check ((select app.has_perm('admin.roles.write:all')));
--> statement-breakpoint

-- grants: app_user reads and writes, never deletes (masters use archived_at); the reporter reads
grant select, insert, update on entities, principals, roles, permissions, role_permissions to app_user;
--> statement-breakpoint
revoke delete on entities, principals, roles, permissions, role_permissions from app_user;
--> statement-breakpoint
grant select on entities, principals, roles, permissions, role_permissions to readonly_reporter;
