ALTER TABLE "users" ADD COLUMN "contrast" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contrast_check" CHECK ("users"."contrast" in ('standard', 'high'));--> statement-breakpoint
-- profile.contrast.set: the caller turns Higher contrast on or off on their own profile
-- (DESIGN.md §2.1), so it follows them to every device as the theme does. Written like
-- app.set_own_theme() (0022): the users table lets app_user update a row only with
-- admin.users.write:all, so this definer changes the contrast column of the caller's own active
-- row and nothing else. It checks profile.write:own in its body and pins an empty search_path
-- with qualified names (AUDIT M2). It answers the saved contrast, or null when no row changed.
create or replace function app.set_own_contrast(p_contrast text) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_contrast text;
begin
  if v_user is null or not app.has_perm('profile.write:own') then
    raise exception 'profile.write:own is required' using errcode = '42501';
  end if;
  update public.users
     set contrast = p_contrast, updated_at = now(), updated_by = v_user
   where id = v_user and status = 'active'
  returning contrast into v_contrast;
  return v_contrast;
end
$$;
--> statement-breakpoint
revoke execute on function app.set_own_contrast(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.set_own_contrast(text) to app_user;
--> statement-breakpoint
-- Principal resolution returns the contrast with the theme, so the session carries it to every
-- screen. The return type changes, which `create or replace` cannot do, so the function is
-- recreated with its grants, as in 0021. The search_path is pinned empty (AUDIT M2).
drop function app.user_grants(uuid);
--> statement-breakpoint
create function app.user_grants(p_user uuid)
returns table (
  status text, theme text, contrast text, name text, email text, two_factor_enabled boolean,
  entity_id smallint, entity_name text, role_key text, team_id uuid, permission_key text, scope text
)
language sql stable security definer set search_path = '' as $$
  select u.status, u.theme, u.contrast, u.name, u.email, u.two_factor_enabled,
         uer.entity_id, e.brand_name, r.key, uer.team_id, rp.permission_key, rp.scope
    from public.users u
    left join public.user_entity_roles uer
      on uer.user_id = u.id
     and exists (select 1 from public.entities x where x.id = uer.entity_id and x.archived_at is null)
    left join public.entities e on e.id = uer.entity_id
    left join public.roles r on r.id = uer.role_id and r.archived_at is null
    left join public.role_permissions rp on rp.role_id = r.id
   where u.id = p_user
$$;
--> statement-breakpoint
revoke all on function app.user_grants(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_grants(uuid) to app_user;
