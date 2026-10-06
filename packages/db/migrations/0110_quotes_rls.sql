-- Quotes (docs/design/phase1.md §7.3, docs/DATABASE.md §6.4): children of a lead.
--
-- A quote is read with its lead (the EXISTS runs under opportunities_read) and made by whoever
-- holds sales.quote.create over the lead's owner and team, as the caller. Its lines are written
-- only in the transaction that made the quote (`created_at = now()`, the transaction's start),
-- by its maker, while it is a draft, and never changed: a quote's prices, taxes and totals are
-- frozen when it is made (BLUEPRINT §8.3). Afterwards a person changes only its state and the
-- reason it was withdrawn (column grants), with sales.quote.send or sales.quote.create over the
-- lead; the quote machine in packages/domain decides which moves are allowed. Its versions are
-- append-only. The queries' own role, app_reader, reads under the same policies.

create trigger set_updated_at before update on quotes
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger quote_lines_append_only before update or delete on quote_lines
  for each row execute function app.raise_append_only();
--> statement-breakpoint
create trigger quote_versions_append_only before update or delete on quote_versions
  for each row execute function app.raise_append_only();
--> statement-breakpoint

alter table quotes enable row level security;
--> statement-breakpoint
alter table quotes force row level security;
--> statement-breakpoint
alter table quote_lines enable row level security;
--> statement-breakpoint
alter table quote_lines force row level security;
--> statement-breakpoint
alter table quote_versions enable row level security;
--> statement-breakpoint
alter table quote_versions force row level security;
--> statement-breakpoint

create policy quotes_read on quotes for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = quotes.opportunity_id));
--> statement-breakpoint
create policy quotes_insert on quotes for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and state = 'draft'
  and pdf_file_id is null
  and withdrawn_reason is null
  and exists (select 1 from opportunities o
               where o.id = quotes.opportunity_id
                 and o.account_id = quotes.account_id
                 and o.archived_at is null
                 and o.site_id is not distinct from quotes.site_id
                 and app.scope_ok('sales.quote.create', o.owner_id, o.team_id)));
--> statement-breakpoint
create policy quotes_update on quotes for update to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o
               where o.id = quotes.opportunity_id
                 and (app.scope_ok('sales.quote.send', o.owner_id, o.team_id)
                      or app.scope_ok('sales.quote.create', o.owner_id, o.team_id))))
with check (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o
               where o.id = quotes.opportunity_id
                 and (app.scope_ok('sales.quote.send', o.owner_id, o.team_id)
                      or app.scope_ok('sales.quote.create', o.owner_id, o.team_id))));
--> statement-breakpoint

create policy quote_lines_read on quote_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from quotes q where q.id = quote_lines.quote_id));
--> statement-breakpoint
create policy quote_lines_insert on quote_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from quotes q
               where q.id = quote_lines.quote_id
                 and q.entity_id = quote_lines.entity_id
                 and q.state = 'draft'
                 and q.created_by = (select app.user_id())
                 and q.created_at = now()));
--> statement-breakpoint

create policy quote_versions_read on quote_versions for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from quotes q where q.id = quote_versions.quote_id));
--> statement-breakpoint
create policy quote_versions_insert on quote_versions for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from quotes q
                join opportunities o on o.id = q.opportunity_id
               where q.id = quote_versions.quote_id
                 and q.entity_id = quote_versions.entity_id
                 and app.scope_ok('sales.quote.create', o.owner_id, o.team_id)));
--> statement-breakpoint

grant select, insert on quotes to app_user;
--> statement-breakpoint
grant update (state, state_changed_at, withdrawn_reason, updated_at, updated_by) on quotes to app_user;
--> statement-breakpoint
grant select, insert on quote_lines, quote_versions to app_user;
--> statement-breakpoint
grant select on quotes, quote_lines, quote_versions to app_reader, readonly_reporter;
--> statement-breakpoint

-- The daily expiry runs as the worker principal `system:workers`, which holds no sales.* or crm.*
-- permission a person may hold (ADR 0020). It holds instead the platform-only permission
-- sales.quote.expire, which no person's role and no agent may hold, and reaches quotes only
-- through the two definers below: one answers the lapsed draft and sent quotes of one company of
-- the request, the other marks those still lapsed as expired. The quote machine's expire guard
-- runs between them in packages/domain. The list keeps every platform-only permission defined
-- before it: the file checks', the import worker's and the nightly lead rescoring's.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'sales.quote.expire']::text[]
$$;
--> statement-breakpoint

-- The next draft or sent quotes of one company of the request whose validity has passed, in id
-- order after p_after, at most p_limit (1,000 at most).
create or replace function app.lapsed_quotes(p_entity smallint, p_after uuid, p_limit integer)
  returns table (quote_id uuid, opportunity_id uuid, quote_state text, valid_until timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('sales.quote.expire:entity') then
    raise exception 'sales.quote.expire is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select q.id, q.opportunity_id, q.state, q.valid_until
      from public.quotes q
     where q.entity_id = p_entity
       and q.state in ('draft', 'sent')
       and q.valid_until < now()
       and (p_after is null or q.id > p_after)
     order by q.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.lapsed_quotes(smallint, uuid, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.lapsed_quotes(smallint, uuid, integer) to app_user;
--> statement-breakpoint

-- Marks the named quotes of one company of the request expired, each only if it is still a draft
-- or sent quote past its validity; the caller and the time are stamped as the change. Answers the
-- quotes it changed and their leads.
create or replace function app.expire_quotes(p_entity smallint, p_ids uuid[])
  returns table (quote_id uuid, opportunity_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('sales.quote.expire:entity') then
    raise exception 'sales.quote.expire is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    update public.quotes q
       set state = 'expired',
           state_changed_at = now(),
           updated_by = app.user_id()
     where q.entity_id = p_entity
       and q.id = any (coalesce(p_ids, '{}'::uuid[]))
       and q.state in ('draft', 'sent')
       and q.valid_until < now()
    returning q.id, q.opportunity_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.expire_quotes(smallint, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.expire_quotes(smallint, uuid[]) to app_user;
--> statement-breakpoint

-- What the render worker prints of one quote of the request (ADR 0009): the quote, its lines, the
-- customer's name and GSTIN, the site's address and the name of the person who made it. Only the
-- worker principal (files.process) may call it: it reads no customer row beyond these and never a
-- phone number. Null for a quote outside the request.
create or replace function app.quote_for_print(p_quote uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_quote jsonb;
begin
  if app.user_id() is null or not app.has_perm('files.process:entity') then
    raise exception 'files.process is required' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', q.id,
           'entityId', q.entity_id,
           'quoteNo', q.quote_no,
           'createdAt', q.created_at,
           'validUntil', q.valid_until,
           'placeOfSupplyState', q.place_of_supply_state,
           'supplyKind', q.supply_kind,
           'subtotal', q.subtotal::text,
           'cgst', q.cgst::text,
           'sgst', q.sgst::text,
           'igst', q.igst::text,
           'roundOff', q.round_off::text,
           'grandTotal', q.grand_total::text,
           'customerName', a.name,
           'customerGstin', a.gstin,
           'site', case when cs.id is null then null else jsonb_build_object(
                     'address', cs.address, 'village', cs.village, 'tehsil', cs.tehsil,
                     'district', cs.district, 'pin', cs.pin) end,
           'preparedBy', p.display_name,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
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
                       from public.quote_lines l where l.quote_id = q.id))
    into v_quote
    from public.quotes q
    join public.accounts a on a.id = q.account_id
    left join public.customer_sites cs on cs.id = q.site_id
    left join public.principals p on p.id = q.created_by
   where q.id = p_quote
     and q.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  return v_quote;
end
$$;
--> statement-breakpoint
revoke execute on function app.quote_for_print(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.quote_for_print(uuid) to app_user, app_reader;
--> statement-breakpoint

-- Attaches the PDF the render worker recorded to its quote: a ready `quote_pdf` file of the
-- quote's company, on a quote of the request with no PDF yet or this one already. Only the worker
-- principal (files.process) may call it. Answers whether the quote now names the file.
create or replace function app.attach_quote_pdf(p_entity smallint, p_quote uuid, p_file uuid)
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
                    and f.purpose = 'quote_pdf' and f.status = 'ready') then
    return false;
  end if;
  update public.quotes q
     set pdf_file_id = p_file,
         updated_by = app.user_id()
   where q.id = p_quote
     and q.entity_id = p_entity
     and (q.pdf_file_id is null or q.pdf_file_id = p_file)
  returning q.pdf_file_id into v_attached;
  return v_attached is not null;
end
$$;
--> statement-breakpoint
revoke execute on function app.attach_quote_pdf(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_quote_pdf(smallint, uuid, uuid) to app_user;
--> statement-breakpoint

-- A customer's price tier decides every price on their quotes (PRICE-1), so it is set only by a
-- holder of pricing.write for all companies (`crm.account.tier.set`, an Executive), never by the
-- customer writers who may change the rest of the row: a request that sets or changes tier_id
-- without it is refused. The owner's own writes (the seed, the fixtures) carry no request.
create or replace function app.guard_account_tier() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app.user_id() is not null
     and (tg_op = 'INSERT' and new.tier_id is not null
          or tg_op = 'UPDATE' and new.tier_id is distinct from old.tier_id)
     and not app.has_perm('pricing.write:all') then
    raise exception 'a customer''s price tier needs pricing.write for all companies'
      using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_account_tier() from public, readonly_reporter;
--> statement-breakpoint
create trigger accounts_tier_guard before insert or update of tier_id on accounts
  for each row execute function app.guard_account_tier();
--> statement-breakpoint

-- The ⌘K search's candidate quotes (RPT-03). Under the policies Postgres will not use `ilike` as an
-- index condition (it is not leakproof), so a search would test every quote in the caller's scope.
-- This answers the ids of at most 200 quotes of the request's companies whose number holds the
-- typed text, found on quotes_quote_no_trgm_idx, a number that is the text first, then the newest;
-- the search then reads only those under the policies, so what the caller sees is what RLS allows.
-- Ids only, for a signed-in caller who reads leads.
create or replace function app.quote_search_ids(p_text text, p_limit integer) returns setof uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_pattern text := '%' || replace(replace(replace(coalesce(p_text, ''), '\', '\'), '%', '\%'), '_', '\_') || '%';
begin
  if app.user_id() is null or not app.has_perm('crm.lead.read:own') then
    raise exception 'crm.lead.read is required' using errcode = '42501';
  end if;
  return query
    select q.id
      from public.quotes q
     where q.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and q.quote_no ilike v_pattern
     order by lower(q.quote_no) = lower(p_text) desc, q.created_at desc, q.id desc
     limit least(greatest(coalesce(p_limit, 0), 0), 200);
end
$$;
--> statement-breakpoint
revoke execute on function app.quote_search_ids(text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.quote_search_ids(text, integer) to app_user, app_reader;
