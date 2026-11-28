-- F1 Field app foundation (docs/03-roadmap-appendix/phase4.md §6.4, the review of 27-11-2026): a
-- change to a person's account that ends their website sessions (roles, suspension, an
-- Executive's authenticator reset) signs their phones out in the same transaction, through
-- app_user's column grant on revoked_at, revoked_reason and revoked_by. Those commands need
-- admin.users.write, not field.device.revoke, so the two policies below mirror sessions_read and
-- sessions_update (0014, 0056): a holder of admin.users.write at scope all reads the columns
-- without a secret of every phone, and signs out the phones of a person who holds no role outside
-- the request's companies (or their own). app_user never signs a phone back in.
create policy mobile_devices_account_read on mobile_devices for select to app_user, app_reader
  using ((select app.has_perm('admin.users.write:all')));
--> statement-breakpoint
create policy mobile_devices_account_change on mobile_devices for update to app_user
  using (case when (select app.has_perm('admin.users.write:all'))
              then user_id = (select app.user_id()) or app.user_roles_outside_request(user_id) = '{}'
              else false end)
  with check (revoked_at is not null
              and case when (select app.has_perm('admin.users.write:all'))
                       then user_id = (select app.user_id())
                            or app.user_roles_outside_request(user_id) = '{}'
                       else false end);
