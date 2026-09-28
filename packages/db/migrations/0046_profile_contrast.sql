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
