-- W1 WhatsApp threads and messaging, steps 5 to 7 (docs/03-roadmap-appendix/phase2.md §6.1): the
-- company of a delivery found before anything is recorded, a customer's file attached to the message
-- it came on and read with its thread, the notice of a chat waiting for a reply, and the customer
-- merge carrying the merged customer's threads.

-- 1. The customer merge and its undoing, as 0154 and 0117 define them, with the merged customer's
--    WhatsApp threads moved to the kept customer and back (the lead's decision, 14-11-2026).
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
  v_threads jsonb;
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

  -- The merged customer's WhatsApp threads (W1): a thread on one of its leads follows the lead
  -- (ON UPDATE CASCADE), the others are moved after the leads; every one is recorded.
  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_threads
    from public.whatsapp_threads t where t.account_id = p_merged;

  with moved as (
    update public.opportunities o
       set account_id = p_kept, updated_by = v_actor
     where o.account_id = p_merged
    returning o.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_leads from moved;

  update public.whatsapp_threads t
     set account_id = p_kept, updated_by = v_actor
   where t.account_id = p_merged and t.opportunity_id is null;

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
    'dealerOutstanding', v_outstanding, 'whatsappThreads', v_threads);
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
create or replace function app.unmerge_customers(p_merge uuid)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  m public.customer_merges%rowtype;
  v_leads uuid[];
  rel record;
  v_relationships jsonb := '[]'::jsonb;
  v_sites jsonb;
  v_back_leads jsonb;
  v_contacts jsonb;
  v_consents jsonb;
  v_tasks jsonb;
  v_tags jsonb;
  v_activities jsonb;
  v_orders jsonb;
  v_terms jsonb;
  v_outstanding jsonb;
  v_threads jsonb;
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
  if exists (select 1 from public.accounts a
              where a.id = m.kept_account_id and a.archived_at is not null) then
    return jsonb_build_object('status', 'kept_merged');
  end if;
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_leads
    from jsonb_array_elements_text(m.moved_json -> 'leads') x;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (m.kept_account_id, m.merged_account_id)
                and not (ae.entity_id = any (v_entities)))
     or exists (select 1 from public.opportunities o
                 where o.id = any (v_leads) and not (o.entity_id = any (v_entities))) then
    return jsonb_build_object('status', 'other_company');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (m.kept_account_id, m.merged_account_id)
                and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
     or exists (select 1 from public.opportunities o
                 where o.id = any (v_leads)
                   and not app.scope_ok('crm.lead.write', o.owner_id, o.team_id)) then
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
    v_relationships := v_relationships || jsonb_build_array(rel.id);
  end loop;

  with moved as (
    update public.customer_sites
       set account_id = m.merged_account_id, updated_by = v_actor
     where account_id = m.kept_account_id
       and id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'sites') x)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_sites from moved;

  with moved as (
    update public.opportunities
       set account_id = m.merged_account_id, updated_by = v_actor
     where account_id = m.kept_account_id and id = any (v_leads)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_back_leads from moved;

  -- The WhatsApp threads the merge moved (W1): those on a lead went back with it (ON UPDATE
  -- CASCADE); the others go back here.
  update public.whatsapp_threads t
     set account_id = m.merged_account_id, updated_by = v_actor
   where t.account_id = m.kept_account_id and t.opportunity_id is null
     and t.id in (select x::uuid
                    from jsonb_array_elements_text(coalesce(m.moved_json -> 'whatsappThreads', '[]'::jsonb)) x);
  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_threads
    from public.whatsapp_threads t
   where t.account_id = m.merged_account_id
     and t.id in (select x::uuid
                    from jsonb_array_elements_text(coalesce(m.moved_json -> 'whatsappThreads', '[]'::jsonb)) x);

  with moved as (
    update public.account_contacts ac
       set account_id = m.merged_account_id, role = c.role, updated_by = v_actor
      from (select (x ->> 'id')::uuid as contact_id, x ->> 'role' as role
              from jsonb_array_elements(m.moved_json -> 'contacts') x) c
     where ac.account_id = m.kept_account_id and ac.contact_id = c.contact_id
    returning ac.contact_id, c.role)
  select coalesce(jsonb_agg(jsonb_build_object('id', moved.contact_id, 'role', moved.role)
                            order by moved.contact_id), '[]'::jsonb)
    into v_contacts from moved;

  -- What went back with the leads (tasks and tags, ON UPDATE CASCADE) and the contacts (consents).
  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_tasks
    from public.tasks t
   where t.account_id = m.merged_account_id
     and t.id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'tasks') x);
  select coalesce(jsonb_agg(jsonb_build_object('opportunityId', ot.opportunity_id,
                                               'tagId', ot.tag_id)), '[]'::jsonb)
    into v_tags
    from public.opportunity_tags ot
   where ot.account_id = m.merged_account_id
     and exists (select 1 from jsonb_array_elements(m.moved_json -> 'tags') x
                  where (x ->> 'opportunityId')::uuid = ot.opportunity_id
                    and (x ->> 'tagId')::uuid = ot.tag_id);
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_consents
    from public.consents c
   where c.contact_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_contacts) x)
     and c.id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'consents') x);

  perform pg_catalog.set_config('app.customer_merge', p_merge::text, true);
  with moved as (
    update public.activities
       set account_id = m.merged_account_id
     where account_id = m.kept_account_id
       and id in (select x::uuid
                    from jsonb_array_elements_text(m.moved_json -> 'activities') x)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_activities from moved;

  -- What a merge moved of the dealer's own orders, terms and outstanding goes back too.
  with moved as (
    update public.sales_orders so
       set account_id = m.merged_account_id, updated_by = v_actor
     where so.account_id = m.kept_account_id and so.opportunity_id is null
       and so.id in (select x::uuid
                       from jsonb_array_elements_text(coalesce(m.moved_json -> 'orders', '[]'::jsonb)) x)
    returning so.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_orders from moved;
  with moved as (
    update public.dealer_terms dt
       set account_id = m.merged_account_id
     where dt.account_id = m.kept_account_id
       and dt.id in (select x::uuid
                       from jsonb_array_elements_text(coalesce(m.moved_json -> 'dealerTerms', '[]'::jsonb)) x)
    returning dt.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_terms from moved;
  with moved as (
    update public.dealer_outstanding d
       set account_id = m.merged_account_id
     where d.account_id = m.kept_account_id
       and d.id in (select x::uuid
                      from jsonb_array_elements_text(coalesce(m.moved_json -> 'dealerOutstanding', '[]'::jsonb)) x)
    returning d.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_outstanding from moved;
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.customer_merges
     set undone_at = pg_catalog.now(), undone_by = v_actor, updated_by = v_actor
   where id = m.id;
  return jsonb_build_object(
    'status', 'undone', 'keptAccountId', m.kept_account_id,
    'mergedAccountId', m.merged_account_id, 'candidateId', m.candidate_id,
    'entityId', m.entity_id,
    'moved', jsonb_build_object(
      'contacts', v_contacts, 'sites', v_sites, 'relationships', v_relationships,
      'leads', v_back_leads, 'tasks', v_tasks, 'tags', v_tags, 'consents', v_consents,
      'activities', v_activities, 'orders', v_orders, 'dealerTerms', v_terms,
      'dealerOutstanding', v_outstanding, 'whatsappThreads', v_threads));
end
$$;
--> statement-breakpoint
revoke execute on function app.unmerge_customers(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.unmerge_customers(uuid) to app_user;
--> statement-breakpoint

-- 2. The company a WhatsApp delivery is for, before any company is in the request: the one whose
--    active WhatsApp number Meta names, by its provider reference (a message or a status) or by its
--    number (a quality update). For messaging.process alone; null when no active number matches,
--    and the delivery then records nothing.
create or replace function app.whatsapp_channel_entity(p_provider_ref text, p_number_e164 text)
  returns smallint
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select ec.entity_id into v_entity
    from public.entity_channels ec
   where ec.channel = 'whatsapp' and ec.is_active
     and ((p_provider_ref is not null and ec.provider_ref = p_provider_ref)
          or (p_provider_ref is null and p_number_e164 is not null and ec.number_e164 = p_number_e164))
   limit 1;
  return v_entity;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_channel_entity(text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_channel_entity(text, text) to app_user, app_reader;
--> statement-breakpoint

-- The companies that registered a template, for Meta's template events, which name no number:
-- each company's status is then recorded in a request for that company alone.
create or replace function app.whatsapp_template_entities(p_name text, p_language text)
  returns setof smallint
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  return query
    select distinct wt.entity_id from public.whatsapp_templates wt
     where wt.name = p_name and wt.language = p_language
     order by 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_template_entities(text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_template_entities(text, text) to app_user, app_reader;
--> statement-breakpoint

-- 3. A file a customer sent (messaging.media.attach): attached to the inbound media message it came
--    on, once, and only a WhatsApp file of the message's company that no other message holds, so a
--    file is only ever on its sender's thread. Answers whether this call attached it.
create or replace function app.whatsapp_attach_media(p_message uuid, p_file uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_created_at timestamptz;
  v_entity smallint;
  v_file uuid;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select m.created_at, m.entity_id, m.file_id into v_created_at, v_entity, v_file
    from public.whatsapp_messages m
   where m.id = p_message and m.direction = 'inbound' and m.kind = 'media'
     and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_created_at is null then
    raise exception 'message % is no inbound file of the request''s companies', p_message
      using errcode = 'check_violation';
  end if;
  if v_file is not null then
    return v_file = p_file;
  end if;
  if not exists (select 1 from public.files f
                  where f.id = p_file and f.entity_id = v_entity and f.purpose = 'whatsapp_media')
     or exists (select 1 from public.whatsapp_messages o where o.file_id = p_file) then
    raise exception 'file % is not this message''s to hold', p_file using errcode = 'check_violation';
  end if;
  update public.whatsapp_messages m
     set file_id = p_file
   where m.id = p_message and m.created_at = v_created_at;
  return true;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_attach_media(uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_attach_media(uuid, uuid) to app_user;
--> statement-breakpoint

-- A WhatsApp file is read with the message it came on, under the message's and its thread's rule
-- (whatsapp_messages_read): whoever reads the customer's chat reads its files, and nobody else.
-- The file checks' permission (files.process) reads every file of the company, as for any purpose.
create policy files_whatsapp_read on files for select to app_user, app_reader using (
  purpose = 'whatsapp_media'
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from whatsapp_messages m
               where m.file_id = files.id and m.entity_id = files.entity_id
                 and files.purpose = 'whatsapp_media'));
--> statement-breakpoint

-- 4. The notice of a chat waiting for a reply (whatsapp_reply_waiting): a thread handed to people
--    whose customer wrote before p_waited_before and got no reply since, for the person who looks
--    after it (its lead's owner, else the customer's in the company), once per customer message.
--    The scan asks only within calling hours (notify.ts).
create or replace function app.notice_whatsapp_waiting(p_entity smallint, p_waited_before timestamptz, p_limit integer)
  returns table (thread_id uuid, user_id uuid, account_id uuid, opportunity_id uuid, dedupe_key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select t.id, t.assignee_id, t.account_id, t.opportunity_id,
           'whatsapp_reply_waiting:' || t.id::text || ':'
             || pg_catalog.floor(extract(epoch from t.last_inbound_at))::bigint::text
      from public.whatsapp_threads t
     where t.entity_id = p_entity
       and t.needs_reply and t.handled_by = 'people'
       and t.assignee_id is not null
       and t.last_inbound_at <= p_waited_before
       and t.last_inbound_at > p_waited_before - interval '1 day'
       and app.notice_recipient_ok(t.assignee_id, p_entity)
       and not exists (select 1 from public.notifications n
                        where n.user_id = t.assignee_id
                          and n.dedupe_key = 'whatsapp_reply_waiting:' || t.id::text || ':'
                            || pg_catalog.floor(extract(epoch from t.last_inbound_at))::bigint::text)
     order by t.last_inbound_at, t.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_whatsapp_waiting(smallint, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_whatsapp_waiting(smallint, timestamptz, integer) to app_user;
