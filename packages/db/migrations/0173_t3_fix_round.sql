-- T3 fix round (docs/runs/phase2/t3-dial.md, review 1, 2, 3 and 6): a dialled number can come off
-- its customer and the customer can be anonymised; a dial phone is the caller's own, never a
-- customer's or a company's number; calls left open are closed by the sweep.

-- 1. A provider call keeps whose call it was and when; the phone it names may only be cleared (the
--    number came off the customer: on delete set null, 0172), and its provider id likewise (the
--    customer anonymised); everything else of 0169's guard stands.
create or replace function app.provider_calls_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (new.id, new.entity_id, new.opportunity_id, new.caller_id, new.direction, new.series,
      new.purpose, new.started_at, new.created_at)
     is distinct from
     (old.id, old.entity_id, old.opportunity_id, old.caller_id, old.direction, old.series,
      old.purpose, old.started_at, old.created_at) then
    raise exception 'a provider call keeps whose call it was and when it started'
      using errcode = 'check_violation';
  end if;
  if new.contact_phone_id is distinct from old.contact_phone_id and new.contact_phone_id is not null then
    raise exception 'a provider call''s phone is only ever cleared' using errcode = 'check_violation';
  end if;
  if new.status <> old.status
     and app.provider_call_rank(new.status) <= app.provider_call_rank(old.status) then
    raise exception 'a call status only moves forward' using errcode = 'check_violation';
  end if;
  if (old.provider_call_sid is not null and new.provider_call_sid is not null
      and new.provider_call_sid <> old.provider_call_sid)
     or (old.answered_at is not null and new.answered_at is distinct from old.answered_at)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.duration_s is not null and new.duration_s is distinct from old.duration_s)
     or (old.recording_file_id is not null and new.recording_file_id is distinct from old.recording_file_id)
     or (old.transcript_file_id is not null and new.transcript_file_id is distinct from old.transcript_file_id)
     or (old.call_id is not null and new.call_id is distinct from old.call_id) then
    raise exception 'what the provider reported is recorded once' using errcode = 'check_violation';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;
--> statement-breakpoint

-- 2. The calls the hourly sweep closes as failed: a dial the provider never took nor reported
--    (dialling, no provider id) that started before p_unplaced_before, and a call ringing or on
--    the line whose end was never reported that started before p_open_before. Replaces 0171's
--    app.unplaced_provider_calls().
drop function app.unplaced_provider_calls(timestamptz, integer);
--> statement-breakpoint
create or replace function app.unended_provider_calls(p_unplaced_before timestamptz,
                                                      p_open_before timestamptz,
                                                      p_limit integer)
  returns table (id uuid, entity_id smallint, status text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select pc.id, pc.entity_id, pc.status
      from public.provider_calls pc
     where pc.status in ('dialling', 'ringing', 'in_progress')
       and pc.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and ((pc.status = 'dialling' and pc.provider_call_sid is null and pc.started_at < p_unplaced_before)
            or pc.started_at < p_open_before)
     order by pc.started_at, pc.id
     limit least(greatest(coalesce(p_limit, 0), 0), 500);
end
$$;
--> statement-breakpoint
revoke execute on function app.unended_provider_calls(timestamptz, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.unended_provider_calls(timestamptz, timestamptz, integer) to app_user;
--> statement-breakpoint

-- 3. The recordings the sweep removes: as 0169's, and every recording of a call on an anonymised
--    lead, whatever its age.
create or replace function app.call_recordings_due(p_before timestamptz, p_limit integer)
  returns table (file_id uuid, entity_id smallint, bucket text, key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select f.id, f.entity_id, f.bucket, f.key
      from public.files f
     where f.purpose = 'call_recording'
       and f.deleted_at is null
       and f.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and (f.created_at < p_before
            or exists (select 1 from public.provider_calls pc
                         join public.opportunities o on o.id = pc.opportunity_id
                        where pc.recording_file_id = f.id and o.anonymised_at is not null))
     order by f.created_at, f.id
     limit least(greatest(coalesce(p_limit, 0), 0), 500);
end
$$;
--> statement-breakpoint

-- 4. Whether a number is a customer's or a company's: a dial phone is the caller's own, so one
--    that rings a customer or a company line first is refused, when it is set and at every dial.
--    For a person holding calls.dial; a yes or no, nothing about whose number it is.
create or replace function app.dial_phone_taken(p_e164 text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.request_is_person() or not app.has_perm('calls.dial:own') then
    raise exception 'a person holding calls.dial is required' using errcode = '42501';
  end if;
  return exists (select 1 from public.contact_phones cp where cp.e164 = p_e164)
      or exists (select 1 from public.entity_channels ec where ec.number_e164 = p_e164);
end
$$;
--> statement-breakpoint
revoke execute on function app.dial_phone_taken(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.dial_phone_taken(text) to app_user;
--> statement-breakpoint

-- 5. The anonymisation of stale leads (0142's, every line kept) also names the leads' provider
--    calls in its scope and clears their provider ids; their phones go with the customer's.
create or replace function app.anonymise_stale_leads(p_entity smallint, p_months integer,
                                                     p_leads uuid[], p_kept uuid[])
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cutoff timestamptz;
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_tx xid8 := pg_catalog.pg_current_xact_id();
  v_account uuid;
  v_leads uuid[];
  v_contacts uuid[];
  v_subjects uuid[];
  v_held bigint;
  v_done uuid[] := '{}';
  v_kept integer := 0;
  v_failed integer := 0;
  v_state text;
  v_constraint text;
  v_error text;
begin
  if v_actor is null or not app.has_perm('crm.retention.run:entity') then
    raise exception 'crm.retention.run is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_months is null or p_months < 12 or p_months > 120 then
    raise exception 'the retention period must be between 12 and 120 months'
      using errcode = '22023';
  end if;
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(months => p_months);

  -- The leads found kept, each with its reason: the window passes them by until a reason that
  -- can lapse does (step 12).
  update public.opportunities o
     set retention_kept_at = pg_catalog.now(), retention_kept_reason = k.reason
    from (select x.id, app.lead_kept_reason(x.id) as reason
            from public.opportunities x
           where x.entity_id = p_entity
             and x.id = any (coalesce(p_kept, '{}'::uuid[]))
             and x.retention_kept_at is null
             and x.anonymised_at is null
             and x.state <> 'won') k
   where o.id = k.id and k.reason is not null;
  get diagnostics v_kept = row_count;

  for v_account in
    select distinct o.account_id
      from public.opportunities o
     where o.entity_id = p_entity and o.id = any (coalesce(p_leads, '{}'::uuid[]))
     order by 1
  loop
    begin
      -- Hold the customer and every lead of it, in every company; a quote, an order, a lead or any
      -- other write being made for one of them holds a lock on it, and the customer waits for the
      -- next night.
      select coalesce(pg_catalog.array_agg(l.id), '{}'), pg_catalog.count(*)
        into v_leads, v_held
        from (select o.id
                from public.opportunities o
                join public.accounts a on a.id = o.account_id
               where o.account_id = v_account
               order by o.id
                 for update of o, a skip locked) l;
      continue when v_held = 0
        or v_held <> (select pg_catalog.count(*) from public.opportunities o
                       where o.account_id = v_account);
      -- Hold the customer's people.
      select coalesce(pg_catalog.array_agg(c.id), '{}'), pg_catalog.count(*)
        into v_contacts, v_held
        from (select c.id
                from public.contacts c
               where c.id in (select ac.contact_id from public.account_contacts ac
                               where ac.account_id = v_account)
               order by c.id
                 for update skip locked) c;
      continue when v_held <> (select pg_catalog.count(*) from public.account_contacts ac
                                where ac.account_id = v_account);
      -- Every lead of the customer is checked again, now that all are held.
      continue when exists (select 1 from pg_catalog.unnest(v_leads) l(id)
                             where not app.lead_is_stale(l.id, v_cutoff));

      -- Name every subject for the append-only triggers' one exception (step 10).
      v_subjects := v_leads || v_account || v_contacts
        || array(select x.id from public.customer_sites x where x.account_id = v_account)
        || array(select x.id from public.account_entities x where x.account_id = v_account)
        || array(select x.id from public.tasks x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.calls x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.provider_calls x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.sizings x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.consents x where x.contact_id = any (v_contacts))
        || array(select x.id from public.inbox_items x
                  where x.subject_id = any (v_leads) or x.subject_id = v_account);
      insert into app.lead_anonymise_scope (tx, subject_id)
      select v_tx, s from pg_catalog.unnest(v_subjects) s;

      -- The customer's notes.
      delete from public.activities x where x.account_id = v_account and x.type = 'note';

      -- The agent's note and a follow-up's title on its proposals about the leads.
      update public.agent_actions x
         set input_json = x.input_json - array['note', 'title'],
             decided_input_json = x.decided_input_json - array['note', 'title']
       where x.input_json ->> 'opportunityId' = any (array(select l::text from pg_catalog.unnest(v_leads) l))
         and (x.input_json ?| array['note', 'title']
              or coalesce(x.decided_input_json ?| array['note', 'title'], false));

      -- The notes of Agent Inbox items about the leads or the customer.
      update public.inbox_items x
         set note = null, updated_by = v_actor
       where (x.subject_id = any (v_leads) or x.subject_id = v_account)
         and x.note is not null;

      update public.tasks x
         set title = null, updated_by = v_actor
       where x.opportunity_id = any (v_leads) and x.title is not null;

      delete from public.contact_phones x where x.contact_id = any (v_contacts);

      -- T3: the leads' provider calls keep no phone (the delete above cleared it) and no provider
      -- id, by which the provider could find the numbers; their recordings are due for removal at
      -- once (app.call_recordings_due() names the recordings of an anonymised lead).
      update public.provider_calls x
         set provider_call_sid = null
       where x.opportunity_id = any (v_leads) and x.provider_call_sid is not null;

      update public.contacts x
         set name = '', email = null,
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = any (v_contacts);

      update public.customer_sites x
         set address = null, village = null, pin = null, lat = null, lng = null,
             technical_json = '{}'::jsonb,
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.account_id = v_account;

      update public.accounts x
         set name = '', gstin = null, anonymised_at = pg_catalog.now(),
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = v_account;

      update public.opportunities x
         set campaign_json = '{}'::jsonb, anonymised_at = pg_catalog.now(),
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = any (v_leads);

      -- The import rows that made the leads or the customer (on `import_rows_created_idx`), then
      -- the later rows of the same files skipped as repeats of them (on
      -- `import_rows_skipped_repeat_idx`): what the file said is removed; the row's state, what it
      -- made and why it was refused stay, so the job's reconciliation still adds up.
      with made as (
        update public.import_rows r
           set raw_json = '{}'::jsonb, normalised_json = null, dedupe_json = null,
               updated_by = v_actor
         where (r.created_type = 'opportunity' and r.created_id = any (v_leads))
            or (r.created_type in ('account', 'account_link') and r.created_id = v_account)
        returning r.job_id, r.row_no
      )
      update public.import_rows s
         set raw_json = '{}'::jsonb, normalised_json = null, dedupe_json = null,
             updated_by = v_actor
        from made
       where s.job_id = made.job_id
         and s.state = 'skipped'
         and s.dedupe_json ->> 'inFileRowNo' = made.row_no::text;

      -- The audit rows about any of the subjects: by their record, or by the customer or lead
      -- their input names (a note, a task, a lead made or refused for the known customer, an
      -- agent's run about a lead), each found on its own index.
      update public.audit_logs l
         set input_json = app.audit_blank(l.input_json),
             before_json = app.audit_blank(l.before_json),
             after_json = app.audit_blank(l.after_json)
       where (l.id, l.created_at) in (
               select x.id, x.created_at from public.audit_logs x
                where x.aggregate_type = any (array['opportunity', 'account', 'customer',
                                                    'contact', 'site', 'account_entity', 'task',
                                                    'call', 'sizing', 'consent', 'inbox_item'])
                  and x.aggregate_id = any (array(select s::text from pg_catalog.unnest(v_subjects) s))
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'accountId' and x.input_json ->> 'accountId' = v_account::text
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'opportunityId'
                  and x.input_json ->> 'opportunityId'
                      = any (array(select l::text from pg_catalog.unnest(v_leads) l))
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'existingAccountId'
                  and x.input_json ->> 'existingAccountId' = v_account::text
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'proposal'
                  and x.input_json #>> '{proposal,input,opportunityId}'
                      = any (array(select l::text from pg_catalog.unnest(v_leads) l)));

      delete from app.lead_anonymise_scope s where s.tx = v_tx;
      v_done := v_done || v_leads;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
      v_failed := v_failed + 1;
      v_error := 'failed with code ' || v_state
                   || case when coalesce(v_constraint, '') = '' then ''
                           else ' on ' || v_constraint end;
    end;
  end loop;

  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (v_run, 'leads-anonymise', v_started, pg_catalog.clock_timestamp(),
          pg_catalog.cardinality(v_done),
          case when v_failed = 0 then null
               else v_error || ' for ' || v_failed::text
                    || case when v_failed = 1 then ' customer' else ' customers' end end);
  return pg_catalog.jsonb_build_object(
    'leads', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', o.id, 'entityId', o.entity_id) order by o.id)
                         from public.opportunities o where o.id = any (v_done)), '[]'::jsonb),
    'kept', v_kept,
    'failed', v_failed,
    'error', case when v_failed = 0 then null else v_error end);
end
$$;

--> statement-breakpoint
revoke execute on function app.anonymise_stale_leads(smallint, integer, uuid[], uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.anonymise_stale_leads(smallint, integer, uuid[], uuid[]) to app_user;
