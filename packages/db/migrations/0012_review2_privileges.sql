-- Second review (docs/reviews/2026-09-backend-review-phase0.md, part 2).
-- 1. The default privilege from 0000 gave readonly_reporter execute on every later function in
--    schema app, including the security-definer app.next_document_no(); the revoke in 0006 only
--    removed PUBLIC. Reporting must never issue numbers. Defaults now grant to app_user only and
--    the reporter keeps the read helpers by explicit grant.
-- 2. app.next_document_no() now also requires the permission that creates the document type, so
--    a principal with a context but no sales, finance, dispatch or purchase right cannot burn a
--    series.
alter default privileges in schema app revoke execute on functions from readonly_reporter;
--> statement-breakpoint
revoke execute on function app.next_document_no(smallint, text, text, text) from readonly_reporter;
--> statement-breakpoint
grant execute on function app.entity_ids(), app.user_id(), app.has_perm(text), app.team_id(),
  app.scope_ok(text, uuid, uuid), app.set_updated_at(), app.raise_append_only() to readonly_reporter;
--> statement-breakpoint
create or replace function app.next_document_no(
  p_entity smallint, p_doc_type text, p_fy text, p_prefix text
) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  v_no int;
  v_perm text;
begin
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity
      using errcode = 'insufficient_privilege';
  end if;
  v_perm := case p_doc_type
    when 'quote' then 'sales.quote.create:own'
    when 'sales_order' then 'sales.order.create:own'
    when 'proforma' then 'finance.proforma.write:own'
    when 'challan' then 'inventory.dispatch.write:own'
    when 'purchase_order' then 'procurement.po.write:own'
    else null end;
  if v_perm is null or not app.has_perm(v_perm) then
    raise exception 'permission % required to number a %', v_perm, p_doc_type
      using errcode = 'insufficient_privilege';
  end if;
  insert into document_sequences (id, entity_id, doc_type, fy, prefix)
  values (gen_random_uuid(), p_entity, p_doc_type, p_fy, p_prefix)
  on conflict (entity_id, doc_type, fy) do nothing;
  update document_sequences
     set next_no = next_no + 1
   where entity_id = p_entity and doc_type = p_doc_type and fy = p_fy
  returning next_no - 1 into v_no;
  return v_no;
end
$$;
--> statement-breakpoint
revoke all on function app.next_document_no(smallint, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.next_document_no(smallint, text, text, text) to app_user;
