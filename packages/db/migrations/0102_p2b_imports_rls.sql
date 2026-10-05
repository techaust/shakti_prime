-- The imports upgrade (docs/design/phase1.md §6.3): the PIN code master, the site's PIN filled
-- from it, and import files on the pre-signed upload path.

-- pin_codes: one row per post office of the public India Post directory, shared by every company.
-- Every request reads it (the lead and site forms, the site trigger below); only the `pin_codes`
-- import writes it: an Executive (imports.write at scope all) in a request for every active company
-- (app.request_covers_group(), 0019), as the shared catalogue is written (0070).
create trigger set_updated_at before update on pin_codes for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table pin_codes enable row level security;
--> statement-breakpoint
alter table pin_codes force row level security;
--> statement-breakpoint
create policy pin_codes_read on pin_codes for select to app_user, app_reader
  using ((select app.user_id()) is not null);
--> statement-breakpoint
create policy pin_codes_insert on pin_codes for insert to app_user
  with check ((select app.has_perm('imports.write:all'))
              and (select app.request_covers_group())
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy pin_codes_update on pin_codes for update to app_user
  using ((select app.has_perm('imports.write:all')) and (select app.request_covers_group()))
  with check ((select app.has_perm('imports.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
-- Rolling back a PIN import removes the offices it added.
create policy pin_codes_delete on pin_codes for delete to app_user
  using ((select app.has_perm('imports.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
grant select, insert, delete on pin_codes to app_user;
--> statement-breakpoint
-- An office's PIN and name are what it is; an import corrects only what the directory says of it.
grant update (taluk, district, state_code, updated_at, updated_by) on pin_codes to app_user;
--> statement-breakpoint
grant select on pin_codes to app_reader;
--> statement-breakpoint

-- A site's PIN (PRD CRM-02): a PIN in the master fills the tehsil, district and state the site
-- does not give, where every office of the PIN agrees on them; a PIN outside the master saves the
-- site and flags it for review (`pin_needs_review`). Every way a site is written goes through
-- here, the lead form, the customer screens and the set-based import alike. When the PIN of an
-- existing site changes, what the old PIN filled gives way to what the new one says, unless the
-- same statement set it. An invoker function: the master is readable by every request.
create or replace function app.customer_sites_pin_fill() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_known boolean;
  v_taluk text;
  v_district text;
  v_state text;
begin
  if new.pin is null then
    new.pin_needs_review := false;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.pin is not distinct from old.pin then
    return new;
  end if;
  select count(*) > 0,
         case when count(distinct p.taluk) = 1 and count(p.taluk) = count(*) then min(p.taluk) end,
         case when count(distinct p.district) = 1 then min(p.district) end,
         case when count(distinct p.state_code) = 1 and count(p.state_code) = count(*)
              then min(p.state_code) end
    into v_known, v_taluk, v_district, v_state
    from public.pin_codes p
   where p.pin = new.pin;
  new.pin_needs_review := not v_known;
  if not v_known then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tehsil := coalesce(new.tehsil, v_taluk);
    new.district := coalesce(new.district, v_district);
    new.state_code := coalesce(new.state_code, v_state);
  else
    if new.tehsil is not distinct from old.tehsil then
      new.tehsil := coalesce(v_taluk, new.tehsil);
    end if;
    if new.district is not distinct from old.district then
      new.district := coalesce(v_district, new.district);
    end if;
    if new.state_code is not distinct from old.state_code then
      new.state_code := coalesce(v_state, new.state_code);
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger customer_sites_pin_fill before insert or update of pin on customer_sites
  for each row execute function app.customer_sites_pin_fill();
--> statement-breakpoint

-- Import files now arrive by the pre-signed upload (docs/API.md §3.2) and pass the same checks as
-- every other upload, so a person's upload of any purpose starts as pending; the exception for an
-- import file stored before its job (0066) is gone.
drop policy files_insert on files;
--> statement-breakpoint
create policy files_insert on files for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and ((select app.has_perm('files.process:entity'))
       or (app.has_perm(app.file_purpose_grant(purpose, 'write')) and status = 'pending')));
