-- U1 Vendors and supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3): a supplier's quote
-- document (purpose vendor_quote) shows the rate, so it is uploaded and read only with
-- procurement.rate.read: a holder for the company reads every such file of the company, as the
-- files policies read every purpose's permission. The function is its latest definition (0123)
-- with the one purpose added; packages/domain/src/files/purposes.ts mirrors it and a test compares
-- the two.
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
