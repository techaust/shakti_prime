-- U2 the purchase order's PDF through the render worker (docs/runs/phase3/u2-purchase-orders.md,
-- review R2; ADR 0009). The PDF prints the order's rates (the vendor's copy), so it is a
-- `purchase_order_pdf` file stored only by the worker (files.process) and read only with
-- procurement.rate.read in its company, as a supplier's quote document is (`vendor_quote`); the
-- General Manager and the Store Manager, who read orders without values, never open it. The
-- function is its latest definition (Q1's, with `label_sheet`) with the one purpose added;
-- packages/domain/src/files/purposes.ts mirrors it and a test compares the two.
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
      when 'label_sheet' then 'files.process:entity'
      when 'purchase_order_pdf' then 'files.process:entity'
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
      when 'label_sheet' then 'inventory.stock.move'
      when 'purchase_order_pdf' then 'procurement.rate.read'
    end
  end
$$;
