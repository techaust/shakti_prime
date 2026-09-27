-- ADR 0014: users carry no locale any more, so principal resolution stops returning one. The
-- return type changes, which `create or replace` cannot do, so the function is recreated with
-- its grants. The search_path is pinned empty with qualified names (AUDIT M2).
drop function app.user_grants(uuid);
--> statement-breakpoint
create function app.user_grants(p_user uuid)
returns table (
  status text, theme text, name text, email text, two_factor_enabled boolean,
  entity_id smallint, entity_name text, role_key text, team_id uuid, permission_key text, scope text
)
language sql stable security definer set search_path = '' as $$
  select u.status, u.theme, u.name, u.email, u.two_factor_enabled,
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
