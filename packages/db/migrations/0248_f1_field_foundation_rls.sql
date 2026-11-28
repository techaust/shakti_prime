-- F1 Field app foundation (docs/03-roadmap-appendix/phase4.md §6.4): row security, grants and
-- triggers for the field app's phones and the feature flags.
--
-- mobile_devices is an identity table (docs/05-database.md §3, §6.1): the auth module signs a phone
-- in, rotates its refresh token and signs it out as auth_service, with full access, as it does for
-- sessions. app_user and app_reader read only the columns that hold no secret (never the refresh
-- token's hash, its family, the installation id or the push token): a person their own phones, and
-- a holder of field.device.revoke the phones of the people they may sign out. app_user signs a
-- phone out by setting revoked_at, revoked_reason and revoked_by (field.device.revoke), never by
-- deleting it, and never signs one back in. Who may be signed out: with field.device.revoke at
-- scope all, anyone; at scope entity, a person who holds a role in one of the request's companies.
-- Signing a phone out takes no access away but makes the person sign in again, so a company's
-- manager may do it for a person who also works elsewhere, unlike a change to the account (0056).
--
-- feature_flags is read by every request with a principal behind it, the group's rows and the rows
-- of the request's companies, and written only with admin.flags.write (scope all), for the group or
-- a company of the request. A row is switched, never deleted.

-- 1. updated_at
create trigger set_updated_at before update on mobile_devices
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on feature_flags
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. mobile_devices
alter table mobile_devices enable row level security;
--> statement-breakpoint
alter table mobile_devices force row level security;
--> statement-breakpoint
create policy mobile_devices_auth_service on mobile_devices for all to auth_service
  using (true) with check (true);
--> statement-breakpoint
create policy mobile_devices_read on mobile_devices for select to app_user, app_reader
  using (user_id = (select app.user_id())
         or (select app.has_perm('field.device.revoke:all'))
         or ((select app.has_perm('field.device.revoke:entity'))
             and exists (select 1 from user_entity_roles uer
                          where uer.user_id = mobile_devices.user_id
                            and uer.entity_id = any ((select app.entity_ids())::int[]))));
--> statement-breakpoint
create policy mobile_devices_revoke on mobile_devices for update to app_user
  using ((select app.has_perm('field.device.revoke:all'))
         or ((select app.has_perm('field.device.revoke:entity'))
             and exists (select 1 from user_entity_roles uer
                          where uer.user_id = mobile_devices.user_id
                            and uer.entity_id = any ((select app.entity_ids())::int[]))))
  with check (revoked_at is not null
              and ((select app.has_perm('field.device.revoke:all'))
                   or ((select app.has_perm('field.device.revoke:entity'))
                       and exists (select 1 from user_entity_roles uer
                                    where uer.user_id = mobile_devices.user_id
                                      and uer.entity_id = any ((select app.entity_ids())::int[])))));
--> statement-breakpoint
revoke all on mobile_devices
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert, update on mobile_devices to auth_service;
--> statement-breakpoint
grant select (id, user_id, platform, name, os_version, app_version, signed_in_at, last_seen_at,
              revoked_at, revoked_reason, revoked_by, created_at, updated_at)
  on mobile_devices to app_user, app_reader;
--> statement-breakpoint
grant update (revoked_at, revoked_reason, revoked_by) on mobile_devices to app_user;
--> statement-breakpoint

-- 3. feature_flags
alter table feature_flags enable row level security;
--> statement-breakpoint
alter table feature_flags force row level security;
--> statement-breakpoint
create policy feature_flags_read on feature_flags for select to app_user, app_reader
  using ((select app.user_id()) is not null
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy feature_flags_insert on feature_flags for insert to app_user
  with check ((select app.has_perm('admin.flags.write:all'))
              and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy feature_flags_update on feature_flags for update to app_user
  using ((select app.has_perm('admin.flags.write:all'))
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('admin.flags.write:all'))
              and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
revoke all on feature_flags
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert, update on feature_flags to app_user;
--> statement-breakpoint
grant select on feature_flags to app_reader;
