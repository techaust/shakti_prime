-- admin.user.two_factor.reset (docs/design/backend-weeks-3-5.md §2.6, review 3). app_user has no
-- privilege on user_two_factor and cannot update users.two_factor_enabled (finding S), so this
-- definer function is the only request path to either: it checks the Executive permission in its
-- body, refuses the caller's own account, removes the authenticator app and answers whether one
-- was enrolled. The command revokes the sessions and writes the audit row in the same transaction.
create or replace function app.reset_two_factor(p_user uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_enabled boolean;
begin
  if v_actor is null or not app.has_perm('admin.users.write:all') then
    raise exception 'admin.users.write:all is required' using errcode = '42501';
  end if;
  if p_user = v_actor then
    raise exception 'a user cannot reset their own authenticator app' using errcode = '42501';
  end if;
  select two_factor_enabled into v_enabled from public.users where id = p_user for update;
  if not found then
    return false;
  end if;
  delete from public.user_two_factor where user_id = p_user;
  update public.users
     set two_factor_enabled = false, updated_at = now(), updated_by = v_actor
   where id = p_user;
  return v_enabled;
end
$$;
--> statement-breakpoint
revoke execute on function app.reset_two_factor(uuid) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.reset_two_factor(uuid) to app_user;
