-- FN1 the proforma's PDF (docs/03-roadmap-appendix/phase5.md §6.1): a proforma's PDF (purpose
-- proforma_pdf) prints the company's bank account and UPI ID, so it is stored only by the render
-- worker (files.process) and read with finance.read: a holder for the company reads every such
-- file of the company, as the files policies read every purpose's permission, and a narrower
-- holder (a Lead Converter, a Sales Lead) reads it with the proforma that names it. The worker
-- reads a proforma and attaches its PDF only through the two definers below.

-- 1. app.file_purpose_grant(): its latest definition (Q1's, with label_sheet) with the one purpose
--    added;
--    packages/domain/src/files/purposes.ts mirrors it and a test compares the two.
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
      when 'proforma_pdf' then 'files.process:entity'
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
      when 'proforma_pdf' then 'finance.read'
    end
  end
$$;
--> statement-breakpoint

-- 2. A proforma's PDF is read with its proforma (proformas_read: finance.read over the order).
create policy files_proforma_pdf_read on files for select to app_user, app_reader using (
  purpose = 'proforma_pdf'
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from proformas p
               where p.pdf_file_id = files.id
                 and p.entity_id = files.entity_id));
--> statement-breakpoint

-- 3. One proforma as the render worker prints it: the proforma, its order's number, its lines as
--    copied, the customer's name, GSTIN and the order's site address, who issued it, and the
--    order's payments; never a phone number. Only the worker principal (files.process) may call
--    it; null for a proforma outside the request.
create or replace function app.proforma_for_print(p_proforma uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_proforma jsonb;
begin
  if app.user_id() is null or not app.has_perm('files.process:entity') then
    raise exception 'files.process is required' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object(
           'id', p.id,
           'entityId', p.entity_id,
           'proformaNo', p.proforma_no,
           'state', p.state,
           'createdAt', p.created_at,
           'soNo', so.so_no,
           'placeOfSupplyState', p.place_of_supply_state,
           'supplyKind', p.supply_kind,
           'subtotal', p.subtotal::text,
           'cgst', p.cgst::text,
           'sgst', p.sgst::text,
           'igst', p.igst::text,
           'roundOff', p.round_off::text,
           'grandTotal', p.grand_total::text,
           'customerName', a.name,
           'customerGstin', a.gstin,
           'site', case when cs.id is null then null else pg_catalog.jsonb_build_object(
                     'address', cs.address, 'village', cs.village, 'tehsil', cs.tehsil,
                     'district', cs.district, 'pin', cs.pin) end,
           'preparedBy', pr.display_name,
           'lines', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                              'position', l.position,
                              'sku', l.sku,
                              'description', l.description,
                              'unit', l.unit,
                              'qty', l.qty::text,
                              'unitPrice', l.unit_price::text,
                              'hsn', l.hsn,
                              'taxRatePct', l.tax_rate_pct::text,
                              'goodsRatePct', l.goods_rate_pct::text,
                              'servicesRatePct', l.services_rate_pct::text,
                              'taxableValue', l.taxable_value::text,
                              'cgst', l.cgst::text,
                              'sgst', l.sgst::text,
                              'igst', l.igst::text) order by l.position), '[]'::jsonb)
                       from public.proforma_lines l where l.proforma_id = p.id),
           'milestones', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                   'label', m.label,
                                   'amount', m.amount::text,
                                   'dueRule', m.due_rule,
                                   'dueDays', m.due_days,
                                   'state', m.state) order by m.seq), '[]'::jsonb)
                            from public.payment_milestones m
                           where m.sales_order_id = p.sales_order_id))
    into v_proforma
    from public.proformas p
    join public.sales_orders so on so.id = p.sales_order_id
    join public.accounts a on a.id = so.account_id
    left join public.customer_sites cs on cs.id = so.site_id
    left join public.principals pr on pr.id = p.created_by
   where p.id = p_proforma
     and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  return v_proforma;
end
$$;
--> statement-breakpoint
revoke execute on function app.proforma_for_print(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.proforma_for_print(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. Attaches the PDF the render worker recorded to its proforma: a ready proforma_pdf file of
--    the proforma's company, on a proforma of the request with no PDF yet or this one already.
--    Only the worker principal (files.process) may call it. Answers whether the proforma now
--    names the file.
create or replace function app.attach_proforma_pdf(p_entity smallint, p_proforma uuid, p_file uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attached uuid;
begin
  if app.user_id() is null or not app.has_perm('files.process:entity') then
    raise exception 'files.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not exists (select 1 from public.files f
                  where f.id = p_file and f.entity_id = p_entity
                    and f.purpose = 'proforma_pdf' and f.status = 'ready') then
    return false;
  end if;
  update public.proformas p
     set pdf_file_id = p_file,
         updated_by = app.user_id()
   where p.id = p_proforma
     and p.entity_id = p_entity
     and (p.pdf_file_id is null or p.pdf_file_id = p_file)
  returning p.pdf_file_id into v_attached;
  return v_attached is not null;
end
$$;
--> statement-breakpoint
revoke execute on function app.attach_proforma_pdf(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_proforma_pdf(smallint, uuid, uuid) to app_user;
