-- A2 Caller Co-pilot (docs/03-roadmap-appendix/phase2.md §7.3, PRD AI-04 and TEL-03): the
-- Co-pilot's briefs and call summaries on a lead, read with the lead and written only by
-- agent:copilot holding agents.note.write; a recorded call's transcript (call_transcript), read with
-- its call; and the stale-lead anonymisation, which also removes the leads' Co-pilot notes.

-- 1. copilot_notes: read with the lead (the exists runs under opportunities_read), as the call log
--    is, so whoever reads the lead reads its notes, the Co-pilot included. Inserted only by the
--    Co-pilot's own principal holding agents.note.write in the note's company, on a lead it reads,
--    for a call of that lead and an outcome of the group or the company still in use; written by
--    itself (created_by), never by a person, another agent or the workers.
alter table copilot_notes enable row level security;
--> statement-breakpoint
alter table copilot_notes force row level security;
--> statement-breakpoint
create policy copilot_notes_read on copilot_notes for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = copilot_notes.opportunity_id));
--> statement-breakpoint
create policy copilot_notes_insert on copilot_notes for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and (select coalesce(current_setting('app.role', true), '')) = 'agent:copilot'
  and (select app.has_perm('agents.note.write:entity'))
  and exists (select 1 from opportunities o
               where o.id = copilot_notes.opportunity_id
                 and o.entity_id = copilot_notes.entity_id)
  and (provider_call_id is null
       or exists (select 1 from provider_calls pc
                   where pc.id = copilot_notes.provider_call_id
                     and pc.opportunity_id = copilot_notes.opportunity_id
                     and pc.entity_id = copilot_notes.entity_id))
  and (suggested_disposition_id is null
       or exists (select 1 from call_dispositions d
                   where d.id = copilot_notes.suggested_disposition_id
                     and (d.entity_id is null or d.entity_id = copilot_notes.entity_id)
                     and d.archived_at is null)));
--> statement-breakpoint
revoke all on copilot_notes from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on copilot_notes to app_user;
--> statement-breakpoint
grant select on copilot_notes to app_reader;
--> statement-breakpoint
grant select on copilot_notes to readonly_reporter;
--> statement-breakpoint

-- 2. A note is never changed, and removed only by the stale-lead anonymisation, for a lead it is
--    anonymising in this transaction (app.lead_anonymise_scope). Held for every role.
create or replace function app.copilot_notes_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and app.in_lead_anonymise_scope(old.opportunity_id::text) then
    return old;
  end if;
  raise exception 'copilot_notes is append-only' using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_notes_append_only() from public, readonly_reporter;
--> statement-breakpoint
create trigger copilot_notes_append_only before update or delete on copilot_notes
  for each row execute function app.copilot_notes_append_only();
--> statement-breakpoint

-- 3. A call's transcript (call_transcript) is read with the provider call it belongs to, under the
--    call's rule (provider_calls_read, read with the lead): whoever reads the lead reads it, and
--    nobody else. The platform stores it masked; no request uploads one
--    (app.file_purpose_grant() names nothing for it). The file checks' permission (files.process)
--    reads every file of the company, as for any purpose.
create policy files_call_transcript_read on files for select to app_user, app_reader using (
  purpose = 'call_transcript'
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from provider_calls pc
               where pc.transcript_file_id = files.id and pc.entity_id = files.entity_id
                 and files.purpose = 'call_transcript'));
--> statement-breakpoint

-- 4. The stale-lead anonymisation, as 0188 wrote it (0173 with W1's WhatsApp chats), also removing
--    the Caller Co-pilot's briefs and call summaries on the leads; every other line is kept.
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
  v_threads uuid[];
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

      -- A customer who wrote on WhatsApp within the period is not idle: passed by tonight.
      continue when exists (select 1 from public.whatsapp_threads x
                             where x.account_id = v_account and x.last_inbound_at >= v_cutoff);
      -- The customer's WhatsApp chats, in every company.
      v_threads := array(select x.id from public.whatsapp_threads x where x.account_id = v_account);

      -- Name every subject for the append-only triggers' one exception (step 10).
      v_subjects := v_leads || v_account || v_contacts || v_threads
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

      -- A2: the Caller Co-pilot's briefs and call summaries on the leads (the guard's one
      -- exception).
      delete from public.copilot_notes x where x.opportunity_id = any (v_leads);

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

      -- The customer's WhatsApp chats lose the number and wait for no one; the customer's own
      -- words and button replies are cleared (the guard's one exception), so nothing in a chat
      -- names the person. A message from the number later opens a new chat.
      update public.whatsapp_threads x
         set wa_id = null, needs_reply = false, updated_by = v_actor
       where x.id = any (v_threads);
      update public.whatsapp_messages x
         set body_masked = null, button_payload = null
       where x.thread_id = any (v_threads) and x.direction = 'inbound'
         and (x.body_masked is not null or x.button_payload is not null);

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
