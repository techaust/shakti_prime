-- Uploads (docs/DATABASE.md §6.10, docs/design/phase1.md §5.3). Each file purpose names the
-- permission that may create a file of it and the one that may read it; the mapping lives here
-- once, in app.file_purpose_grant(), and packages/domain/src/files/purposes.ts mirrors it (a test
-- in packages/domain/tests compares the two). A purpose it does not name can be neither written
-- nor read by a request: the field photos wait for their modules, the vault for K1.
--
-- Write: the permission at the scope given ('key:scope'). A quote's PDF is stored only by the
-- render worker; a signed quote by whoever may accept a quote (no agent holds either). Read:
-- 'company' for a file every
-- principal of the company may see (a logo, a letterhead: every document prints them), else the
-- permission's key: a holder at entity scope reads every such file of the company, a narrower
-- holder the files they uploaded. The worker principal (files.process) reads every file of its
-- companies, records the files it makes and moves a file through its checks.
create or replace function app.file_purpose_grant(p_purpose text, p_access text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_access
    when 'write' then case p_purpose
      when 'import' then 'imports.write:entity'
      when 'quote_pdf' then 'files.process:entity'
      when 'signed_quote' then 'sales.quote.send:own'
      when 'entity_logo' then 'admin.entities.write:all'
      when 'letterhead' then 'admin.entities.write:all'
      when 'consent_evidence' then 'crm.account.write:own'
    end
    when 'read' then case p_purpose
      when 'import' then 'imports.write'
      when 'quote_pdf' then 'crm.lead.read'
      when 'signed_quote' then 'crm.lead.read'
      when 'entity_logo' then 'company'
      when 'letterhead' then 'company'
      when 'consent_evidence' then 'crm.account.write'
    end
  end
$$;
--> statement-breakpoint
drop policy files_read on files;
--> statement-breakpoint
drop policy files_insert on files;
--> statement-breakpoint
-- The queries' own role reads under the same rule (0062's reader, docs/DATABASE.md §3).
create policy files_read on files for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('files.process:entity'))
       or app.file_purpose_grant(purpose, 'read') = 'company'
       or app.has_perm(app.file_purpose_grant(purpose, 'read') || ':entity')
       or (created_by = (select app.user_id())
           and app.has_perm(app.file_purpose_grant(purpose, 'read') || ':own'))));
--> statement-breakpoint
-- A person's upload starts as pending (an import file, stored before its job, as ready); the
-- worker records the files it makes itself.
create policy files_insert on files for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and ((select app.has_perm('files.process:entity'))
       or (app.has_perm(app.file_purpose_grant(purpose, 'write'))
           and (purpose = 'import' or status = 'pending'))));
--> statement-breakpoint
-- The uploader marks their own pending upload complete, which starts the checks.
create policy files_complete on files for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and created_by = (select app.user_id())
         and status = 'pending'
         and app.has_perm(app.file_purpose_grant(purpose, 'write')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and created_by = (select app.user_id())
              and status = 'scanning');
--> statement-breakpoint
-- The worker moves a file through its checks and records the checked copy.
create policy files_process on files for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('files.process:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('files.process:entity')));
--> statement-breakpoint
-- Only the status and the checks' columns change, never what the file is, whose or where from.
grant update (status, scan_result, key, content_type, size, sha256, updated_at, updated_by)
  on files to app_user;
--> statement-breakpoint
-- A person changes only a file's status (completing their upload); the checked copy's key, type,
-- size, checksum and the scan result are the worker's to record. Every change names who made it
-- and when, whatever the statement said.
create or replace function app.files_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(app.user_id(), new.updated_by);
  new.updated_at := pg_catalog.now();
  if not app.has_perm('files.process:entity')
     and (new.key is distinct from old.key
          or new.content_type is distinct from old.content_type
          or new.size is distinct from old.size
          or new.sha256 is distinct from old.sha256
          or new.scan_result is distinct from old.scan_result) then
    raise exception 'only the file checks change a stored file'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger files_guard_update before update on files
  for each row execute function app.files_guard_update();
