-- Phase 1, slice M1: the anonymisation of unqualified leads idle for the retention period
-- (BLUEPRINT §7.9, docs/03-roadmap-appendix/phase1.md §10).
--
-- The nightly job runs as the worker principal `system:workers`, which holds no crm.* permission a
-- person may hold (ADR 0020). It holds instead the platform-only permission crm.retention.run,
-- which no person's role and no agent may hold, and reaches leads and customers only through the
-- two definers below: one answers which of a company's leads are stale (and which are kept), the
-- other checks each customer again under lock and removes its personal details. The period is a
-- workshop default in packages/domain (`WORKSHOP_DEFAULTS.retention`), passed in by the command.
-- A customer is anonymised with all its leads, in every company, all at once, or not at all.

-- 1. The platform-only permissions: main's eight kept, crm.retention.run added.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run']::text[]
$$;
--> statement-breakpoint

-- 2. A lead whose only change is when it reached Qualified, or that the retention job found it
--    kept, is not edited: its updated_at stays, as for a change of its score alone (0100).
create or replace function app.opportunities_set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if ((new.score, new.score_reasons_json, new.score_changed_at, new.score_changed_by,
       new.qualified_at, new.retention_kept_at, new.retention_kept_reason)
        is distinct from
      (old.score, old.score_reasons_json, old.score_changed_at, old.score_changed_by,
       old.qualified_at, old.retention_kept_at, old.retention_kept_reason))
     and to_jsonb(new) - array['score', 'score_reasons_json', 'score_changed_at',
                               'score_changed_by', 'qualified_at', 'retention_kept_at',
                               'retention_kept_reason', 'updated_at', 'updated_by']
       = to_jsonb(old) - array['score', 'score_reasons_json', 'score_changed_at',
                               'score_changed_by', 'qualified_at', 'retention_kept_at',
                               'retention_kept_reason', 'updated_at', 'updated_by'] then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;
--> statement-breakpoint

-- 3. When each lead first reached Qualified, for the leads that did before `qualified_at` existed
--    (from now on `crm.opportunity.stage.move` stamps it): a lead standing at an open stage at or
--    after its pipeline's live Qualified stage, or whose timeline records a move to one, judged by
--    the stages' positions today, the best evidence there is before an archive or a reorder can
--    change them. The time is that of the first such move, or the lead's last change when only its
--    stage shows it. Won and lost stages say nothing by their position.
update public.opportunities o
   set qualified_at = coalesce(
         (select pg_catalog.min(x.created_at)
            from public.activities x
            join public.pipeline_stages t on t.id::text = x.payload_json ->> 'toStageId'
           where x.opportunity_id = o.id and x.type = 'stage_moved'
             and t.pipeline_id = q.pipeline_id and t.kind = 'open' and t.position >= q.position),
         o.updated_at)
  from public.pipeline_stages q
 where q.pipeline_id = o.pipeline_id and q.key = 'qualified' and q.archived_at is null
   and o.qualified_at is null
   and (exists (select 1 from public.pipeline_stages s
                 where s.id = o.stage_id and s.kind = 'open' and s.position >= q.position)
        or exists (select 1
                     from public.activities x
                     join public.pipeline_stages t on t.id::text = x.payload_json ->> 'toStageId'
                    where x.opportunity_id = o.id and x.type = 'stage_moved'
                      and t.pipeline_id = q.pipeline_id and t.kind = 'open'
                      and t.position >= q.position));
--> statement-breakpoint

-- Steps 4 to 7 are PL/pgSQL, whose statements' plans are kept for the session: as SQL functions
-- called from one another they were planned again on every call, which made 500 checks take
-- 1.5 s instead of about 0.1 s.
--
-- 4. Why a lead is kept, whatever the time, or null when nothing keeps it. First the reasons that
--    never come undone: won; Qualified reached (`qualified_at`); a quote, an order or a commission
--    of it or its customer; the customer's dealer credit or referral partner record; another lead
--    of the customer that won or reached Qualified (`other_lead`); a company that knows the
--    customer with no lead of it there, such as a customers file or a dealer (`customer`). Then
--    the two that can lapse, each cleared by the change that ends it (step 12): the customer's
--    type as a dealer or referral partner (`dealer`) and a merge that stands (`merge`). Payments and
--    projects arrive in later phases: their slices add their tables here.
create or replace function app.lead_kept_reason(p_lead uuid) returns text
  language plpgsql stable set search_path = '' as $$
begin
  return (
    select case
             when o.state = 'won' then 'won'
             when o.qualified_at is not null then 'qualified'
             when exists (select 1 from public.quotes x where x.opportunity_id = o.id)
               or exists (select 1 from public.quotes x where x.account_id = a.id) then 'quote'
             when exists (select 1 from public.sales_orders x where x.opportunity_id = o.id)
               or exists (select 1 from public.sales_orders x where x.account_id = a.id) then 'order'
             when exists (select 1 from public.commission_accruals x where x.opportunity_id = o.id)
               then 'commission'
             when exists (select 1 from public.dealer_terms x where x.account_id = a.id)
               or exists (select 1 from public.dealer_outstanding x where x.account_id = a.id)
               then 'dealer_credit'
             when exists (select 1 from public.referral_partners x where x.account_id = a.id)
               then 'referral_partner'
             when exists (select 1 from public.opportunities x
                           where x.account_id = a.id and x.id <> o.id
                             and (x.state = 'won' or x.qualified_at is not null))
               then 'other_lead'
             when exists (select 1 from public.account_entities e
                           where e.account_id = a.id
                             and not exists (select 1 from public.opportunities x
                                              where x.account_id = a.id
                                                and x.entity_id = e.entity_id))
               then 'customer'
             when a.type not in ('household', 'farm', 'business') then 'dealer'
             when exists (select 1 from public.customer_merges x
                           where x.kept_account_id = a.id and x.undone_at is null)
               or exists (select 1 from public.customer_merges x
                           where x.merged_account_id = a.id and x.undone_at is null)
               then 'merge'
           end
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
     where o.id = p_lead
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_kept_reason(uuid) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 5. Whether nothing about one lead itself has changed since the cutoff and nothing still uses it:
--    not yet anonymised; made, changed and moved before the cutoff; no call, task (changed or due),
--    sizing, Agent Inbox item or agent proposal since; no open duplicate card of leads.
create or replace function app.lead_idle(p_lead uuid, p_cutoff timestamptz) returns boolean
  language plpgsql stable set search_path = '' as $$
begin
  return (
    select exists (
      select 1
        from public.opportunities o
       where o.id = p_lead
         and o.anonymised_at is null
         and o.created_at < p_cutoff
         and o.updated_at < p_cutoff
         and o.state_changed_at < p_cutoff
         and not exists (select 1 from public.calls x
                          where x.opportunity_id = o.id
                            and (x.started_at >= p_cutoff or x.created_at >= p_cutoff))
         and not exists (select 1 from public.tasks x
                          where x.opportunity_id = o.id
                            and (x.updated_at >= p_cutoff or x.due_at >= p_cutoff))
         and not exists (select 1 from public.sizings x
                          where x.opportunity_id = o.id and x.created_at >= p_cutoff)
         and not exists (select 1 from public.inbox_items x
                          where x.subject_id = o.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.agent_actions x
                          where x.input_json ->> 'opportunityId' = o.id::text
                            and (x.created_at >= p_cutoff or x.decided_at >= p_cutoff))
         and not exists (select 1 from public.duplicate_candidates x
                          where x.kind = 'lead' and x.opportunity_id = o.id and x.state = 'open')
         and not exists (select 1 from public.duplicate_candidates x
                          where x.other_opportunity_id = o.id and x.state = 'open'))
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_idle(uuid, timestamptz) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 6. Whether nothing about a customer has changed since the cutoff and nothing else uses it now:
--    in no open duplicate card, sharing none of its people with another customer, and its
--    timeline, relationships with every company, people, phones, consents, sites and Agent Inbox
--    items older than the cutoff. A second company or a merge is judged as a reason to keep
--    (step 4); a customer several companies know goes once every company's leads of it are stale.
create or replace function app.customer_idle(p_account uuid, p_cutoff timestamptz)
  returns boolean
  language plpgsql stable set search_path = '' as $$
begin
  return (
    select exists (
      select 1
        from public.accounts a
       where a.id = p_account
         and a.anonymised_at is null
         and a.updated_at < p_cutoff
         and not exists (select 1 from public.duplicate_candidates x
                          where x.account_id = a.id and x.state = 'open')
         and not exists (select 1 from public.duplicate_candidates x
                          where x.other_account_id = a.id and x.state = 'open')
         and not exists (select 1
                           from public.account_contacts ac
                           join public.account_contacts x
                             on x.contact_id = ac.contact_id and x.account_id <> ac.account_id
                          where ac.account_id = a.id)
         and not exists (select 1 from public.activities x
                          where x.account_id = a.id and x.created_at >= p_cutoff)
         and not exists (select 1 from public.account_entities x
                          where x.account_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.customer_sites x
                          where x.account_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.inbox_items x
                          where x.subject_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1
                           from public.account_contacts ac
                           join public.contacts c on c.id = ac.contact_id
                          where ac.account_id = a.id
                            and (ac.updated_at >= p_cutoff or c.updated_at >= p_cutoff
                                 or exists (select 1 from public.contact_phones p
                                             where p.contact_id = c.id and p.updated_at >= p_cutoff)
                                 or exists (select 1 from public.consents k
                                             where k.contact_id = c.id and k.updated_at >= p_cutoff))))
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_idle(uuid, timestamptz) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 7. Whether a lead may be anonymised now: nothing keeps it or its customer (step 4), its customer
--    is idle, and every lead of that customer, in every company, this one included, is idle. A
--    customer is anonymised with all its leads at once (several stale leads, say from two imported
--    lists or two companies, go together); one live lead keeps the customer and all its leads.
create or replace function app.lead_is_stale(p_lead uuid, p_cutoff timestamptz) returns boolean
  language plpgsql stable set search_path = '' as $$
begin
  return (
    select exists (
      select 1
        from public.opportunities o
       where o.id = p_lead
         and o.anonymised_at is null
         and app.lead_kept_reason(o.id) is null
         and app.customer_idle(o.account_id, p_cutoff)
         and not exists (select 1 from public.opportunities x
                          where x.account_id = o.account_id
                            and not app.lead_idle(x.id, p_cutoff)))
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_is_stale(uuid, timestamptz) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 8. The window of one batch: the next p_limit leads of one company of the request (500 at most)
--    not yet anonymised, not kept for good and never won, whose last change is before the
--    cutoff, oldest change first after the cursor (p_after_at, p_after_id), on
--    opportunities_retention_idx; each with whether it may be anonymised now and whether it is
--    kept for good. The last row is the next batch's cursor, its time exact to the microsecond.
--    The period is between 12 and 120 months, so no call reaches a lead changed in the last
--    year. Reads only, so the dry run calls it on the reader pool too.
create or replace function app.stale_leads(p_entity smallint, p_months integer,
                                           p_after_at timestamptz, p_after_id uuid,
                                           p_limit integer)
  returns table (lead_id uuid, changed_at text, stale boolean, kept boolean)
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
           app.lead_is_stale(w.id, v_cutoff),
           app.lead_kept_reason(w.id) is not null
      from (select o.id, o.updated_at
              from public.opportunities o
             where o.entity_id = p_entity
               and o.anonymised_at is null
               and o.retention_kept_at is null
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

-- 9. What the anonymisation is working on in this transaction: one row per lead, customer,
--     person, site, relationship, task, call, sizing, consent and Agent Inbox item, written and
--     removed by app.anonymise_stale_leads() alone, which no request role can read or write. The
--     append-only triggers of the timeline, agent proposals and the audit trail open their one
--     exception only for a row about a subject named here in the current transaction, and the
--     refusal of writes to an anonymised customer lets the anonymiser's own changes through.
create table app.lead_anonymise_scope (
  tx xid8 not null,
  subject_id uuid not null
);
--> statement-breakpoint
revoke all on app.lead_anonymise_scope from public;
--> statement-breakpoint
create index lead_anonymise_scope_tx_subject_idx on app.lead_anonymise_scope (tx, subject_id);
--> statement-breakpoint

-- Whether a subject is named in this transaction's scope. A definer, so the triggers below may
-- ask whoever writes; it answers nothing about another transaction.
create or replace function app.in_lead_anonymise_scope(p_subject text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_subject is not null
     and exists (select 1 from app.lead_anonymise_scope s
                  where s.tx = pg_catalog.pg_current_xact_id()
                    and s.subject_id::text = p_subject)
$$;
--> statement-breakpoint
revoke execute on function app.in_lead_anonymise_scope(text) from public, readonly_reporter;
--> statement-breakpoint

-- 10. A note's text is free text about a customer: the timeline stays append-only, except that the
--     anonymisation removes the notes of a customer it is anonymising in this transaction. The
--     customer-merge exception of 0113 and 0117 is kept as it is.
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
     and app.in_lead_anonymise_scope(old.account_id::text) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.activities_append_only() from public, readonly_reporter;
--> statement-breakpoint

-- 11. An agent's proposal changes only its decision, once (0108), except that the anonymisation
--     removes the agent's note and a follow-up's title (the free text a proposal can carry) from
--     a proposal about a lead it is anonymising in this transaction, and changes nothing else.
create or replace function app.agent_actions_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'agent_actions is append-only' using errcode = '42501';
  end if;
  if new.input_json = old.input_json - array['note', 'title']
     and new.decided_input_json is not distinct from (old.decided_input_json - array['note', 'title'])
     and (pg_catalog.to_jsonb(new) - 'input_json' - 'decided_input_json')
         = (pg_catalog.to_jsonb(old) - 'input_json' - 'decided_input_json')
     and app.in_lead_anonymise_scope(old.input_json ->> 'opportunityId') then
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

-- 12. The kept marks that can lapse are cleared by the change that ends them, so the window looks
--     at the lead again: a customer's type changed back from dealer or referral partner clears
--     `dealer`; an undone merge clears every mark of both customers' leads but the lead's own
--     facts (won, Qualified reached), since leads, quotes and orders moved back with it. Those
--     still kept are marked again on the next run. Definers, as the leads may be in any company.
create or replace function app.retention_kept_lapse_type() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.type not in ('household', 'farm', 'business')
     and new.type in ('household', 'farm', 'business') then
    update public.opportunities o
       set retention_kept_at = null, retention_kept_reason = null
     where o.account_id = new.id and o.retention_kept_reason = 'dealer';
  end if;
  return null;
end
$$;
--> statement-breakpoint
revoke execute on function app.retention_kept_lapse_type() from public, readonly_reporter;
--> statement-breakpoint
create trigger accounts_retention_kept_lapse after update of type on public.accounts
  for each row execute function app.retention_kept_lapse_type();
--> statement-breakpoint
create or replace function app.retention_kept_lapse_merge() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.undone_at is null and new.undone_at is not null then
    update public.opportunities o
       set retention_kept_at = null, retention_kept_reason = null
     where o.account_id in (new.kept_account_id, new.merged_account_id)
       and o.retention_kept_reason not in ('won', 'qualified');
  end if;
  return null;
end
$$;
--> statement-breakpoint
revoke execute on function app.retention_kept_lapse_merge() from public, readonly_reporter;
--> statement-breakpoint
create trigger customer_merges_retention_kept_lapse after update of undone_at on public.customer_merges
  for each row execute function app.retention_kept_lapse_merge();
--> statement-breakpoint

-- 13. The audit trail keeps every row, but by the owner's decision of 13-10-2026 (DECISIONS) an
--     anonymised customer's history keeps no personal value: every text and number in a row's
--     input, before and after about the customer, its leads, people, sites and their records is
--     replaced by "removed"; record ids, true and false, the action, the actor, the time and the
--     company stay. `app.audit_blank()` is that replacement.
create or replace function app.audit_blank(p_value jsonb) returns jsonb
  language sql immutable set search_path = '' as $$
  select case pg_catalog.jsonb_typeof(p_value)
           when 'object' then
             coalesce((select pg_catalog.jsonb_object_agg(e.key, app.audit_blank(e.value))
                         from pg_catalog.jsonb_each(p_value) e), '{}'::jsonb)
           when 'array' then
             coalesce((select pg_catalog.jsonb_agg(app.audit_blank(e.value) order by e.n)
                         from pg_catalog.jsonb_array_elements(p_value) with ordinality e(value, n)),
                      '[]'::jsonb)
           when 'string' then
             case when (p_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then p_value else '"removed"'::jsonb end
           when 'number' then '"removed"'::jsonb
           else p_value
         end
$$;
--> statement-breakpoint
revoke execute on function app.audit_blank(jsonb) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- A refused command's row keeps the reason and what is not personal: the value of every field
-- named as a person's name, phone, email, village, PIN, address or note, at any depth, is
-- "removed" (the runner does the same when it writes the row, `withoutPersonalDetails()` in
-- packages/domain/src/audit/redact.ts, so a refusal that names no customer keeps nothing of the
-- person either).
create or replace function app.audit_without_personal(p_value jsonb) returns jsonb
  language sql immutable set search_path = '' as $$
  select case pg_catalog.jsonb_typeof(p_value)
           when 'object' then
             coalesce((select pg_catalog.jsonb_object_agg(
                                e.key,
                                case when pg_catalog.lower(pg_catalog.translate(e.key, '_-', ''))
                                            = any (array['name', 'fullname', 'contactname',
                                                         'customername', 'phone', 'phones',
                                                         'mobile', 'whatsapp', 'e164', 'email',
                                                         'village', 'pin', 'pincode', 'address',
                                                         'note'])
                                          and pg_catalog.jsonb_typeof(e.value) <> 'null'
                                     then '"removed"'::jsonb
                                     else app.audit_without_personal(e.value) end)
                         from pg_catalog.jsonb_each(p_value) e), '{}'::jsonb)
           when 'array' then
             coalesce((select pg_catalog.jsonb_agg(app.audit_without_personal(e.value) order by e.n)
                         from pg_catalog.jsonb_array_elements(p_value) with ordinality e(value, n)),
                      '[]'::jsonb)
           else p_value
         end
$$;
--> statement-breakpoint
revoke execute on function app.audit_without_personal(jsonb) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- The audit trail stays append-only, with one exception through `app.lead_anonymise_scope`, open
-- only to the owner (the anonymisation, and this migration's clean-up below), in two forms:
-- the anonymisation replaces, with exactly `app.audit_blank()` of what was there, the input,
-- before and after of a row about a subject it is anonymising in this transaction (by the row's
-- record, or the customer or lead its input names: `accountId`, `opportunityId`,
-- `existingAccountId`, or the lead of an agent's proposal); and a refused command's row named
-- there by its own id may have the personal fields of its input removed
-- (`app.audit_without_personal()`), nothing else. The trigger on the partitioned table reaches
-- every partition.
create or replace function app.audit_logs_append_only() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and (pg_catalog.to_jsonb(new) - array['input_json', 'before_json', 'after_json'])
         = (pg_catalog.to_jsonb(old) - array['input_json', 'before_json', 'after_json']) then
    if new.input_json is not distinct from app.audit_blank(old.input_json)
       and new.before_json is not distinct from app.audit_blank(old.before_json)
       and new.after_json is not distinct from app.audit_blank(old.after_json)
       and (app.in_lead_anonymise_scope(old.aggregate_id)
            or app.in_lead_anonymise_scope(old.input_json ->> 'accountId')
            or app.in_lead_anonymise_scope(old.input_json ->> 'opportunityId')
            or app.in_lead_anonymise_scope(old.input_json ->> 'existingAccountId')
            or app.in_lead_anonymise_scope(old.input_json #>> '{proposal,input,opportunityId}')) then
      return new;
    end if;
    if old.outcome <> 'ok'
       and new.input_json is not distinct from app.audit_without_personal(old.input_json)
       and new.before_json is not distinct from old.before_json
       and new.after_json is not distinct from old.after_json
       and app.in_lead_anonymise_scope(old.id::text) then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.audit_logs_append_only() from public, readonly_reporter;
--> statement-breakpoint
drop trigger audit_logs_append_only on public.audit_logs;
--> statement-breakpoint
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.audit_logs_append_only();
--> statement-breakpoint

-- The refused commands' rows already written keep no personal value either: each is named in the
-- scope by its own id, its input's personal fields removed, and the scope emptied, in one
-- statement, so in one transaction. Sign-in events are the auth module's and name staff only.
do $$
begin
  insert into app.lead_anonymise_scope (tx, subject_id)
  select pg_catalog.pg_current_xact_id(), l.id
    from public.audit_logs l
   where l.outcome <> 'ok' and l.command not like 'auth.%'
     and l.input_json is distinct from app.audit_without_personal(l.input_json);
  update public.audit_logs l
     set input_json = app.audit_without_personal(l.input_json)
   where l.outcome <> 'ok' and l.command not like 'auth.%'
     and l.input_json is distinct from app.audit_without_personal(l.input_json);
  delete from app.lead_anonymise_scope s where s.tx = pg_catalog.pg_current_xact_id();
end
$$;
--> statement-breakpoint

-- 14. No write may land on a customer the anonymisation has emptied. A writer that read the
--     customer or its lead before the job held them reaches here after the job commits: the
--     lock below waits for the job and then reads its result, and the write is refused with the
--     catalogue reason `customer_anonymised`. The anonymisation's own changes pass by its scope.
create or replace function app.refuse_anonymised_customer() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_anonymised timestamptz;
begin
  if new.account_id is null or app.in_lead_anonymise_scope(new.account_id::text) then
    return new;
  end if;
  select a.anonymised_at into v_anonymised
    from public.accounts a where a.id = new.account_id
     for key share;
  if v_anonymised is not null then
    raise exception 'the customer''s details were removed by the retention rule'
      using errcode = 'check_violation', constraint = 'customer_anonymised';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.refuse_anonymised_customer() from public, readonly_reporter;
--> statement-breakpoint
create trigger opportunities_refuse_anonymised before insert on public.opportunities
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger account_entities_refuse_anonymised before insert on public.account_entities
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger account_contacts_refuse_anonymised before insert on public.account_contacts
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger customer_sites_refuse_anonymised before insert or update on public.customer_sites
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger tasks_refuse_anonymised before insert on public.tasks
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger activities_refuse_anonymised before insert on public.activities
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger quotes_refuse_anonymised before insert on public.quotes
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint
create trigger sales_orders_refuse_anonymised before insert on public.sales_orders
  for each row execute function app.refuse_anonymised_customer();
--> statement-breakpoint

-- The skipped rows of an import that repeat an earlier row, by that row's number: the
-- anonymisation clears them with the row they repeat (step 15).
create index import_rows_skipped_repeat_idx on public.import_rows (job_id, (dedupe_json ->> 'inFileRowNo'))
  where state = 'skipped';
--> statement-breakpoint

-- 15. Anonymises the customers of the named leads of one company of the request, one customer at
--     a time, each with all its leads in every company, and marks kept, with the reason, the
--     named leads in p_kept that are (so the window passes them by). For each customer: its
--     leads, the customer and its people are held, skipping a customer any of whose rows a write
--     holds now (it waits for the next night); every lead is checked again
--     (`app.lead_is_stale()`); then
--     removed: the customer's name (left empty) and GSTIN; its people's names (so the generated
--     `name_key` is empty), email addresses and phone numbers; its sites' address, village (so
--     the generated `village_key` is null), PIN, map point and technical notes; the leads'
--     campaign fields; their tasks' titles; the customer's notes on the timeline; the notes of
--     Agent Inbox items about the leads or the customer; the agent's note and a follow-up's title
--     on proposals about the leads; what the import rows that made them said; and every text and
--     number in the input, before and after of the audit rows about the customer, its leads,
--     people, sites, relationships, tasks, calls, sizings, consents and inbox items, including the
--     agents' runs about the leads and the leads made or refused for the known customer (owner,
--     13-10-2026).
--     Kept, as facts without the person: the leads (state, stage, pipeline, score), the
--     customer's type, the sites' tehsil, district and state code (coarse geography for
--     reports), the companies, calls, sizings (numbers only), tags, timeline rows other than notes
--     (ids and codes only), duplicate cards (signal codes only), notices (ids only), consents as
--     the fact of consent with their evidence file, and each audit row's action, actor, time,
--     company and record ids. The leads, the customer, its people and sites are archived, the
--     leads and the customer marked anonymised.
--     A customer whose anonymisation fails changes nothing and is counted; the others go on.
--     Every call is one row of retention_runs (job leads-anonymise): the leads anonymised and,
--     when a customer failed, how many and the last failure's code and constraint, never a value.
--     Answers `{ leads: [{ id, entityId }], kept, failed, error }`: a customer several companies
--     know is anonymised by the call of whichever company finds it first, so a lead may be of
--     another company than the call's.
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
