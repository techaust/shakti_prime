-- Who may hold a permission at all (BLUEPRINT §7.1 to §7.3, docs/SECURITY.md §3.1), whoever
-- writes role_permissions, the seed included:
--   * a platform-only permission, only a system role (`system:*`, 0061);
--   * every admin.* permission and integrations.dlq.replay, only the Executive role;
--   * finance.cost.read only Executive and Accounts; procurement.rate.read only Executive,
--     Inventory Manager and Accounts.
-- app.role_may_hold() answers it and a security test compares it with roleMayHold() in
-- @shakti/contracts for every role and permission. The guard of 0061 becomes the holder guard.
-- The Executive role can never be left without admin.roles.write:all and admin.users.write:all
-- by any transaction: a deferred constraint trigger checks it at commit, so the seed's rewrite of
-- the role's grants inside one transaction still passes.
-- app.user_roles_outside_request() ignores archived companies: a leftover role in one no longer
-- blocks an administrator acting for every active company, so a role change signs out everyone.
-- The catalogue and the set of roles are the seed's: app_user may no longer insert roles or
-- permissions or edit permissions, and updates of roles reach only the customised mark.

create or replace function app.role_may_hold(p_role_key text, p_permission_key text) returns boolean
  language sql immutable set search_path = '' as $$
  select case
    when p_permission_key = any (app.platform_only_permissions()) then p_role_key like 'system:%'
    when p_permission_key like 'admin.%' or p_permission_key = 'integrations.dlq.replay'
      then p_role_key = 'executive'
    when p_permission_key = 'finance.cost.read' then p_role_key in ('executive', 'accounts')
    when p_permission_key = 'procurement.rate.read'
      then p_role_key in ('executive', 'inventory_manager', 'accounts')
    else true
  end
$$;
--> statement-breakpoint
revoke execute on function app.role_may_hold(text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.role_may_hold(text, text) to app_user;
--> statement-breakpoint
create or replace function app.role_permissions_holder_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_key text;
begin
  select r.key into v_key from public.roles r where r.id = new.role_id;
  -- A role the caller cannot see is refused as a privilege, as its policies would refuse it.
  if v_key is null then
    raise exception 'permission denied for role %', new.role_id using errcode = '42501';
  end if;
  if not app.role_may_hold(v_key, new.permission_key) then
    if new.permission_key = any (app.platform_only_permissions()) then
      raise exception 'permission % is held only by a system role', new.permission_key
        using errcode = 'check_violation', constraint = 'role_permissions_platform_only';
    end if;
    raise exception 'role % may not hold permission %', v_key, new.permission_key
      using errcode = 'check_violation', constraint = 'role_permissions_holder';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.role_permissions_holder_guard() from public, readonly_reporter;
--> statement-breakpoint
drop trigger role_permissions_platform_guard on role_permissions;
--> statement-breakpoint
drop function app.role_permissions_platform_guard();
--> statement-breakpoint
create trigger role_permissions_holder_guard before insert or update on role_permissions
  for each row execute function app.role_permissions_holder_guard();
--> statement-breakpoint

create or replace function app.role_permissions_executive_keeps_admin() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_executive uuid;
  v_kept int;
begin
  select r.id into v_executive from public.roles r where r.key = 'executive';
  if v_executive is null then
    return null;
  end if;
  if (tg_op <> 'INSERT' and old.role_id = v_executive)
     or (tg_op <> 'DELETE' and new.role_id = v_executive) then
    select count(*) into v_kept
      from public.role_permissions rp
     where rp.role_id = v_executive
       and rp.scope = 'all'
       and rp.permission_key in ('admin.roles.write', 'admin.users.write');
    if v_kept < 2 then
      raise exception 'the Executive role keeps admin.roles.write:all and admin.users.write:all'
        using errcode = 'check_violation', constraint = 'role_permissions_executive_keeps_admin';
    end if;
  end if;
  return null;
end
$$;
--> statement-breakpoint
revoke execute on function app.role_permissions_executive_keeps_admin() from public, readonly_reporter;
--> statement-breakpoint
create constraint trigger role_permissions_executive_keeps_admin
  after insert or update or delete on role_permissions
  deferrable initially deferred
  for each row execute function app.role_permissions_executive_keeps_admin();
--> statement-breakpoint

create or replace function app.user_roles_outside_request(p_user uuid) returns smallint[]
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_request int[] := coalesce(app.entity_ids(), '{}'::int[]);
begin
  if app.user_id() is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_entity_roles uer
      join public.entities e on e.id = uer.entity_id
     where uer.user_id = p_user and e.archived_at is null
  ) then
    return coalesce(
      (select pg_catalog.array_agg(e.id order by e.id)
         from public.entities e
        where e.archived_at is null and not (e.id = any (v_request))),
      '{}'::smallint[]);
  end if;
  return coalesce(
    (select pg_catalog.array_agg(distinct uer.entity_id order by uer.entity_id)
       from public.user_entity_roles uer
       join public.entities e on e.id = uer.entity_id
      where uer.user_id = p_user
        and e.archived_at is null
        and not (uer.entity_id = any (v_request))),
    '{}'::smallint[]);
end
$$;
--> statement-breakpoint
revoke execute on function app.user_roles_outside_request(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_roles_outside_request(uuid) to app_user;
--> statement-breakpoint

drop policy roles_insert on roles;
--> statement-breakpoint
drop policy permissions_insert on permissions;
--> statement-breakpoint
drop policy permissions_update on permissions;
--> statement-breakpoint
revoke insert, update on roles from app_user;
--> statement-breakpoint
grant update (customised_at, updated_by, updated_at) on roles to app_user;
--> statement-breakpoint
revoke insert, update on permissions from app_user;
