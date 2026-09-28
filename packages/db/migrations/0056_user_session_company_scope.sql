-- users and sessions belong to no single company, so a change to either reaches every company the
-- person works in. The admin commands refuse a person who also works in a company outside the
-- request (assertUserInScope, fix P, AUDIT H2), but the policies asked only for
-- admin.users.write:all, so a one-company administrator's direct write could still suspend, or
-- sign out, a person who also works in another company. The update policies of both now ask the
-- same question the commands ask: the person holds no role outside the request's companies
-- (app.user_roles_outside_request(), 0049). A request for every company the person works in
-- passes, as before.
--
-- The caller's own row keeps today's rule (admin.users.write:all alone): the own-profile
-- changes (theme, contrast) go through their definers, which this policy does not govern, and the
-- commands refuse a change to one's own roles or status.
--
-- The helper raises for a caller without admin.users.write:all, so the permission is tested first
-- inside a case, whose order Postgres keeps, and a caller without it is refused by the policy as
-- before rather than by an error.
drop policy users_update on users;
--> statement-breakpoint
create policy users_update on users for update to app_user
  using (case when (select app.has_perm('admin.users.write:all'))
              then id = (select app.user_id()) or app.user_roles_outside_request(id) = '{}'
              else false end)
  with check (case when (select app.has_perm('admin.users.write:all'))
                   then id = (select app.user_id()) or app.user_roles_outside_request(id) = '{}'
                   else false end);
--> statement-breakpoint
drop policy sessions_update on sessions;
--> statement-breakpoint
create policy sessions_update on sessions for update to app_user
  using (case when (select app.has_perm('admin.users.write:all'))
              then user_id = (select app.user_id()) or app.user_roles_outside_request(user_id) = '{}'
              else false end)
  with check (case when (select app.has_perm('admin.users.write:all'))
                   then user_id = (select app.user_id()) or app.user_roles_outside_request(user_id) = '{}'
                   else false end);
