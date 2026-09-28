-- user_entity_roles follows the company of each row. Until now any principal with a context, agents
-- included, read the whole group's role map, and an admin role held in one company (whose grants
-- are at scope `all`) could give, change or remove roles in the other three.
--
-- Reads: rows in a company of the request, or the caller's own rows. Principal resolution reads
-- through the definer app.user_grants() and is unaffected.
drop policy user_entity_roles_read on user_entity_roles;
--> statement-breakpoint
create policy user_entity_roles_read on user_entity_roles for select to app_user
  using (entity_id = any ((select app.entity_ids())::int[]) or user_id = (select app.user_id()));
--> statement-breakpoint
-- Writes: admin.users.write:all, and only for a company of the request.
drop policy user_entity_roles_insert on user_entity_roles;
--> statement-breakpoint
create policy user_entity_roles_insert on user_entity_roles for insert to app_user
  with check ((select app.has_perm('admin.users.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
drop policy user_entity_roles_update on user_entity_roles;
--> statement-breakpoint
create policy user_entity_roles_update on user_entity_roles for update to app_user
  using ((select app.has_perm('admin.users.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('admin.users.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
drop policy user_entity_roles_delete on user_entity_roles;
--> statement-breakpoint
create policy user_entity_roles_delete on user_entity_roles for delete to app_user
  using ((select app.has_perm('admin.users.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint

-- The admin commands still need two answers that reach past the request's companies, which the
-- read policy now hides: whether the person they act on also works in a company outside the
-- request (users and sessions belong to no single company, fix P, AUDIT H2), and how many active
-- Executives the group has (the last-Executive guard, AUDIT L7). Each definer answers only a
-- caller holding admin.users.write:all, returns ids and a count and no other column, and pins an
-- empty search_path with qualified names (AUDIT M2).
create or replace function app.user_roles_outside_request(p_user uuid) returns smallint[]
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  return coalesce(
    (select array_agg(distinct uer.entity_id order by uer.entity_id)
       from public.user_entity_roles uer
      where uer.user_id = p_user
        and not (uer.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))),
    '{}'::smallint[]);
end
$$;
--> statement-breakpoint
revoke execute on function app.user_roles_outside_request(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.user_roles_outside_request(uuid) to app_user;
--> statement-breakpoint
create or replace function app.active_executive_count() returns integer
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  return (
    select count(distinct u.id)::int
      from public.users u
      join public.user_entity_roles uer on uer.user_id = u.id
      join public.roles r on r.id = uer.role_id
     where u.status = 'active' and r.key = 'executive');
end
$$;
--> statement-breakpoint
revoke execute on function app.active_executive_count() from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.active_executive_count() to app_user;
