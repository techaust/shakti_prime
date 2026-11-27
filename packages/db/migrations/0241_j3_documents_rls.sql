-- J3 Customer documents and requirements (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5,
-- §11 items 7 and 8): row security, grants, triggers and definers for the requirement templates,
-- the filed documents and what is kept of an identity document, and the readers and writers of
-- the customer_document file purpose.
--
-- documents.read and documents.write are scoped: entity (and all) reads and writes every document
-- of the company; own reads and writes the documents of customers the caller owns in the company
-- (account_entities.owner_id; J1's project assignee joins it when projects exist). A document of
-- an identity or bank paper is `sensitive` and is read, filed and unfiled only by a holder of
-- documents.sensitive.read for the company, which no agent principal holds
-- (AGENT_FORBIDDEN_PERMISSIONS). The reporting role reads none of the documents.

-- 1. updated_at
create trigger set_updated_at before update on document_requirements
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on documents
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. The purpose's grant. Its latest definition (0235) with customer_document's writer added: a
--    holder of documents.write at any scope uploads one, for a customer in that scope (the
--    restrictive policy below). Its readers are not a permission over every such file of the
--    company, so the general rule names none: the file is read with its document
--    (files_customer_document_read). packages/domain/src/files/purposes.ts mirrors this.
create or replace function app.file_purpose_grant(p_purpose text, p_access text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_access
    when 'write' then case p_purpose
      when 'import' then 'imports.write:entity'
      when 'quote_pdf' then 'files.process:entity'
      when 'signed_quote' then 'sales.quote.send:own'
      when 'entity_logo' then 'admin.entities.write:all'
      when 'letterhead' then 'admin.entities.write:all'
      when 'print_proof' then 'files.process:entity'
      when 'knowledge' then 'knowledge.vault.write:all'
      when 'consent_evidence' then 'crm.account.write:own'
      when 'vendor_quote' then 'procurement.rate.read:entity'
      when 'customer_document' then 'documents.write:own'
    end
    when 'read' then case p_purpose
      when 'import' then 'imports.write'
      when 'quote_pdf' then 'crm.lead.read'
      when 'signed_quote' then 'crm.lead.read'
      when 'entity_logo' then 'company'
      when 'letterhead' then 'company'
      when 'print_proof' then 'admin.entities.write'
      when 'consent_evidence' then 'crm.account.write'
      when 'vendor_quote' then 'procurement.rate.read'
    end
  end
$$;
--> statement-breakpoint

-- 3. Whether a file is filed now, whoever may read its document: the uploader's read of their own
--    upload ends once it is filed, so a sensitive document is never read through its upload.
create or replace function app.file_is_filed(p_file uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_perm('documents.write:own') or app.has_perm('files.process:entity')) then
    return false;
  end if;
  return exists (select 1 from public.documents d
                  where d.file_id = p_file and d.unfiled_at is null);
end
$$;
--> statement-breakpoint
revoke execute on function app.file_is_filed(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.file_is_filed(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. customer_document files. Read with a document that names it, under the documents' own rule
--    (so a sensitive one only with documents.sensitive.read), or by the person who uploaded it
--    while it is not filed, so they can file it. The worker's files.process reads every file of
--    its companies through files_read. An upload names a customer of the company the uploader may
--    file documents for, and only a customer document names one (files_account_check).
create policy files_customer_document_read on files for select to app_user, app_reader using (
  purpose = 'customer_document'
  and entity_id = any ((select app.entity_ids())::int[])
  and (exists (select 1 from documents d
                where d.file_id = files.id and d.entity_id = files.entity_id)
       or (created_by = (select app.user_id())
           and (select app.has_perm('documents.write:own'))
           and not app.file_is_filed(files.id))));
--> statement-breakpoint
create policy files_customer_document_insert on files as restrictive for insert to app_user
  with check (
    purpose <> 'customer_document'
    or exists (select 1 from account_entities ae
                where ae.account_id = files.account_id
                  and ae.entity_id = files.entity_id
                  and ((select app.has_perm('documents.write:entity'))
                       or ((select app.has_perm('documents.write:own'))
                           and ae.owner_id = (select app.user_id())))));
--> statement-breakpoint

-- 5. document_requirements: every principal acting in the company reads its requirements; only an
--    Executive (documents.write at all scope) adds or changes one, and only its settings change
--    afterwards. Nothing is deleted: a requirement is turned off.
alter table document_requirements enable row level security;
--> statement-breakpoint
alter table document_requirements force row level security;
--> statement-breakpoint
create policy document_requirements_read on document_requirements for select to app_user, app_reader
  using (entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy document_requirements_insert on document_requirements for insert to app_user
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('documents.write:all'))
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy document_requirements_update on document_requirements for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('documents.write:all')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('documents.write:all'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
revoke all on document_requirements from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on document_requirements to app_user;
--> statement-breakpoint
grant update (mandatory, accepted_kinds, position, active, updated_at, updated_by)
  on document_requirements to app_user;
--> statement-breakpoint
grant select on document_requirements to app_reader, readonly_reporter;
--> statement-breakpoint

-- 6. documents. The read rule is stated inline: the company, the scope (entity, or own through the
--    customer's owner in the company) and the sensitivity, each test an initplan but the owner's.
alter table documents enable row level security;
--> statement-breakpoint
alter table documents force row level security;
--> statement-breakpoint
create policy documents_read on documents for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('documents.read:entity'))
       or ((select app.has_perm('documents.read:own'))
           and exists (select 1 from account_entities ae
                        where ae.account_id = documents.account_id
                          and ae.entity_id = documents.entity_id
                          and ae.owner_id = (select app.user_id()))))
  and (not sensitive or (select app.has_perm('documents.sensitive.read:entity'))));
--> statement-breakpoint
-- A person files a document as themselves, for a customer the company knows and within their
-- scope; a sensitive one only with documents.sensitive.read. The classifier's filing (J7) is the
-- platform's, through a definer of its own.
create policy documents_insert on documents for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and filed_by = (select app.user_id())
  and filed_by_kind = 'person'
  and unfiled_at is null
  and exists (select 1 from account_entities ae
               where ae.account_id = documents.account_id
                 and ae.entity_id = documents.entity_id
                 and ((select app.has_perm('documents.write:entity'))
                      or ((select app.has_perm('documents.write:own'))
                          and ae.owner_id = (select app.user_id()))))
  and (not sensitive or (select app.has_perm('documents.sensitive.read:entity'))));
--> statement-breakpoint
-- Unfiling: the writer's scope over the customer, and the sensitivity; only the unfiling columns
-- change (column grants), and only once (the guard).
create policy documents_unfile on documents for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and unfiled_at is null
         and exists (select 1 from account_entities ae
                      where ae.account_id = documents.account_id
                        and ae.entity_id = documents.entity_id
                        and ((select app.has_perm('documents.write:entity'))
                             or ((select app.has_perm('documents.write:own'))
                                 and ae.owner_id = (select app.user_id()))))
         and (not sensitive or (select app.has_perm('documents.sensitive.read:entity'))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and unfiled_by = (select app.user_id()));
--> statement-breakpoint
create or replace function app.documents_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.unfiled_at is not null then
    raise exception 'an unfiled document stays unfiled' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger documents_guard_update before update on documents
  for each row execute function app.documents_guard_update();
--> statement-breakpoint
revoke all on documents from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on documents to app_user;
--> statement-breakpoint
grant update (unfiled_at, unfiled_by, unfiled_reason, updated_at) on documents to app_user;
--> statement-breakpoint
grant select on documents to app_reader;
--> statement-breakpoint

-- 7. identity_documents: the last four digits, read with their document while it stays filed, and
--    only with documents.sensitive.read; written once, by the person filing the document, in the
--    same transaction. Never changed or removed by a request.
alter table identity_documents enable row level security;
--> statement-breakpoint
alter table identity_documents force row level security;
--> statement-breakpoint
create policy identity_documents_read on identity_documents for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('documents.sensitive.read:entity'))
  and exists (select 1 from documents d
               where d.id = identity_documents.document_id
                 and d.entity_id = identity_documents.entity_id
                 and d.unfiled_at is null));
--> statement-breakpoint
create policy identity_documents_insert on identity_documents for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('documents.sensitive.read:entity'))
  and created_by = (select app.user_id())
  and exists (select 1 from documents d
               where d.id = identity_documents.document_id
                 and d.entity_id = identity_documents.entity_id
                 and d.account_id = identity_documents.account_id
                 and d.file_id = identity_documents.masked_file_id
                 and d.filed_by = (select app.user_id())
                 and d.sensitive
                 and d.unfiled_at is null));
--> statement-breakpoint
revoke all on identity_documents from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on identity_documents to app_user;
--> statement-breakpoint
grant select on identity_documents to app_reader;
--> statement-breakpoint

-- 8. The completeness check (PRJ-03): the mandatory, active requirement keys of a flow's step in a
--    company that the customer has no filed document of an accepted kind for, counting the
--    customer's own documents and the project's, in position order. A definer, so a step's guard
--    counts a sensitive document its caller cannot read; it answers keys only. J1's
--    app.project_missing_documents(project_id, step_key) reads the project's company, customer and
--    flow and calls this.
create or replace function app.documents_missing(
  p_entity_id smallint, p_account_id uuid, p_project_id uuid, p_flow text, p_step_key text
) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
          and (app.has_perm('documents.read:own') or app.has_perm('projects.read:own')
               or app.has_perm('projects.write:own'))) then
    raise exception 'documents_missing needs documents.read or projects.read in the company'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select array_agg(r.requirement_key order by r.position, r.requirement_key)
      from public.document_requirements r
     where r.entity_id = p_entity_id
       and r.flow = p_flow
       and r.step_key = p_step_key
       and r.active
       and r.mandatory
       and not exists (
         select 1 from public.documents d
          where d.entity_id = p_entity_id
            and d.account_id = p_account_id
            and d.unfiled_at is null
            and d.requirement_key = r.requirement_key
            and d.kind = any (r.accepted_kinds)
            and (d.project_id is null or d.project_id = p_project_id))), '{}'::text[]);
end
$$;
--> statement-breakpoint
revoke execute on function app.documents_missing(smallint, uuid, uuid, text, text)
  from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.documents_missing(smallint, uuid, uuid, text, text)
  to app_user, app_reader;
