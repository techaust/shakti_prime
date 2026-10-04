-- The nightly rescoring of open and nurture leads (CRM-06, docs/design/phase1.md §6.6) runs as
-- the worker principal `system:workers`, which holds no crm.* permission a person may hold:
-- until the owner decides at T2 it follows an agent's customer rules (ADR 0020), and the rules
-- that test agents only (the note rule of activities_read, app.customer_search_ids(), the command
-- guard's peopleOnly) rely on it. It holds instead the platform-only permission crm.score.refresh,
-- which no person's role and no agent may hold, and reaches leads only through the two definers
-- below: one answers the facts a score is made from for one company's open leads, the other writes
-- only the score columns of that company's open leads. The score itself is computed between them
-- by scoreLead() in packages/domain, never in the database.

create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'crm.score.refresh']::text[]
$$;
--> statement-breakpoint

-- The facts scoreLead() reads for the next open or nurture leads of one company of the request,
-- in id order after p_after, at most p_limit (1,000 at most): the pipeline's segment, the source's
-- code, the site's district, when the lead was made, and its stored score and reasons. The time of
-- the last score change comes back as text, exact to the microsecond, for the write's check.
create or replace function app.lead_score_facts(p_entity smallint, p_after uuid, p_limit integer)
  returns table (
    lead_id uuid,
    lead_segment text,
    source_code text,
    site_district text,
    lead_created_at timestamptz,
    lead_score integer,
    lead_reasons jsonb,
    score_seen text
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.score.refresh:entity') then
    raise exception 'crm.score.refresh is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select o.id, p.segment, ls.code, cs.district, o.created_at, o.score, o.score_reasons_json,
           o.score_changed_at::text
      from public.opportunities o
      join public.pipelines p on p.id = o.pipeline_id
      left join public.lead_sources ls on ls.id = o.source_id
      left join public.customer_sites cs on cs.id = o.site_id
     where o.entity_id = p_entity
       and o.archived_at is null
       and o.state in ('open', 'nurture')
       and (p_after is null or o.id > p_after)
     order by o.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_score_facts(smallint, uuid, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.lead_score_facts(smallint, uuid, integer) to app_user;
--> statement-breakpoint

-- Writes new scores, `[{ id, score, reasons, seen }]`, to open or nurture leads of one company of
-- the request, and only to a lead whose score has not changed since it was read (`seen`, the text
-- app.lead_score_facts() answered): a rule change that rescored the lead meanwhile is kept, not
-- overwritten with a score made from the rules read before it. Touches only the score columns;
-- the caller and the time are stamped as the score's change. Answers how many leads it wrote.
create or replace function app.write_lead_scores(p_entity smallint, p_scores jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_written integer;
begin
  if app.user_id() is null or not app.has_perm('crm.score.refresh:entity') then
    raise exception 'crm.score.refresh is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  update public.opportunities o
     set score = v.score,
         score_reasons_json = coalesce(v.reasons, '[]'::jsonb),
         score_changed_at = now(),
         score_changed_by = app.user_id()
    from jsonb_to_recordset(coalesce(p_scores, '[]'::jsonb))
           as v(id uuid, score integer, reasons jsonb, seen text)
   where o.id = v.id
     and o.entity_id = p_entity
     and o.archived_at is null
     and o.state in ('open', 'nurture')
     and o.score_changed_at is not distinct from v.seen::timestamptz;
  get diagnostics v_written = row_count;
  return v_written;
end
$$;
--> statement-breakpoint
revoke execute on function app.write_lead_scores(smallint, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.write_lead_scores(smallint, jsonb) to app_user;
--> statement-breakpoint

-- A change of a lead's score alone is not an edit of the lead: the leads grid and the queue sort
-- by updated_at, so an update that changes only the score columns keeps updated_at and updated_by,
-- and score_changed_at and score_changed_by record it. Any other change stamps the time as before.
create or replace function app.opportunities_set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (new.score, new.score_reasons_json, new.score_changed_at, new.score_changed_by)
       is distinct from (old.score, old.score_reasons_json, old.score_changed_at, old.score_changed_by)
     and to_jsonb(new) - array['score', 'score_reasons_json', 'score_changed_at',
                               'score_changed_by', 'updated_at', 'updated_by']
       = to_jsonb(old) - array['score', 'score_reasons_json', 'score_changed_at',
                               'score_changed_by', 'updated_at', 'updated_by'] then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger set_updated_at on opportunities;
--> statement-breakpoint
create trigger set_updated_at before update on opportunities
  for each row execute function app.opportunities_set_updated_at();
