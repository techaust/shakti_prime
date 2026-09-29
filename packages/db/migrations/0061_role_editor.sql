-- The role editor (docs/SECURITY.md §3.1, docs/design/phase1.md §6.2). An Executive replaces a
-- staff role's grants as a set through admin.role.permissions.set, so app_user may delete a
-- role's grant. A role's grants reach every company, so every write to role_permissions, and the
-- customised mark on roles, needs admin.roles.write:all in a request acting for every active
-- company (app.request_covers_group(), 0019), the rule shared price lists and GST rates follow.
--
-- Platform-only permissions (PLATFORM_ONLY_PERMISSIONS in @shakti/contracts) are held only by a
-- system role (`system:*`). The trigger refuses one for any other role, whoever writes, the seed
-- included; the trigger runs as the caller, and a role it cannot read is refused too.

create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process']::text[]
$$;
--> statement-breakpoint
revoke execute on function app.platform_only_permissions() from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.platform_only_permissions() to app_user;
--> statement-breakpoint
create or replace function app.role_permissions_platform_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_key text;
begin
  if not (new.permission_key = any (app.platform_only_permissions())) then
    return new;
  end if;
  select r.key into v_key from public.roles r where r.id = new.role_id;
  if v_key is null or v_key not like 'system:%' then
    raise exception 'permission % is held only by a system role', new.permission_key
      using errcode = 'check_violation', constraint = 'role_permissions_platform_only';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.role_permissions_platform_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger role_permissions_platform_guard before insert or update on role_permissions
  for each row execute function app.role_permissions_platform_guard();
--> statement-breakpoint

drop policy role_permissions_insert on role_permissions;
--> statement-breakpoint
create policy role_permissions_insert on role_permissions for insert
  with check ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
drop policy role_permissions_update on role_permissions;
--> statement-breakpoint
create policy role_permissions_update on role_permissions for update
  using ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()))
  with check ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
create policy role_permissions_delete on role_permissions for delete
  using ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
grant delete on role_permissions to app_user;
--> statement-breakpoint

drop policy roles_update on roles;
--> statement-breakpoint
create policy roles_update on roles for update
  using ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()))
  with check ((select app.has_perm('admin.roles.write:all')) and (select app.request_covers_group()));
