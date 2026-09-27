-- profile.theme.set: the caller saves System, Light or Dark on their own profile (DESIGN.md §7).
--
-- The users table lets app_user update a row only with admin.users.write:all, and a column grant
-- cannot be tied to one policy, so a policy for the caller's own row would also open their name,
-- phone and status. This definer function changes the theme column of the caller's own active
-- row and nothing else. It checks profile.write:own in its body and pins an empty search_path
-- with qualified names (see AUDIT M2). It answers the saved theme, or null when no row changed.
create or replace function app.set_own_theme(p_theme text) returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_theme text;
begin
  if v_user is null or not app.has_perm('profile.write:own') then
    raise exception 'profile.write:own is required' using errcode = '42501';
  end if;
  update public.users
     set theme = p_theme, updated_at = now(), updated_by = v_user
   where id = v_user and status = 'active'
  returning theme into v_theme;
  return v_theme;
end
$$;
--> statement-breakpoint
revoke execute on function app.set_own_theme(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.set_own_theme(text) to app_user;
