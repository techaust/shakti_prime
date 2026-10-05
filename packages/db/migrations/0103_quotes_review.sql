-- Quotes, after review (docs/runs/phase1/s1-quotes.md, H1, M1, L1).
--
-- H1. A quote's PDF is recorded by the render worker, so its creator is `system:workers`, and the
-- general file rule (files_read, 0066) lets a person below company scope read only the files they
-- made. A quote's PDF is read with its quote instead: a second select policy passes a `quote_pdf`
-- file of the request's companies that a quote the caller reads names (quotes_read reads the quote
-- with its lead, so own and team scope reach their own quotes' documents). Policies of one command
-- are joined with OR, so files_read is unchanged for every other file.
create policy files_quote_pdf_read on files for select to app_user, app_reader using (
  purpose = 'quote_pdf'
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from quotes q
               where q.pdf_file_id = files.id
                 and q.entity_id = files.entity_id));
--> statement-breakpoint

-- M1, L1. The ⌘K search's candidate quotes keep to the leads the caller reads before the limit, as
-- app.lead_search_ids() (0052) does: the quote's lead passes the opportunities_read rule (a company
-- of the request, then crm.lead.read at company scope, the caller's team, or their own), read from
-- the same settings the policies read. Otherwise a caller who reads few quotes would get the 200
-- newest matches of the company, most of them colleagues', and miss their own. The typed text is
-- escaped for LIKE exactly as containsPattern() escapes it: a backslash, a percent sign and an
-- underscore each stand for themselves. Ids only.
create or replace function app.quote_search_ids(p_text text, p_limit integer) returns setof uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  v_pattern text := '%' || replace(replace(replace(coalesce(p_text, ''),
                      '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if v_user is null or not v_lead_own then
    raise exception 'crm.lead.read is required' using errcode = '42501';
  end if;
  return query
    select q.id
      from public.quotes q
      join public.opportunities o on o.id = q.opportunity_id
     where q.entity_id = any (v_entities)
       and q.quote_no ilike v_pattern
       and (v_lead_entity
            or (v_lead_team and v_team is not null and o.team_id = v_team)
            or (v_lead_own and o.owner_id = v_user))
     order by lower(q.quote_no) = lower(p_text) desc, q.created_at desc, q.id desc
     limit least(greatest(coalesce(p_limit, 0), 0), 200);
end
$$;
--> statement-breakpoint
revoke execute on function app.quote_search_ids(text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.quote_search_ids(text, integer) to app_user, app_reader;
