-- Print and letterhead (docs/design/phase1.md §6.4, ADR 0009).
--
-- 1. A company's bank account (`entities.bank_json`) is sealed by the field cipher in the app
--    (AES-256-GCM under a KMS data key, docs/SECURITY.md §5); the database never sees it in clear.
--    No request role may select the sealed value either: every other column of `entities` is
--    granted by name (`bank_details_set` says whether an account is recorded), and the value is
--    read only through app.entity_bank_envelope(), which checks the caller in its body. A column
--    added to `entities` later is granted by name as well (grants.test.ts checks every column but
--    `bank_json`).
revoke select on entities from app_user, app_reader, readonly_reporter;
--> statement-breakpoint
grant select (id, code, legal_name, brand_name, gstin, state_code, upi_id, address_line1,
               address_line2, city, pin, bank_details_set, archived_at, created_at, updated_at,
               created_by, updated_by)
  on entities to app_user, app_reader, readonly_reporter;
--> statement-breakpoint
-- The sealed bank account of one company in the request, for an Executive changing it
-- (admin.entities.write at all scope) or the render worker printing it (files.process, held by
-- the worker principal alone); null when none is recorded. Anyone else is refused, whatever
-- companies the request names.
create or replace function app.entity_bank_envelope(p_entity_id smallint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bank jsonb;
begin
  if app.user_id() is null
     or not (p_entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not (app.has_perm('admin.entities.write:all') or app.has_perm('files.process:entity')) then
    raise exception 'admin.entities.write:all or files.process is required' using errcode = '42501';
  end if;
  select e.bank_json into v_bank from public.entities e where e.id = p_entity_id;
  return v_bank;
end
$$;
--> statement-breakpoint
revoke execute on function app.entity_bank_envelope(smallint) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.entity_bank_envelope(smallint) to app_user, app_reader;
--> statement-breakpoint
-- 2. A company's proof page (`print_proof`): stored only by the render worker, read by an
--    Executive, who asked for it. It prints the bank account, so it is not a company-wide file
--    like the logo and the letterhead.
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
      when 'consent_evidence' then 'crm.account.write:own'
    end
    when 'read' then case p_purpose
      when 'import' then 'imports.write'
      when 'quote_pdf' then 'crm.lead.read'
      when 'signed_quote' then 'crm.lead.read'
      when 'entity_logo' then 'company'
      when 'letterhead' then 'company'
      when 'print_proof' then 'admin.entities.write'
      when 'consent_evidence' then 'crm.account.write'
    end
  end
$$;
