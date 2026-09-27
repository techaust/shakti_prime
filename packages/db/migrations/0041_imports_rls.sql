-- Import framework (docs/design/backend-weeks-3-5.md §8, docs/DATABASE.md §6.10): files, mapping
-- templates, jobs and rows. Every row belongs to one entity and is seen and written only with
-- imports.write in that entity (Executive all, General Manager entity; SECURITY §3.2). A row is
-- inserted only as the caller. What a file said never changes: the grants below leave out the
-- columns that record it, so only the working columns of a job or a row can be updated.

-- updated_at triggers
create trigger set_updated_at before update on files for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on import_mapping_templates for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on import_jobs for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on import_rows for each row execute function app.set_updated_at();
--> statement-breakpoint

-- files: an import file is visible to whoever may import in its entity
alter table files enable row level security;
--> statement-breakpoint
alter table files force row level security;
--> statement-breakpoint
create policy files_read on files for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and purpose = 'import'
  and (select app.has_perm('imports.write:entity')));
--> statement-breakpoint
create policy files_insert on files for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and purpose = 'import'
  and (select app.has_perm('imports.write:entity'))
  and created_by = (select app.user_id()));
--> statement-breakpoint

-- mapping templates
alter table import_mapping_templates enable row level security;
--> statement-breakpoint
alter table import_mapping_templates force row level security;
--> statement-breakpoint
create policy import_mapping_templates_read on import_mapping_templates for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity')));
--> statement-breakpoint
create policy import_mapping_templates_insert on import_mapping_templates for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity'))
  and created_by = (select app.user_id()));
--> statement-breakpoint

-- jobs
alter table import_jobs enable row level security;
--> statement-breakpoint
alter table import_jobs force row level security;
--> statement-breakpoint
create policy import_jobs_read on import_jobs for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity')));
--> statement-breakpoint
create policy import_jobs_insert on import_jobs for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity'))
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy import_jobs_update on import_jobs for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('imports.write:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('imports.write:entity')));
--> statement-breakpoint

-- rows follow their job (the EXISTS runs under the job's own policies)
alter table import_rows enable row level security;
--> statement-breakpoint
alter table import_rows force row level security;
--> statement-breakpoint
create policy import_rows_read on import_rows for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity'))
  and exists (select 1 from import_jobs j where j.id = import_rows.job_id));
--> statement-breakpoint
create policy import_rows_insert on import_rows for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.write:entity'))
  and created_by = (select app.user_id())
  and exists (select 1 from import_jobs j where j.id = import_rows.job_id));
--> statement-breakpoint
create policy import_rows_update on import_rows for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('imports.write:entity'))
         and exists (select 1 from import_jobs j where j.id = import_rows.job_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('imports.write:entity'))
              and exists (select 1 from import_jobs j where j.id = import_rows.job_id));
--> statement-breakpoint

-- grants: no delete anywhere; a file and a template are written once; a job and a row change
-- only in their working columns
grant select, insert on files, import_mapping_templates, import_jobs, import_rows to app_user;
--> statement-breakpoint
grant update (template_id, mapping_json, state, total_rows, valid_rows, invalid_rows, skipped_rows,
              committed_rows, failed_batch, updated_at, updated_by)
  on import_jobs to app_user;
--> statement-breakpoint
grant update (normalised_json, errors_json, dedupe_json, state, created_type, created_id,
              committed_batch, updated_at, updated_by)
  on import_rows to app_user;
--> statement-breakpoint
-- Reporting reads the jobs and templates; the rows hold what customers' files said, and stay out.
grant select on files, import_mapping_templates, import_jobs to readonly_reporter;
