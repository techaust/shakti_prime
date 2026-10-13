-- The sales-integrity fixes of the review (13-10-2026), with 0134 to 0137.

-- 1. DOM-1 at creation: only a request holding sales.credit.write at company scope makes a
--    customer a dealer, as a new row or by a change of type (with today's roles, the Executive;
--    the owner's decision of 13-10-2026). As 0135, now before insert too. The owner's own writes
--    (the seed, the fixtures) carry no request.
create or replace function app.guard_account_type() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app.user_id() is not null
     and (tg_op = 'INSERT' and new.type = 'dealer'
          or tg_op = 'UPDATE' and (old.type = 'dealer') is distinct from (new.type = 'dealer'))
     and not app.has_perm('sales.credit.write:entity') then
    raise exception 'a customer becomes or stops being a dealer only with sales.credit.write'
      using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger accounts_type_guard on accounts;
--> statement-breakpoint
create trigger accounts_type_guard before insert or update of type on accounts
  for each row execute function app.guard_account_type();
--> statement-breakpoint

-- 2. A customer merge across dealer status: as 0117, and a pair of which exactly one is a dealer is
--    refused (`dealer_mismatch`); an Executive makes the types match first.
create or replace function app.merge_customers(
  p_merge uuid, p_kept uuid, p_merged uuid, p_entity smallint, p_candidate uuid
)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_found integer;
  v_sites jsonb;
  v_relationships jsonb;
  v_contacts jsonb;
  v_consents jsonb;
  v_leads jsonb;
  v_tasks jsonb;
  v_tags jsonb;
  v_activities jsonb;
  v_orders jsonb;
  v_terms jsonb;
  v_outstanding jsonb;
  v_moved jsonb;
begin
  if v_actor is null or not app.request_is_person()
     or not app.has_perm('crm.lead.merge:team') or not app.has_perm('crm.account.write:own') then
    raise exception 'a person holding crm.lead.merge is required' using errcode = '42501';
  end if;
  if not (p_entity = any (v_entities)) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_kept = p_merged then
    return jsonb_build_object('status', 'missing');
  end if;
  -- Both customers, live, locked in id order so two merges of one pair cannot cross.
  select count(*) into v_found
    from (select 1 from public.accounts a
           where a.id in (p_kept, p_merged) and a.archived_at is null
           order by a.id
             for update) locked;
  if v_found <> 2
     or not exists (select 1 from public.account_entities ae
                     where ae.account_id in (p_kept, p_merged) and ae.entity_id = p_entity)
     or not exists (select 1 from public.account_entities ae where ae.account_id = p_kept)
     or not exists (select 1 from public.account_entities ae where ae.account_id = p_merged) then
    return jsonb_build_object('status', 'missing');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (p_kept, p_merged) and not (ae.entity_id = any (v_entities)))
     or exists (select 1 from public.opportunities o
                 where o.account_id = p_merged and not (o.entity_id = any (v_entities))) then
    return jsonb_build_object('status', 'other_company');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (p_kept, p_merged)
                and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
     or exists (select 1 from public.opportunities o
                 where o.account_id = p_merged
                   and not app.scope_ok('crm.lead.write', o.owner_id, o.team_id)) then
    return jsonb_build_object('status', 'held_by_other');
  end if;
  if exists (select 1 from public.referral_partners rp where rp.account_id = p_merged) then
    return jsonb_build_object('status', 'partner');
  end if;
  -- Only the Executive makes or unmakes a dealer (DOM-1, the owner's decision of 13-10-2026): a
  -- dealer is merged only with a dealer, so a merge never leaves a dealer's terms, outstanding and
  -- orders on a customer that is not one, off Accounts' lists.
  if (select count(*) from public.accounts a
       where a.id in (p_kept, p_merged) and a.type = 'dealer') = 1 then
    return jsonb_build_object('status', 'dealer_mismatch');
  end if;

  with moved as (
    update public.customer_sites cs
       set account_id = p_kept, updated_by = v_actor
     where cs.account_id = p_merged
    returning cs.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_sites from moved;

  with moved as (
    update public.account_entities ae
       set account_id = p_kept, updated_by = v_actor
     where ae.account_id = p_merged
       and not exists (select 1 from public.account_entities k
                        where k.account_id = p_kept and k.entity_id = ae.entity_id)
    returning ae.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_relationships from moved;

  with before as (
    select ac.contact_id, ac.role
      from public.account_contacts ac
     where ac.account_id = p_merged
       and not exists (select 1 from public.account_contacts k
                        where k.account_id = p_kept and k.contact_id = ac.contact_id)),
  moved as (
    update public.account_contacts ac
       set account_id = p_kept,
           role = case when ac.role = 'owner' then 'other' else ac.role end,
           updated_by = v_actor
      from before b
     where ac.account_id = p_merged and ac.contact_id = b.contact_id
    returning ac.contact_id, b.role)
  select coalesce(jsonb_agg(jsonb_build_object('id', moved.contact_id, 'role', moved.role)
                            order by moved.contact_id), '[]'::jsonb)
    into v_contacts from moved;

  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_consents
    from public.consents c
   where c.contact_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_contacts) x);

  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_tasks
    from public.tasks t where t.account_id = p_merged;
  select coalesce(jsonb_agg(jsonb_build_object('opportunityId', ot.opportunity_id,
                                               'tagId', ot.tag_id)), '[]'::jsonb)
    into v_tags
    from public.opportunity_tags ot where ot.account_id = p_merged;

  with moved as (
    update public.opportunities o
       set account_id = p_kept, updated_by = v_actor
     where o.account_id = p_merged
    returning o.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_leads from moved;

  perform pg_catalog.set_config('app.customer_merge', p_merge::text, true);
  with moved as (
    update public.activities a
       set account_id = p_kept
     where a.account_id = p_merged
    returning a.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_activities from moved;

  -- A dealer's own orders (those without a lead) follow the customer; an order of a lead moved
  -- with the lead (ON UPDATE CASCADE). The dealer's terms and outstanding entries of a company
  -- move when the kept customer has none of its own there; where it has, its own stay the current
  -- ones (the merged entries would otherwise override them by date, or count one debt twice) and
  -- the merged customer's stay on it, kept as history.
  with moved as (
    update public.sales_orders so
       set account_id = p_kept, updated_by = v_actor
     where so.account_id = p_merged and so.opportunity_id is null
    returning so.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_orders from moved;
  with moved as (
    update public.dealer_terms dt
       set account_id = p_kept
     where dt.account_id = p_merged
       and not exists (select 1 from public.dealer_terms k
                        where k.account_id = p_kept and k.entity_id = dt.entity_id)
    returning dt.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_terms from moved;
  with moved as (
    update public.dealer_outstanding d
       set account_id = p_kept
     where d.account_id = p_merged
       and not exists (select 1 from public.dealer_outstanding k
                        where k.account_id = p_kept and k.entity_id = d.entity_id)
    returning d.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_outstanding from moved;
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.accounts
     set archived_at = pg_catalog.now(), updated_by = v_actor
   where id = p_merged;

  v_moved := jsonb_build_object(
    'contacts', v_contacts, 'sites', v_sites, 'relationships', v_relationships,
    'leads', v_leads, 'tasks', v_tasks, 'tags', v_tags, 'consents', v_consents,
    'activities', v_activities, 'orders', v_orders, 'dealerTerms', v_terms,
    'dealerOutstanding', v_outstanding);
  insert into public.customer_merges
    (id, entity_id, kept_account_id, merged_account_id, candidate_id, moved_json, created_by)
  values (p_merge, p_entity, p_kept, p_merged, p_candidate, v_moved, v_actor);
  return jsonb_build_object('status', 'merged', 'moved', v_moved);
end
$$;
--> statement-breakpoint
revoke execute on function app.merge_customers(uuid, uuid, uuid, smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.merge_customers(uuid, uuid, uuid, smallint, uuid) to app_user;
--> statement-breakpoint

-- 3. DOM-3: as 0135, with the importer of each lead taken from the lead itself (`created_by`, the
--    person whose commit made it), not from the job, since any holder of imports.write in the
--    company may commit a job another person uploaded.
create or replace function app.import_leads_in_use(p_job uuid, p_leads uuid[])
returns setof uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_ids uuid[];
begin
  select j.entity_id into v_entity
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
                    where s.opportunity_id = o.id and s.created_by <> o.created_by)
        or exists (select 1 from public.activities v
                    where v.opportunity_id = o.id and v.created_at >= o.created_at
                      and v.actor_principal_id <> o.created_by)
        or exists (select 1 from public.opportunity_tags g
                    where g.opportunity_id = o.id and g.created_at >= o.created_at
                      and g.created_by <> o.created_by)
        or o.updated_by is distinct from o.created_by and o.updated_by is not null);
end
$$;
