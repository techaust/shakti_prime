-- Q1 Labels (docs/03-roadmap-appendix/phase3.md §7.4). A sheet of QR labels is a PDF the render
-- worker prints and stores as a `label_sheet` file: stored only by the worker (files.process) and
-- read by the stock handlers who print labels (inventory.stock.move). The function is its latest
-- definition (0235) with the one purpose added; packages/domain/src/files/purposes.ts mirrors it
-- and a test compares the two.
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
    end
  end
$$;
--> statement-breakpoint

-- What a sheet of labels prints, read by the render worker (`system:workers`, which holds no
-- inventory grant, ADR 0020): for serials, each one's number, item, SKU and company, only of the
-- request's companies; for bins, each live bin's code and its hub, which the group shares. Rows
-- come back in the order of p_ids, each id once; an id the worker may not print is left out. Only
-- a holder of files.process calls it.
create or replace function app.labels_for_print(p_kind text, p_ids uuid[]) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_labels jsonb;
begin
  if app.user_id() is null or not app.has_perm('files.process:entity') then
    raise exception 'files.process is required' using errcode = '42501';
  end if;
  if cardinality(coalesce(app.entity_ids(), '{}'::int[])) = 0 then
    raise exception 'no company in the request' using errcode = '42501';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'at most 500 labels in a sheet' using errcode = '22023';
  end if;
  if p_kind = 'serial' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id,
             'serialNo', s.serial_no,
             'sku', i.sku,
             'itemName', i.name,
             'companyName', e.brand_name) order by o.ord), '[]'::jsonb)
      into v_labels
      from (select distinct on (u.id) u.id, u.ord
              from unnest(p_ids) with ordinality as u(id, ord)
             order by u.id, u.ord) o
      join public.serials s on s.id = o.id
      join public.items i on i.id = s.item_id
      join public.entities e on e.id = s.entity_id
     where s.entity_id = any (app.entity_ids());
  elsif p_kind = 'bin' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id,
             'binCode', b.code,
             'hubCode', w.code,
             'hubName', w.name) order by o.ord), '[]'::jsonb)
      into v_labels
      from (select distinct on (u.id) u.id, u.ord
              from unnest(p_ids) with ordinality as u(id, ord)
             order by u.id, u.ord) o
      join public.bins b on b.id = o.id
      join public.warehouses w on w.id = b.warehouse_id
     where b.archived_at is null;
  else
    return null;
  end if;
  return jsonb_build_object('labelKind', p_kind, 'labels', v_labels);
end
$$;
--> statement-breakpoint
revoke execute on function app.labels_for_print(text, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.labels_for_print(text, uuid[]) to app_user, app_reader;
