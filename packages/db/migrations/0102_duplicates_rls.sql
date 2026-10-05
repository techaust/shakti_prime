-- Duplicate customers and leads (PRD CRM-03, docs/design/phase1.md §7.4): who reads a candidate
-- and a merge, the platform-only permission of the nightly search, the definers that find and
-- record candidates, and the definers that merge customers or leads and undo a customer merge.
--
-- A merge reaches rows the caller may not change directly (timeline rows are append-only, a lead's
-- customer and a task's lead are not among the columns a request may update), so it runs in a
-- definer that checks, in its body, that a person holding crm.lead.merge may change both customers
-- in every company each is related to, and every lead it moves (the colleague's-customer rule of
-- SECURITY §4), before it moves anything.

-- 1. The nightly search's permission is platform-only, like crm.score.refresh (0100).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'crm.score.refresh', 'crm.duplicates.scan']::text[]
$$;
--> statement-breakpoint

-- 2. duplicate_candidates: read by whoever sees both customers (account_entities_read, ADR 0008)
--    or both leads of the company; decided by a person holding crm.lead.merge; suggested directly
--    only as a lead pair, by a holder of crm.lead.merge (an agent included, SECURITY §3.3). Lead
--    creation and the nightly search record their finds through app.record_duplicates().
create trigger set_updated_at before update on duplicate_candidates
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table duplicate_candidates enable row level security;
--> statement-breakpoint
alter table duplicate_candidates force row level security;
--> statement-breakpoint
create policy duplicate_candidates_read on duplicate_candidates for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((kind = 'customer'
        and exists (select 1 from account_entities ae
                     where ae.account_id = duplicate_candidates.account_id)
        and exists (select 1 from account_entities ae
                     where ae.account_id = duplicate_candidates.other_account_id))
    or (kind = 'lead'
        and exists (select 1 from opportunities o
                     where o.id = duplicate_candidates.opportunity_id
                       and o.entity_id = duplicate_candidates.entity_id)
        and exists (select 1 from opportunities o
                     where o.id = duplicate_candidates.other_opportunity_id
                       and o.entity_id = duplicate_candidates.entity_id))));
--> statement-breakpoint
create policy duplicate_candidates_insert on duplicate_candidates for insert to app_user with check (
  created_by = (select app.user_id())
  and entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('crm.lead.merge:team'))
  and kind = 'lead'
  and state = 'open'
  and exists (select 1 from opportunities o
               where o.id = duplicate_candidates.opportunity_id
                 and o.entity_id = duplicate_candidates.entity_id)
  and exists (select 1 from opportunities o
               where o.id = duplicate_candidates.other_opportunity_id
                 and o.entity_id = duplicate_candidates.entity_id));
--> statement-breakpoint
-- A person, never an agent or the system principal, decides a candidate (SECURITY §3.3).
create policy duplicate_candidates_update on duplicate_candidates for update to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('crm.lead.merge:team'))
  and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
              and coalesce(current_setting('app.role', true), '') not like 'system:%'
              and exists (select 1 from principals p
                           where p.id = app.user_id() and p.kind = 'user'))
  and ((kind = 'customer'
        and exists (select 1 from account_entities ae
                     where ae.account_id = duplicate_candidates.account_id)
        and exists (select 1 from account_entities ae
                     where ae.account_id = duplicate_candidates.other_account_id))
    or (kind = 'lead'
        and exists (select 1 from opportunities o
                     where o.id = duplicate_candidates.opportunity_id
                       and o.entity_id = duplicate_candidates.entity_id)
        and exists (select 1 from opportunities o
                     where o.id = duplicate_candidates.other_opportunity_id
                       and o.entity_id = duplicate_candidates.entity_id))))
  with check (
    entity_id = any ((select app.entity_ids())::int[])
    and (decided_by is null or decided_by = (select app.user_id())));
--> statement-breakpoint
grant select, insert on duplicate_candidates to app_user;
--> statement-breakpoint
grant update (state, decided_by, decided_at, updated_at, updated_by) on duplicate_candidates to app_user;
--> statement-breakpoint
grant select on duplicate_candidates to app_reader;
--> statement-breakpoint

-- 3. customer_merges: read with the kept customer in a company of the request; written only by
--    the merge definers below.
create trigger set_updated_at before update on customer_merges
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table customer_merges enable row level security;
--> statement-breakpoint
alter table customer_merges force row level security;
--> statement-breakpoint
create policy customer_merges_read on customer_merges for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from account_entities ae
               where ae.account_id = customer_merges.kept_account_id));
--> statement-breakpoint
grant select on customer_merges to app_user, app_reader;
--> statement-breakpoint

-- 4. The timeline stays append-only, with one exception: a customer merge, and its undo, move a
--    customer's rows to the other customer. Only the merge definers set app.customer_merge, only
--    the table owner may update the table at all (no request role holds update on it), and then
--    only the customer the row names may change.
create or replace function app.activities_append_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('app.customer_merge', true), '') <> ''
     and pg_catalog.to_jsonb(new) - 'account_id' = pg_catalog.to_jsonb(old) - 'account_id' then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.activities_append_only() from public, readonly_reporter;
--> statement-breakpoint
drop trigger activities_append_only on activities;
--> statement-breakpoint
create trigger activities_append_only before update or delete on activities
  for each row execute function app.activities_append_only();
--> statement-breakpoint

-- 5. The facts a duplicate's confidence is made from (duplicateConfidence() in packages/domain).
--    For one customer the caller may change (p_account, lead creation: crm.lead.write and the
--    customer in the caller's write scope), or for the next p_limit customers related to one
--    company in id order after p_after (the nightly search: crm.duplicates.scan, held by
--    system:workers alone), the other live customers anywhere in the group that share a phone
--    number with it, or its name and a village, and the pairs of its open leads of one segment in
--    that company. Every subject comes back at least once, with no pair, so the search knows where
--    its batch ended. Ids and yes-or-no facts only: never a name, number or village.
create or replace function app.duplicate_facts(
  p_entity smallint, p_after uuid, p_limit integer, p_account uuid
)
  returns table (
    subject_id uuid,
    pair_kind text,
    first_id uuid,
    second_id uuid,
    same_phone boolean,
    same_name boolean,
    same_village boolean,
    same_customer boolean
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_account is null then
    if not app.has_perm('crm.duplicates.scan:entity') then
      raise exception 'crm.duplicates.scan is required' using errcode = '42501';
    end if;
  elsif not app.has_perm('crm.lead.write:own')
        or not app.account_in_scope(p_account, 'crm.account.write') then
    raise exception 'the customer is outside the caller''s write scope' using errcode = '42501';
  end if;
  return query
  with subjects as (
    select a.id, lower(btrim(regexp_replace(a.name, '\s+', ' ', 'g'))) as name_key
      from public.accounts a
     where a.archived_at is null
       and ((p_account is not null and a.id = p_account)
         or (p_account is null
             and (p_after is null or a.id > p_after)
             and exists (select 1 from public.account_entities ae
                          where ae.account_id = a.id and ae.entity_id = p_entity)))
     order by a.id
     limit case when p_account is null
                then least(greatest(coalesce(p_limit, 0), 0), 1000) else 1 end
  ),
  subject_phones as (
    select distinct s.id as subject_id, ph.e164
      from subjects s
      join public.account_contacts ac on ac.account_id = s.id
      join public.contacts c on c.id = ac.contact_id and c.archived_at is null
      join public.contact_phones ph on ph.contact_id = ac.contact_id
  ),
  subject_villages as (
    select distinct s.id as subject_id,
           lower(btrim(regexp_replace(cs.village, '\s+', ' ', 'g'))) as village_key
      from subjects s
      join public.customer_sites cs on cs.account_id = s.id
     where cs.village is not null and cs.archived_at is null
  ),
  by_phone as (
    select distinct sp.subject_id, ac.account_id as other_id
      from subject_phones sp
      join public.contact_phones ph on ph.e164 = sp.e164
      join public.contacts c on c.id = ph.contact_id and c.archived_at is null
      join public.account_contacts ac on ac.contact_id = ph.contact_id
     where ac.account_id <> sp.subject_id
  ),
  by_name as (
    select s.id as subject_id, a.id as other_id
      from subjects s
      join public.accounts a
        on lower(btrim(regexp_replace(a.name, '\s+', ' ', 'g'))) = s.name_key
     where a.id <> s.id and a.archived_at is null
  ),
  same_villages as (
    select distinct n.subject_id, n.other_id
      from by_name n
      join subject_villages sv on sv.subject_id = n.subject_id
      join public.customer_sites cs
        on cs.account_id = n.other_id
       and cs.village is not null and cs.archived_at is null
       and lower(btrim(regexp_replace(cs.village, '\s+', ' ', 'g'))) = sv.village_key
  ),
  village_of_phone as (
    select distinct p.subject_id, p.other_id
      from by_phone p
      join subject_villages sv on sv.subject_id = p.subject_id
      join public.customer_sites cs
        on cs.account_id = p.other_id
       and cs.village is not null and cs.archived_at is null
       and lower(btrim(regexp_replace(cs.village, '\s+', ' ', 'g'))) = sv.village_key
  ),
  customer_pairs as (
    select p.subject_id, p.other_id from by_phone p
    union
    select v.subject_id, v.other_id from same_villages v
  )
  select cp.subject_id, 'customer'::text,
         least(cp.subject_id, cp.other_id), greatest(cp.subject_id, cp.other_id),
         exists (select 1 from by_phone p
                  where p.subject_id = cp.subject_id and p.other_id = cp.other_id),
         exists (select 1 from by_name n
                  where n.subject_id = cp.subject_id and n.other_id = cp.other_id),
         exists (select 1 from same_villages v
                  where v.subject_id = cp.subject_id and v.other_id = cp.other_id)
           or exists (select 1 from village_of_phone v
                       where v.subject_id = cp.subject_id and v.other_id = cp.other_id),
         false
    from customer_pairs cp
    join public.accounts a on a.id = cp.other_id and a.archived_at is null
  union all
  select s.id, 'lead'::text, l1.id, l2.id, true, false, false, true
    from subjects s
    join public.opportunities l1
      on l1.account_id = s.id and l1.entity_id = p_entity
     and l1.state = 'open' and l1.archived_at is null
    join public.pipelines p1 on p1.id = l1.pipeline_id
    join public.opportunities l2
      on l2.account_id = s.id and l2.entity_id = p_entity
     and l2.state = 'open' and l2.archived_at is null and l2.id > l1.id
    join public.pipelines p2 on p2.id = l2.pipeline_id and p2.segment = p1.segment
  union all
  select s.id, null::text, null::uuid, null::uuid, false, false, false, false
    from subjects s;
end
$$;
--> statement-breakpoint
revoke execute on function app.duplicate_facts(smallint, uuid, integer, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.duplicate_facts(smallint, uuid, integer, uuid) to app_user;
--> statement-breakpoint

-- 6. Records found pairs as open candidates of one company of the request:
--    [{ kind, firstId, secondId, reason, confidence, signals }], the confidence worked out by
--    duplicateConfidence() from app.duplicate_facts(). Each pair is checked again before it is
--    written: two live customers, one of them related to the company, that still share a number
--    (reason phone) or a name and a village (reason name_village); or two open leads of one
--    customer and segment in the company. The nightly search (crm.duplicates.scan) records any
--    such pair; a person (crm.lead.write, lead creation) only a pair with a customer or lead in
--    their own write scope. A pair already recorded in the company, whatever its state, is left
--    as it is, so a pair a person said is not the same is never put forward again. Answers the
--    candidates it wrote.
create or replace function app.record_duplicates(p_entity smallint, p_rows jsonb)
  returns table (
    candidate_id uuid,
    candidate_kind text,
    candidate_reason text,
    candidate_confidence smallint
  )
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_platform boolean;
  r record;
  v_id uuid;
  v_ok boolean;
begin
  if v_actor is null
     or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  v_platform := app.has_perm('crm.duplicates.scan:entity');
  if not v_platform and not app.has_perm('crm.lead.write:own') then
    raise exception 'crm.duplicates.scan or crm.lead.write is required' using errcode = '42501';
  end if;
  for r in
    select *
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
        as v(kind text, "firstId" uuid, "secondId" uuid, reason text, confidence integer,
             signals jsonb)
  loop
    v_id := null;
    if r."firstId" is null or r."secondId" is null or r."firstId" >= r."secondId"
       or r.confidence is null or r.confidence not between 1 and 100 then
      continue;
    end if;
    if r.kind = 'customer' then
      v_ok := exists (select 1 from public.accounts a
                       where a.id = r."firstId" and a.archived_at is null)
          and exists (select 1 from public.accounts a
                       where a.id = r."secondId" and a.archived_at is null)
          and exists (select 1 from public.account_entities ae
                       where ae.account_id in (r."firstId", r."secondId")
                         and ae.entity_id = p_entity)
          and (v_platform
               or app.account_in_scope(r."firstId", 'crm.account.write')
               or app.account_in_scope(r."secondId", 'crm.account.write'))
          and case r.reason
                when 'phone' then exists (
                  select 1
                    from public.account_contacts ac1
                    join public.contacts c1 on c1.id = ac1.contact_id and c1.archived_at is null
                    join public.contact_phones p1 on p1.contact_id = ac1.contact_id
                    join public.contact_phones p2 on p2.e164 = p1.e164
                    join public.contacts c2 on c2.id = p2.contact_id and c2.archived_at is null
                    join public.account_contacts ac2 on ac2.contact_id = p2.contact_id
                   where ac1.account_id = r."firstId" and ac2.account_id = r."secondId")
                when 'name_village' then exists (
                  select 1
                    from public.accounts a1
                    join public.accounts a2
                      on lower(btrim(regexp_replace(a2.name, '\s+', ' ', 'g')))
                       = lower(btrim(regexp_replace(a1.name, '\s+', ' ', 'g')))
                    join public.customer_sites s1
                      on s1.account_id = a1.id and s1.village is not null
                     and s1.archived_at is null
                    join public.customer_sites s2
                      on s2.account_id = a2.id and s2.village is not null
                     and s2.archived_at is null
                     and lower(btrim(regexp_replace(s2.village, '\s+', ' ', 'g')))
                       = lower(btrim(regexp_replace(s1.village, '\s+', ' ', 'g')))
                   where a1.id = r."firstId" and a2.id = r."secondId")
                else false
              end;
      if not v_ok then
        continue;
      end if;
      insert into public.duplicate_candidates
        (id, entity_id, kind, account_id, other_account_id, reason, signals_json, confidence,
         created_by)
      values
        (app.uuid_v7(), p_entity, 'customer', r."firstId", r."secondId", r.reason,
         coalesce(r.signals, '[]'::jsonb), r.confidence::smallint, v_actor)
      on conflict do nothing
      returning id into v_id;
    elsif r.kind = 'lead' then
      v_ok := r.reason = 'phone'
          and exists (
            select 1
              from public.opportunities l1
              join public.pipelines p1 on p1.id = l1.pipeline_id
              join public.opportunities l2
                on l2.account_id = l1.account_id and l2.entity_id = l1.entity_id
               and l2.state = 'open' and l2.archived_at is null
              join public.pipelines p2 on p2.id = l2.pipeline_id and p2.segment = p1.segment
             where l1.id = r."firstId" and l2.id = r."secondId"
               and l1.entity_id = p_entity and l1.state = 'open' and l1.archived_at is null
               and (v_platform
                    or app.scope_ok('crm.lead.write', l1.owner_id, l1.team_id)
                    or app.scope_ok('crm.lead.write', l2.owner_id, l2.team_id)));
      if not v_ok then
        continue;
      end if;
      insert into public.duplicate_candidates
        (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, signals_json,
         confidence, created_by)
      values
        (app.uuid_v7(), p_entity, 'lead', r."firstId", r."secondId", r.reason,
         coalesce(r.signals, '[]'::jsonb), r.confidence::smallint, v_actor)
      on conflict do nothing
      returning id into v_id;
    else
      continue;
    end if;
    if v_id is not null then
      candidate_id := v_id;
      candidate_kind := r.kind;
      candidate_reason := r.reason;
      candidate_confidence := r.confidence::smallint;
      return next;
    end if;
  end loop;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_duplicates(smallint, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_duplicates(smallint, jsonb) to app_user;
--> statement-breakpoint

-- Whether the request is a person's: never an agent, a voice session or the system principal.
-- Called by the merge definers below, as their owner.
create or replace function app.request_is_person() returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.current_setting('app.role', true), '') not like 'agent:%'
     and coalesce(pg_catalog.current_setting('app.role', true), '') not like 'system:%'
     and exists (select 1 from public.principals p
                  where p.id = app.user_id() and p.kind = 'user')
$$;
--> statement-breakpoint
revoke execute on function app.request_is_person() from public, readonly_reporter;
--> statement-breakpoint

-- 7. crm.customer.merge: folds p_merged into p_kept, for a person holding crm.lead.merge (team or
--    wider) and crm.account.write, acting in a company one of the two is related to. Every
--    relationship of both customers must be in the request's companies and the caller's customer
--    write scope, and every lead of the merged one in the caller's lead write scope; otherwise a
--    colleague looks after one of them and nothing moves (held_by_other). A referral partner is
--    never merged away (partner). Moves, and records in customer_merges: the merged customer's
--    sites; its relationships with companies the kept one has none with; its contacts not already
--    the kept one's (its owner as other, since a customer has one owner); its leads, with their
--    tasks and tags (ON UPDATE CASCADE); its timeline rows. The consents go with their contacts.
--    The merged customer is archived. Answers { status, moved } with the ids it moved.
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
              where ae.account_id in (p_kept, p_merged)
                and not (ae.entity_id = any (v_entities)
                         and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)))
     or exists (select 1 from public.opportunities o
                 where o.account_id = p_merged
                   and not (o.entity_id = any (v_entities)
                            and app.scope_ok('crm.lead.write', o.owner_id, o.team_id))) then
    return jsonb_build_object('status', 'held_by_other');
  end if;
  if exists (select 1 from public.referral_partners rp where rp.account_id = p_merged) then
    return jsonb_build_object('status', 'partner');
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
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.accounts
     set archived_at = pg_catalog.now(), updated_by = v_actor
   where id = p_merged;

  v_moved := jsonb_build_object(
    'contacts', v_contacts, 'sites', v_sites, 'relationships', v_relationships,
    'leads', v_leads, 'tasks', v_tasks, 'tags', v_tags, 'consents', v_consents,
    'activities', v_activities);
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

-- 8. crm.customer.unmerge: moves back what a merge moved and returns the merged customer, for a
--    person holding crm.lead.merge and crm.account.write who may change both customers in every
--    company each is related to, and every lead the merge moved (held_by_other otherwise). A row
--    changed since the merge stays where it is now: a site, contact or lead no longer on the kept
--    customer is not moved, and a relationship the kept customer has since used for another lead
--    is shared (the merged customer gets its own copy). Answers { status, keptAccountId,
--    mergedAccountId, candidateId, entityId }.
create or replace function app.unmerge_customers(p_merge uuid)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  m public.customer_merges%rowtype;
  v_leads uuid[];
  rel record;
begin
  if v_actor is null or not app.request_is_person()
     or not app.has_perm('crm.lead.merge:team') or not app.has_perm('crm.account.write:own') then
    raise exception 'a person holding crm.lead.merge is required' using errcode = '42501';
  end if;
  select * into m from public.customer_merges cm where cm.id = p_merge for update;
  if not found or not (m.entity_id = any (v_entities)) then
    return jsonb_build_object('status', 'missing');
  end if;
  if m.undone_at is not null then
    return jsonb_build_object('status', 'undone_already');
  end if;
  perform 1 from public.accounts a
   where a.id in (m.kept_account_id, m.merged_account_id)
   order by a.id
     for update;
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_leads
    from jsonb_array_elements_text(m.moved_json -> 'leads') x;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (m.kept_account_id, m.merged_account_id)
                and not (ae.entity_id = any (v_entities)
                         and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)))
     or exists (select 1 from public.opportunities o
                 where o.id = any (v_leads)
                   and not (o.entity_id = any (v_entities)
                            and app.scope_ok('crm.lead.write', o.owner_id, o.team_id))) then
    return jsonb_build_object('status', 'held_by_other');
  end if;

  update public.accounts
     set archived_at = null, updated_by = v_actor
   where id = m.merged_account_id;

  for rel in
    select ae.id, ae.entity_id, ae.owner_id, ae.team_id
      from public.account_entities ae
     where ae.account_id = m.kept_account_id
       and ae.id in (select x::uuid
                       from jsonb_array_elements_text(m.moved_json -> 'relationships') x)
  loop
    if exists (select 1 from public.opportunities o
                where o.account_id = m.kept_account_id and o.entity_id = rel.entity_id
                  and not (o.id = any (v_leads))) then
      insert into public.account_entities
        (id, account_id, entity_id, owner_id, team_id, created_by)
      values (app.uuid_v7(), m.merged_account_id, rel.entity_id, rel.owner_id, rel.team_id,
              v_actor)
      on conflict do nothing;
    else
      update public.account_entities
         set account_id = m.merged_account_id, updated_by = v_actor
       where id = rel.id;
    end if;
  end loop;

  update public.customer_sites
     set account_id = m.merged_account_id, updated_by = v_actor
   where account_id = m.kept_account_id
     and id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'sites') x);

  update public.opportunities
     set account_id = m.merged_account_id, updated_by = v_actor
   where account_id = m.kept_account_id and id = any (v_leads);

  update public.account_contacts ac
     set account_id = m.merged_account_id, role = c.role, updated_by = v_actor
    from (select (x ->> 'id')::uuid as contact_id, x ->> 'role' as role
            from jsonb_array_elements(m.moved_json -> 'contacts') x) c
   where ac.account_id = m.kept_account_id and ac.contact_id = c.contact_id;

  perform pg_catalog.set_config('app.customer_merge', p_merge::text, true);
  update public.activities
     set account_id = m.merged_account_id
   where account_id = m.kept_account_id
     and id in (select x::uuid
                  from jsonb_array_elements_text(m.moved_json -> 'activities') x);
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.customer_merges
     set undone_at = pg_catalog.now(), undone_by = v_actor, updated_by = v_actor
   where id = m.id;
  return jsonb_build_object(
    'status', 'undone', 'keptAccountId', m.kept_account_id,
    'mergedAccountId', m.merged_account_id, 'candidateId', m.candidate_id,
    'entityId', m.entity_id);
end
$$;
--> statement-breakpoint
revoke execute on function app.unmerge_customers(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.unmerge_customers(uuid) to app_user;
--> statement-breakpoint

-- 9. crm.lead.merge: two open or nurture leads of one customer in one company become one, for a
--    person holding crm.lead.merge who may write both leads. The merged lead's open tasks and its
--    tags move to the kept lead and the merged lead is archived; its timeline stays with the
--    customer. Answers { status, accountId, tasks, tags }: merged, missing, held_by_other,
--    not_open or different_customers.
create or replace function app.merge_leads(p_kept uuid, p_merged uuid, p_entity smallint)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_kept public.opportunities%rowtype;
  v_merged public.opportunities%rowtype;
  v_tasks integer;
  v_tags integer;
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
  if v_kept.account_id <> v_merged.account_id then
    return jsonb_build_object('status', 'different_customers');
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
                            'tasks', v_tasks, 'tags', v_tags);
end
$$;
--> statement-breakpoint
revoke execute on function app.merge_leads(uuid, uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.merge_leads(uuid, uuid, smallint) to app_user;
