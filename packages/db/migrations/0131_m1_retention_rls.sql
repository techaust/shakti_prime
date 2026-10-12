-- Phase 1, slice M1: the anonymisation of unqualified leads idle for the retention period
-- (BLUEPRINT §7.9, docs/03-roadmap-appendix/phase1.md §10).
--
-- The nightly job runs as the worker principal `system:workers`, which holds no crm.* permission a
-- person may hold (ADR 0020). It holds instead the platform-only permission crm.retention.run,
-- which no person's role and no agent may hold, and reaches leads and customers only through the
-- two definers below: one answers which of a company's leads are stale, the other checks each
-- again under lock and removes its personal details. The period is a workshop default in
-- packages/domain (`WORKSHOP_DEFAULTS.retention`), passed in by the command.

-- 1. The platform-only permissions: main's eight kept, crm.retention.run added.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'crm.retention.run']::text[]
$$;
--> statement-breakpoint

-- 2. Whether one lead may be anonymised now, given the cutoff of the retention period: a lead
--    never won and not yet anonymised, at a stage before Qualified (or in a pipeline without one),
--    with no quote, order or commission, whose customer is a household, farm or business that
--    deals with the lead's company only, has no other lead, is no dealer or referral partner, is
--    in no merge that stands and no open duplicate card, and shares none of its people with
--    another customer; and nothing about the lead, its customer, the customer's people and sites,
--    its calls, tasks, sizings, timeline, Agent Inbox items or agent proposals has changed since
--    the cutoff. Payments and projects
--    arrive in later phases: their slices add their tables here. A plain function, run only by
--    the two definers below as their owner.
create or replace function app.lead_is_stale(p_lead uuid, p_cutoff timestamptz) returns boolean
  language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
     where o.id = p_lead
       and o.anonymised_at is null
       and o.state <> 'won'
       and a.type in ('household', 'farm', 'business')
       and o.created_at < p_cutoff
       and o.updated_at < p_cutoff
       and o.state_changed_at < p_cutoff
       and a.updated_at < p_cutoff
       -- Unqualified: the lead's stage comes before the pipeline's live Qualified stage.
       and not exists (select 1
                         from public.pipeline_stages s
                         join public.pipeline_stages q
                           on q.pipeline_id = s.pipeline_id and q.key = 'qualified'
                          and q.archived_at is null
                        where s.id = o.stage_id and s.position >= q.position)
       -- No transaction: no quote, order or commission on the lead or its customer.
       and not exists (select 1 from public.quotes x where x.opportunity_id = o.id)
       and not exists (select 1 from public.quotes x where x.account_id = a.id)
       and not exists (select 1 from public.sales_orders x where x.opportunity_id = o.id)
       and not exists (select 1 from public.sales_orders x where x.account_id = a.id)
       and not exists (select 1 from public.commission_accruals x where x.opportunity_id = o.id)
       and not exists (select 1 from public.dealer_terms x where x.account_id = a.id)
       and not exists (select 1 from public.dealer_outstanding x where x.account_id = a.id)
       and not exists (select 1 from public.referral_partners x where x.account_id = a.id)
       -- No other use of the customer (ADR 0008): no other company, no other lead, no merge that
       -- stands, no open duplicate card, no person shared with another customer.
       and not exists (select 1 from public.account_entities x
                        where x.account_id = a.id and x.entity_id <> o.entity_id)
       and not exists (select 1 from public.opportunities x
                        where x.account_id = a.id and x.id <> o.id)
       and not exists (select 1 from public.customer_merges x
                        where x.kept_account_id = a.id and x.undone_at is null)
       and not exists (select 1 from public.customer_merges x
                        where x.merged_account_id = a.id and x.undone_at is null)
       and not exists (select 1 from public.duplicate_candidates x
                        where x.account_id = a.id and x.state = 'open')
       and not exists (select 1 from public.duplicate_candidates x
                        where x.other_account_id = a.id and x.state = 'open')
       and not exists (select 1 from public.duplicate_candidates x
                        where x.kind = 'lead' and x.opportunity_id = o.id and x.state = 'open')
       and not exists (select 1 from public.duplicate_candidates x
                        where x.other_opportunity_id = o.id and x.state = 'open')
       and not exists (select 1
                         from public.account_contacts ac
                         join public.account_contacts x
                           on x.contact_id = ac.contact_id and x.account_id <> ac.account_id
                        where ac.account_id = a.id)
       -- No activity since the cutoff.
       and not exists (select 1 from public.activities x
                        where x.account_id = a.id and x.created_at >= p_cutoff)
       and not exists (select 1 from public.calls x
                        where x.opportunity_id = o.id
                          and (x.started_at >= p_cutoff or x.created_at >= p_cutoff))
       and not exists (select 1 from public.tasks x
                        where x.opportunity_id = o.id
                          and (x.updated_at >= p_cutoff or x.due_at >= p_cutoff))
       and not exists (select 1 from public.sizings x
                        where x.opportunity_id = o.id and x.created_at >= p_cutoff)
       and not exists (select 1 from public.account_entities x
                        where x.account_id = a.id and x.updated_at >= p_cutoff)
       and not exists (select 1 from public.inbox_items x
                        where x.subject_id = o.id and x.updated_at >= p_cutoff)
       and not exists (select 1 from public.inbox_items x
                        where x.subject_id = a.id and x.updated_at >= p_cutoff)
       and not exists (select 1 from public.agent_actions x
                        where x.input_json ->> 'opportunityId' = o.id::text
                          and (x.created_at >= p_cutoff or x.decided_at >= p_cutoff))
       and not exists (select 1 from public.customer_sites x
                        where x.account_id = a.id and x.updated_at >= p_cutoff)
       and not exists (select 1
                         from public.account_contacts ac
                         join public.contacts c on c.id = ac.contact_id
                        where ac.account_id = a.id
                          and (ac.updated_at >= p_cutoff or c.updated_at >= p_cutoff
                               or exists (select 1 from public.contact_phones p
                                           where p.contact_id = c.id and p.updated_at >= p_cutoff)
                               or exists (select 1 from public.consents k
                                           where k.contact_id = c.id and k.updated_at >= p_cutoff))))
$$;
--> statement-breakpoint
revoke execute on function app.lead_is_stale(uuid, timestamptz) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 3. The window of one batch: the next p_limit leads of one company of the request (500 at most)
--    not yet anonymised and never won whose last change is before the cutoff, oldest change first
--    after the cursor (p_after_at, p_after_id), on opportunities_retention_idx; each with whether
--    it may be anonymised now. The last row is the next batch's cursor, its time exact to the
--    microsecond. The period is between 12 and 120 months, so no call reaches a lead changed in
--    the last year. Reads only, so the dry run calls it on the reader pool too.
create or replace function app.stale_leads(p_entity smallint, p_months integer,
                                           p_after_at timestamptz, p_after_id uuid,
                                           p_limit integer)
  returns table (lead_id uuid, changed_at text, stale boolean)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_cutoff timestamptz;
begin
  if app.user_id() is null or not app.has_perm('crm.retention.run:entity') then
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
  return query
    select w.id,
           pg_catalog.to_char(pg_catalog.timezone('UTC', w.updated_at),
                              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           app.lead_is_stale(w.id, v_cutoff)
      from (select o.id, o.updated_at
              from public.opportunities o
             where o.entity_id = p_entity
               and o.anonymised_at is null
               and o.state <> 'won'
               and o.updated_at < v_cutoff
               and (p_after_at is null or (o.updated_at, o.id) > (p_after_at, p_after_id))
             order by o.updated_at, o.id
             limit least(greatest(coalesce(p_limit, 0), 0), 500)) w
     order by w.updated_at, w.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.stale_leads(smallint, integer, timestamptz, uuid, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stale_leads(smallint, integer, timestamptz, uuid, integer) to app_user, app_reader;
--> statement-breakpoint

-- 4. Which customers and leads the anonymisation is working on in this transaction: one row each,
--    written and removed by app.anonymise_stale_leads() alone, which no request role can read or
--    write. The append-only triggers of the timeline and of agent proposals (definers, so they may
--    read it whoever writes) open their one exception only for a row named here in the current
--    transaction, so no setting a request can make, and no other definer, can open it.
create table app.lead_anonymise_scope (
  tx xid8 not null,
  account_id uuid,
  lead_id uuid
);
--> statement-breakpoint
revoke all on app.lead_anonymise_scope from public;
--> statement-breakpoint
create index lead_anonymise_scope_tx_idx on app.lead_anonymise_scope (tx);
--> statement-breakpoint

-- 5. A note's text is free text about a customer: the timeline stays append-only, except that the
--    anonymisation removes the notes of a customer it is anonymising in this transaction. The
--    customer-merge exception of 0113 and 0117 is kept as it is.
create or replace function app.activities_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('app.customer_merge', true), '') <> ''
     and pg_catalog.to_jsonb(new) - 'account_id' = pg_catalog.to_jsonb(old) - 'account_id' then
    return new;
  end if;
  if tg_op = 'DELETE'
     and old.type = 'note'
     and exists (select 1 from app.lead_anonymise_scope s
                  where s.tx = pg_catalog.pg_current_xact_id()
                    and s.account_id = old.account_id) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.activities_append_only() from public, readonly_reporter;
--> statement-breakpoint

-- 6. An agent's proposal changes only its decision, once (0108), except that the anonymisation
--    removes the agent's note from a proposal about a lead it is anonymising in this transaction,
--    and changes nothing else.
create or replace function app.agent_actions_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'agent_actions is append-only' using errcode = '42501';
  end if;
  if new.input_json = old.input_json - 'note'
     and new.decided_input_json is not distinct from (old.decided_input_json - 'note')
     and (pg_catalog.to_jsonb(new) - 'input_json' - 'decided_input_json')
         = (pg_catalog.to_jsonb(old) - 'input_json' - 'decided_input_json')
     and exists (select 1 from app.lead_anonymise_scope s
                  where s.tx = pg_catalog.pg_current_xact_id()
                    and s.lead_id::text = old.input_json ->> 'opportunityId') then
    return new;
  end if;
  if old.state <> 'proposed'
     or new.id <> old.id or new.entity_id <> old.entity_id or new.run_id <> old.run_id
     or new.agent <> old.agent or new.action_type <> old.action_type
     or new.input_json <> old.input_json or new.autonomy <> old.autonomy
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'agent_actions changes only its decision, once' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.agent_actions_append_only() from public, readonly_reporter;
--> statement-breakpoint

-- 7. Anonymises the named leads of one company of the request, each only if, once it, its
--    customer and the customer's people are held, it is still stale (`app.lead_is_stale()`, read
--    again after the locks); a lead or customer a person is changing now is skipped until the
--    next night.
--    Removed: the customer's name (left empty) and GSTIN; its people's names (left empty, so the
--    generated `name_key` is empty too), email addresses and phone numbers; its sites' address,
--    village (so the generated `village_key` is null), PIN, map point and technical notes; the
--    lead's campaign fields; its tasks' titles; the customer's notes on the timeline; the notes
--    of Agent Inbox items about the lead or the customer; the agent's note on proposals about the
--    lead; and what the import rows that made the lead or the customer said.
--    Kept, as facts without the person: the lead (state, stage, pipeline, score), the customer's
--    type, the sites' tehsil, district and state code (coarse geography for reports), the
--    companies, calls, sizings (numbers only), tags, timeline rows other than notes (ids and codes
--    only), duplicate cards (signal codes only), notices (ids only), and consents as the fact of
--    consent with their evidence file. The lead, the customer, its people and sites are archived,
--    the lead and the customer marked anonymised.
--    Every call is one row of retention_runs (job leads-anonymise): the leads anonymised, or the
--    failure's code and constraint, never a value; a failure changes nothing else. Answers
--    `{ leads, error }`: the leads it anonymised, and the failure recorded, null when there was
--    none.
create or replace function app.anonymise_stale_leads(p_entity smallint, p_months integer,
                                                     p_leads uuid[])
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cutoff timestamptz;
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_leads uuid[] := '{}';
  v_accounts uuid[] := '{}';
  v_contacts uuid[] := '{}';
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
  begin
    -- Hold the leads and their customers. A quote, an order or another lead being written for
    -- one holds a key lock on it, so it is skipped rather than anonymised under that write.
    select coalesce(pg_catalog.array_agg(l.id), '{}'),
           coalesce(pg_catalog.array_agg(l.account_id), '{}')
      into v_leads, v_accounts
      from (select o.id, o.account_id
              from public.opportunities o
              join public.accounts a on a.id = o.account_id
             where o.entity_id = p_entity
               and o.id = any (coalesce(p_leads, '{}'::uuid[]))
             order by o.id
               for update of o, a skip locked) l;
    -- Hold the customers' people.
    select coalesce(pg_catalog.array_agg(c.id), '{}')
      into v_contacts
      from (select c.id
              from public.contacts c
             where c.id in (select ac.contact_id from public.account_contacts ac
                             where ac.account_id = any (v_accounts))
             order by c.id
               for update skip locked) c;
    -- Check each lead again now that it is held, and that every person of its customer is held.
    select coalesce(pg_catalog.array_agg(o.id), '{}'),
           coalesce(pg_catalog.array_agg(o.account_id), '{}')
      into v_leads, v_accounts
      from public.opportunities o
     where o.id = any (v_leads)
       and app.lead_is_stale(o.id, v_cutoff)
       and not exists (select 1 from public.account_contacts ac
                        where ac.account_id = o.account_id
                          and not (ac.contact_id = any (v_contacts)));
    select coalesce(pg_catalog.array_agg(distinct ac.contact_id), '{}')
      into v_contacts
      from public.account_contacts ac
     where ac.account_id = any (v_accounts);

    -- Name the customers and leads for the append-only triggers' one exception (step 4).
    insert into app.lead_anonymise_scope (tx, account_id, lead_id)
    select pg_catalog.pg_current_xact_id(), o.account_id, o.id
      from public.opportunities o where o.id = any (v_leads);

    -- The customers' notes.
    delete from public.activities x where x.account_id = any (v_accounts) and x.type = 'note';

    -- The agent's note on its proposals about the leads.
    update public.agent_actions x
       set input_json = x.input_json - 'note',
           decided_input_json = x.decided_input_json - 'note'
     where x.input_json ->> 'opportunityId' = any (array(select l::text from pg_catalog.unnest(v_leads) l))
       and (x.input_json ? 'note' or coalesce(x.decided_input_json ? 'note', false));

    -- The notes of Agent Inbox items about the leads or the customers.
    update public.inbox_items x
       set note = null, updated_by = v_actor
     where (x.subject_id = any (v_leads) or x.subject_id = any (v_accounts))
       and x.note is not null;

    update public.tasks x
       set title = null, updated_by = v_actor
     where x.opportunity_id = any (v_leads) and x.title is not null;

    delete from public.contact_phones x where x.contact_id = any (v_contacts);

    update public.contacts x
       set name = '', email = null,
           archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
     where x.id = any (v_contacts);

    update public.customer_sites x
       set address = null, village = null, pin = null, lat = null, lng = null,
           technical_json = '{}'::jsonb,
           archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
     where x.account_id = any (v_accounts);

    update public.accounts x
       set name = '', gstin = null, anonymised_at = pg_catalog.now(),
           archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
     where x.id = any (v_accounts);

    update public.opportunities x
       set campaign_json = '{}'::jsonb, anonymised_at = pg_catalog.now(),
           archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
     where x.id = any (v_leads);

    -- The import rows that made the leads or the customers, and the later rows of the same files
    -- skipped as repeats of them: what the file said is removed; the row's state, what it made and
    -- why it was refused stay, so the job's reconciliation still adds up.
    update public.import_rows s
       set raw_json = '{}'::jsonb, normalised_json = null, dedupe_json = null,
           updated_by = v_actor
      from public.import_rows r
     where ((r.created_type = 'opportunity' and r.created_id = any (v_leads))
            or (r.created_type in ('account', 'account_link') and r.created_id = any (v_accounts)))
       and s.job_id = r.job_id
       and (s.row_no = r.row_no
            or (s.state = 'skipped'
                and s.dedupe_json ->> 'inFileRowNo' = r.row_no::text));

    delete from app.lead_anonymise_scope s where s.tx = pg_catalog.pg_current_xact_id();
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    v_error := 'failed with code ' || v_state
                 || case when coalesce(v_constraint, '') = '' then ''
                         else ' on ' || v_constraint end;
    insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
    values (v_run, 'leads-anonymise', v_started, pg_catalog.clock_timestamp(), 0, v_error);
    return pg_catalog.jsonb_build_object('leads', '[]'::jsonb, 'error', v_error);
  end;
  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected)
  values (v_run, 'leads-anonymise', v_started, pg_catalog.clock_timestamp(),
          pg_catalog.cardinality(v_leads));
  return pg_catalog.jsonb_build_object('leads', pg_catalog.to_jsonb(v_leads), 'error', null);
end
$$;
--> statement-breakpoint
revoke execute on function app.anonymise_stale_leads(smallint, integer, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.anonymise_stale_leads(smallint, integer, uuid[]) to app_user;
