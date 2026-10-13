-- The sales-integrity fixes of the Phase 0–1 audit (12-10-2026): DOM-1 to DOM-4, DOM-V1 and SEC-4.

-- 1. DOM-1. Whether a customer is a dealer decides whether the dealer credit check runs at an
--    order's confirmation and whether an order may be made without a quote (SAL-07, SAL-04), so it
--    is changed, to or from dealer, only by a holder of sales.credit.write in a company of the
--    request (Accounts, the Executive), never by the customer writers who may change the rest of
--    the row. `crm.account.update` refuses the change first with its own reason; this keeps the
--    rule for any other path. A new customer may be made a dealer (its orders are held until
--    Accounts enter its terms). The owner's own writes (the seed, the fixtures) carry no request.
create or replace function app.guard_account_type() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app.user_id() is not null
     and (old.type = 'dealer') is distinct from (new.type = 'dealer')
     and not app.has_perm('sales.credit.write:entity') then
    raise exception 'a customer becomes or stops being a dealer only with sales.credit.write'
      using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_account_type() from public, readonly_reporter;
--> statement-breakpoint
create trigger accounts_type_guard before update of type on accounts
  for each row execute function app.guard_account_type();
--> statement-breakpoint

-- 2. DOM-1. An order keeps its customer's type as it was when the order was made: the insert
--    policy holds `account_type` to the customer's type at that moment, and no request may change
--    it afterwards (it is not in the update grant of 0117). Otherwise as 0117.
drop policy sales_orders_insert on sales_orders;
--> statement-breakpoint
create policy sales_orders_insert on sales_orders for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and state = 'draft'
  and confirmed_at is null
  and credit_held_at is null
  and credit_release_by is null
  and cancel_reason is null
  and ((quote_id is not null
        and exists (select 1 from quotes q
                      join opportunities o on o.id = q.opportunity_id
                     where q.id = sales_orders.quote_id
                       and q.entity_id = sales_orders.entity_id
                       and q.opportunity_id = sales_orders.opportunity_id
                       and q.account_id = sales_orders.account_id
                       and q.site_id is not distinct from sales_orders.site_id
                       and q.state = 'accepted'
                       and o.archived_at is null
                       and app.scope_ok('sales.order.create', o.owner_id, o.team_id))
        and exists (select 1 from accounts a
                     where a.id = sales_orders.account_id
                       and a.type = sales_orders.account_type))
    or (quote_id is null
        and account_type = 'dealer'
        and exists (select 1 from account_entities ae
                      join accounts a on a.id = ae.account_id
                     where ae.account_id = sales_orders.account_id
                       and ae.entity_id = sales_orders.entity_id
                       and a.type = 'dealer'
                       and a.archived_at is null
                       and app.scope_ok('sales.order.create', ae.owner_id, ae.team_id)))));
--> statement-breakpoint

-- 3. DOM-4. Accepting a quote withdraws the lead's other draft and sent quotes, naming the
--    accepted one (`quotes.withdrawn_for_id`); a lead has one accepted quote
--    (`quotes_opportunity_accepted_unique`).
grant update (withdrawn_for_id) on quotes to app_user;
--> statement-breakpoint

-- 4. DOM-2. crm.lead.merge: as 0113, and a lead with a draft, sent or accepted quote, or with an
--    order that is not cancelled, is not the one merged away (`has_sale`). Answers { status,
--    accountId, tasks, tags, referralPartnerId }: merged, missing, held_by_other, not_open,
--    keep_open, different_customers, other_segment, two_partners or has_sale.
create or replace function app.merge_leads(p_kept uuid, p_merged uuid, p_entity smallint)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_kept public.opportunities%rowtype;
  v_merged public.opportunities%rowtype;
  v_tasks integer;
  v_tags integer;
  v_partner uuid;
begin
  if v_actor is null or not app.request_is_person()
     or not app.has_perm('crm.lead.merge:team') or not app.has_perm('crm.lead.write:own') then
    raise exception 'a person holding crm.lead.merge is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) or p_kept = p_merged then
    return jsonb_build_object('status', 'missing');
  end if;
  perform 1 from public.opportunities o
   where o.id in (p_kept, p_merged)
   order by o.id
     for update;
  select * into v_kept from public.opportunities o
   where o.id = p_kept and o.entity_id = p_entity and o.archived_at is null;
  select * into v_merged from public.opportunities o
   where o.id = p_merged and o.entity_id = p_entity and o.archived_at is null;
  if v_kept.id is null or v_merged.id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if not app.scope_ok('crm.lead.write', v_kept.owner_id, v_kept.team_id)
     or not app.scope_ok('crm.lead.write', v_merged.owner_id, v_merged.team_id) then
    return jsonb_build_object('status', 'held_by_other');
  end if;
  if v_kept.state not in ('open', 'nurture') or v_merged.state not in ('open', 'nurture') then
    return jsonb_build_object('status', 'not_open');
  end if;
  if v_kept.state = 'nurture' and v_merged.state = 'open' then
    return jsonb_build_object('status', 'keep_open');
  end if;
  if v_kept.account_id <> v_merged.account_id then
    return jsonb_build_object('status', 'different_customers');
  end if;
  if (select p.segment from public.pipelines p where p.id = v_kept.pipeline_id)
     is distinct from (select p.segment from public.pipelines p where p.id = v_merged.pipeline_id) then
    return jsonb_build_object('status', 'other_segment');
  end if;
  if v_kept.referral_partner_id is not null and v_merged.referral_partner_id is not null
     and v_kept.referral_partner_id <> v_merged.referral_partner_id then
    return jsonb_build_object('status', 'two_partners');
  end if;
  -- A lead with a sale in hand is not merged away (DOM-2): its draft, sent or accepted quote and
  -- any order not cancelled stay on it, and archiving it would leave them with no lead to accept,
  -- re-quote or confirm against. A person withdraws or cancels them first, or keeps that lead.
  if exists (select 1 from public.quotes q
              where q.opportunity_id = p_merged and q.state in ('draft', 'sent', 'accepted'))
     or exists (select 1 from public.sales_orders so
                 where so.opportunity_id = p_merged and so.state <> 'cancelled') then
    return jsonb_build_object('status', 'has_sale');
  end if;
  if v_kept.referral_partner_id is null and v_merged.referral_partner_id is not null then
    v_partner := v_merged.referral_partner_id;
    update public.opportunities
       set referral_partner_id = v_partner, updated_by = v_actor
     where id = p_kept;
  end if;

  update public.tasks
     set opportunity_id = p_kept, updated_by = v_actor
   where opportunity_id = p_merged and state = 'open';
  get diagnostics v_tasks = row_count;

  insert into public.opportunity_tags (opportunity_id, account_id, tag_id, entity_id, created_by)
  select p_kept, ot.account_id, ot.tag_id, ot.entity_id, v_actor
    from public.opportunity_tags ot
   where ot.opportunity_id = p_merged
  on conflict do nothing;
  delete from public.opportunity_tags where opportunity_id = p_merged;
  get diagnostics v_tags = row_count;

  update public.opportunities
     set archived_at = pg_catalog.now(), updated_by = v_actor
   where id = p_merged;
  return jsonb_build_object('status', 'merged', 'accountId', v_kept.account_id,
                            'tasks', v_tasks, 'tags', v_tags, 'referralPartnerId', v_partner);
end
$$;
--> statement-breakpoint
revoke execute on function app.merge_leads(uuid, uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.merge_leads(uuid, uuid, smallint) to app_user;--> statement-breakpoint

-- 5. DOM-V1. Which customers of one chunk of a customers import's rollback are now in use, so the
--    rollback keeps them: as 0106 (a live lead of any company, a consent of one of its contacts, a
--    relationship with a company that was not made with the customer, or an activity or a lead's
--    tag someone other than the importer added after the import), and now also a quote or an
--    order of any company, dealer terms or an outstanding entry, a call on any of its leads, or a
--    change to the customer by someone other than the importer. The rest as 0106.
create or replace function app.import_accounts_in_use(p_job uuid, p_accounts uuid[])
returns setof uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_importer uuid;
  v_ids uuid[];
begin
  select j.entity_id, j.created_by into v_entity, v_importer
    from public.import_jobs j
   where j.id = p_job and j.kind = 'accounts';
  if not found or app.user_id() is null
     or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.has_perm('imports.write:entity') then
    raise exception 'import job % is outside the request scope', p_job
      using errcode = 'insufficient_privilege';
  end if;
  -- The job's own customers among those given, locked in one order so two rollbacks never wait
  -- on each other crosswise; then their contacts.
  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_ids
    from (select a.id
            from public.accounts a
           where a.id = any (coalesce(p_accounts, '{}'::uuid[]))
             and exists (select 1 from public.import_rows r
                          where r.job_id = p_job and r.state = 'committed'
                            and r.created_type = 'account' and r.created_id = a.id)
           order by a.id
             for update of a) l;
  perform 1
     from (select c.id
             from public.contacts c
             join public.account_contacts ac on ac.contact_id = c.id
            where ac.account_id = any (v_ids)
            order by c.id
              for update of c) l;
  return query
    select a.id
      from public.accounts a
     where a.id = any (v_ids)
       and (exists (select 1 from public.opportunities o
                    where o.account_id = a.id and o.archived_at is null)
        or exists (select 1
                     from public.account_contacts ac
                     join public.consents c on c.contact_id = ac.contact_id
                    where ac.account_id = a.id)
        or exists (select 1 from public.account_entities ae
                    where ae.account_id = a.id and ae.created_at <> a.created_at)
        or exists (select 1 from public.activities v
                    where v.account_id = a.id and v.created_at >= a.created_at
                      and v.actor_principal_id <> v_importer)
        or exists (select 1
                     from public.opportunities o
                     join public.opportunity_tags g on g.opportunity_id = o.id
                    where o.account_id = a.id and g.created_at >= a.created_at
                      and g.created_by <> v_importer)
        or exists (select 1 from public.quotes q where q.account_id = a.id)
        or exists (select 1 from public.sales_orders so where so.account_id = a.id)
        or exists (select 1 from public.dealer_terms t where t.account_id = a.id)
        or exists (select 1 from public.dealer_outstanding d where d.account_id = a.id)
        or exists (select 1
                     from public.opportunities o
                     join public.calls c on c.opportunity_id = o.id
                    where o.account_id = a.id)
        or a.updated_by is distinct from v_importer and a.updated_by is not null);
end
$$;
--> statement-breakpoint
revoke execute on function app.import_accounts_in_use(uuid, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_accounts_in_use(uuid, uuid[]) to app_user;
--> statement-breakpoint

-- 6. DOM-3. Which leads of one chunk of a leads import's rollback are now in use, so the rollback
--    keeps them, as it keeps a customer in use: a lead with a quote, an order or a call, a sizing,
--    a timeline row or a tag someone other than the importer added, or a change to the lead by
--    someone other than the importer (a stage move, a handover, a nurture). The policies would show
--    the caller only the leads they read, so this runs as a definer, answers only ids of the job's
--    own leads among those given, and only to a caller who may import in the job's company within
--    the request. It first locks those leads until the transaction ends, so no quote, order or
--    call is added to one between this answer and the rollback archiving it.
create or replace function app.import_leads_in_use(p_job uuid, p_leads uuid[])
returns setof uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_importer uuid;
  v_ids uuid[];
begin
  select j.entity_id, j.created_by into v_entity, v_importer
    from public.import_jobs j
   where j.id = p_job and j.kind = 'leads';
  if not found or app.user_id() is null
     or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.has_perm('imports.write:entity') then
    raise exception 'import job % is outside the request scope', p_job
      using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_ids
    from (select o.id
            from public.opportunities o
           where o.id = any (coalesce(p_leads, '{}'::uuid[]))
             and exists (select 1 from public.import_rows r
                          where r.job_id = p_job and r.state = 'committed'
                            and r.created_type = 'opportunity' and r.created_id = o.id)
           order by o.id
             for update of o) l;
  return query
    select o.id
      from public.opportunities o
     where o.id = any (v_ids)
       and (exists (select 1 from public.quotes q where q.opportunity_id = o.id)
        or exists (select 1 from public.sales_orders so where so.opportunity_id = o.id)
        or exists (select 1 from public.calls c where c.opportunity_id = o.id)
        or exists (select 1 from public.sizings s
                    where s.opportunity_id = o.id and s.created_by <> v_importer)
        or exists (select 1 from public.activities v
                    where v.opportunity_id = o.id and v.created_at >= o.created_at
                      and v.actor_principal_id <> v_importer)
        or exists (select 1 from public.opportunity_tags g
                    where g.opportunity_id = o.id and g.created_at >= o.created_at
                      and g.created_by <> v_importer)
        or o.updated_by is distinct from v_importer and o.updated_by is not null);
end
$$;
--> statement-breakpoint
revoke execute on function app.import_leads_in_use(uuid, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_leads_in_use(uuid, uuid[]) to app_user;
--> statement-breakpoint

-- 7. SEC-4. A request changes on a lead only what the commands change: its stage, owner, team,
--    state and lock, its score and the reasons, its referral partner, and the archive and update
--    stamps (column grants, as quotes and orders have). Its customer, company, pipeline, site,
--    source and creator are fixed once it is made, so a lead cannot be pointed at a customer the
--    caller cannot already reach; a customer merge moves leads through its definer.
revoke update on opportunities from app_user;
--> statement-breakpoint
grant update (stage_id, owner_id, team_id, state, state_changed_at, locked_until, score,
              score_reasons_json, score_changed_at, score_changed_by, referral_partner_id,
              archived_at, updated_at, updated_by) on opportunities to app_user;
--> statement-breakpoint

-- 8. SEC-4. The timeline's insert rule, as 0088, narrowed to what the commands write: a row on a
--    lead is written by someone who may work leads (crm.lead.write), or for a call they logged, by
--    someone who logs calls (calls.log); a row on the customer by someone who may change that
--    customer. A person who only reads a lead cannot add history to it.
drop policy activities_insert on activities;
--> statement-breakpoint
create policy activities_insert on activities for insert to app_user with check (
  actor_principal_id = (select app.user_id())
  and entity_id = any ((select app.entity_ids())::int[])
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.account_id = activities.account_id
                       and o.entity_id = activities.entity_id))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = activities.account_id
                       and ae.entity_id = activities.entity_id)))
  and (type <> 'note'
    or (opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.archived_at is null
                       and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)))
    or (opportunity_id is null and app.account_in_scope(account_id, 'crm.account.write')))
  and (type = 'note'
    or (opportunity_id is not null
        and ((select app.has_perm('crm.lead.write:own'))
             or (type = 'call_logged' and (select app.has_perm('calls.log:own')))))
    or (opportunity_id is null and app.account_in_scope(account_id, 'crm.account.write'))));
