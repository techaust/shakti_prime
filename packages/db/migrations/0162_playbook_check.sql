-- The Playbook's conflict check (docs/03-roadmap-appendix/phase2.md §5.4, SECURITY §3.3): the
-- platform's worker (`system:workers`) holds the platform-only knowledge.playbook.check and no
-- directive read permission; it reaches the directives only through the three definers below,
-- each of which checks the permission (and a request with at least one company, failing closed). A conflict is a matter of the whole group's Playbook (a
-- directive of the group overlaps every company), so the definers reach directives of any company
-- from a request with at least one company; they answer only directives' wording and ids, never a
-- customer's data. Approval and every state change stay the commands' (0161).

-- 1. The worker's permission is platform-only, like the other workers' (0142); every key of the
--    latest definition is kept.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'knowledge.playbook.check']::text[]
$$;
--> statement-breakpoint

-- 2. The wording a check is made of: type, audience, title and text, as one SHA-256, so a record is
--    skipped when any of them changed since the check read the draft. Used inside the definers only.
create or replace function app.playbook_wording_sha256(p_type text, p_audience text, p_title text,
                                                       p_text text) returns text
  language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.concat_ws(pg_catalog.chr(31), p_type, p_audience, p_title, p_text), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
revoke execute on function app.playbook_wording_sha256(text, text, text, text) from public, readonly_reporter;
--> statement-breakpoint

-- 3. The drafts a change asks to check: the directive itself when it is a draft whose check has not
--    run on its wording, or, for a directive just approved, the drafts of the same type for an
--    overlapping company whose check read its candidates before that approval (they were never
--    compared with it). Each with its company, wording, the SHA-256 of that wording (the record
--    compares it under lock) and its embedding when it has one (a recheck reuses it).
create or replace function app.playbook_check_targets(p_directive_id uuid)
  returns table (directive_id uuid, entity_id smallint, type text, audience text, title text,
                 body text, wording_sha256 text, embedding text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v public.playbook_directives;
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or coalesce(pg_catalog.cardinality(app.entity_ids()), 0) = 0 then
    raise exception 'knowledge.playbook.check is required' using errcode = '42501';
  end if;
  select d.* into v from public.playbook_directives d where d.id = p_directive_id;
  if not found then
    return;
  end if;
  return query
    select d.id, d.entity_id, d.type, d.audience, d.title, d.text,
           app.playbook_wording_sha256(d.type, d.audience, d.title, d.text),
           d.embedding::text
      from public.playbook_directives d
     where d.state = 'draft'
       and ((v.state = 'draft' and d.id = v.id and d.checked_at is null)
         or (v.state = 'approved' and d.id <> v.id and d.type = v.type
             and (v.entity_id is null or d.entity_id is null or d.entity_id = v.entity_id)
             and (d.checked_at is null or d.checked_at < v.approved_at)))
     order by d.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.playbook_check_targets(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.playbook_check_targets(uuid) to app_user;
--> statement-breakpoint

-- 4. A draft's conflict candidates: approved directives of its type for an overlapping company
--    whose embedding lies within p_max_distance (cosine) of p_embedding, nearest first, at most
--    p_limit, each with `read_at`, the database time of this read (the transaction's start), which
--    the record stores as `checked_at`. The read takes the type's lock shared, so it waits for an
--    approval of the type in progress and then sees it; an approval after it gets a later time and
--    finds this check stale. Volatile, so its read takes a snapshot after the lock is granted
--    (a stable function reads with the snapshot its calling statement took before the wait, and
--    would miss an approval that committed meanwhile). The order is exact: the candidates are filtered first (the state and
--    type index) and sorted by their distance, never read from an approximate index.
create or replace function app.playbook_check_candidates(p_directive_id uuid, p_embedding text,
                                                         p_max_distance real, p_limit integer)
  returns table (other_id uuid, title text, body text, distance real, read_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.playbook_directives;
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or coalesce(pg_catalog.cardinality(app.entity_ids()), 0) = 0 then
    raise exception 'knowledge.playbook.check is required' using errcode = '42501';
  end if;
  if p_max_distance is null or p_max_distance < 0 or p_max_distance > 2
     or p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'a distance between 0 and 2 and a limit between 1 and 20' using errcode = '22023';
  end if;
  select d.* into v from public.playbook_directives d where d.id = p_directive_id;
  if not found then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('playbook-type:' || v.type, 0));
  return query
    with near as materialized (
      select o.id, o.title, o.text,
             (o.embedding OPERATOR(public.<=>) p_embedding::public.vector)::real as distance
        from public.playbook_directives o
       where o.state = 'approved'
         and o.type = v.type
         and o.id <> v.id
         and o.embedding is not null
         and (v.entity_id is null or o.entity_id is null or o.entity_id = v.entity_id))
    select n.id, n.title, n.text, n.distance, pg_catalog.now()
      from near n
     where n.distance <= p_max_distance
     order by n.distance, n.id
     limit p_limit;
end
$$;
--> statement-breakpoint
revoke execute on function app.playbook_check_candidates(uuid, text, real, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.playbook_check_candidates(uuid, text, real, integer) to app_user;
--> statement-breakpoint

-- 5. Records what the check found on a draft: its embedding, the pairs `[{id, otherId, distance,
--    label, reason}]` (label null when the model could not label one), and `p_as_of`, the time the
--    candidates were read, as `checked_at`. Under the type's lock, then the draft's row lock. A
--    draft no longer a draft, whose wording is no longer the one checked (an edit came in between,
--    and its own check follows), or whose recorded check is newer than this one, is left as it is,
--    and the answer's `open_pairs` is null. New wording (no embedding yet) drops every earlier pair,
--    resolutions included; a recheck of the same wording keeps a resolved pair as it stands,
--    updates an open one and drops an open one that is no longer a candidate. Each pair names an
--    approved directive of the draft's type. Answers how many pairs are left open, which
--    `conflicts_with` then names, and the draft's company.
create or replace function app.record_playbook_check(p_directive_id uuid, p_wording_sha256 text,
                                                     p_as_of timestamptz, p_embedding text,
                                                     p_pairs jsonb)
  returns table (open_pairs integer, entity_id smallint)
  language plpgsql security definer set search_path = '' as $$
declare
  v public.playbook_directives;
  v_type text;
  v_pair jsonb;
  v_open uuid[];
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or coalesce(pg_catalog.cardinality(app.entity_ids()), 0) = 0 then
    raise exception 'knowledge.playbook.check is required' using errcode = '42501';
  end if;
  if p_pairs is null or pg_catalog.jsonb_typeof(p_pairs) <> 'array' or p_embedding is null
     or p_as_of is null or p_as_of > pg_catalog.now() then
    raise exception 'a check records its time, an embedding and its pairs' using errcode = '22023';
  end if;
  select d.type into v_type from public.playbook_directives d where d.id = p_directive_id;
  if not found then
    raise exception 'no such directive' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('playbook-type:' || v_type, 0));
  select d.* into v from public.playbook_directives d where d.id = p_directive_id for update;
  if v.state <> 'draft'
     or app.playbook_wording_sha256(v.type, v.audience, v.title, v.text) <> p_wording_sha256
     or (v.checked_at is not null and v.checked_at > p_as_of) then
    return query select null::integer, v.entity_id;
    return;
  end if;
  if v.embedding is null then
    delete from public.playbook_conflict_checks where directive_id = v.id;
  else
    delete from public.playbook_conflict_checks c
     where c.directive_id = v.id and c.resolved_at is null
       and not exists (select 1 from pg_catalog.jsonb_array_elements(p_pairs) p
                        where (p->>'otherId')::uuid = c.other_id);
  end if;
  for v_pair in select * from pg_catalog.jsonb_array_elements(p_pairs) loop
    if not exists (select 1 from public.playbook_directives o
                    where o.id = (v_pair->>'otherId')::uuid and o.state = 'approved'
                      and o.type = v.type and o.id <> v.id) then
      raise exception 'a pair names an approved directive of the same type' using errcode = '22023';
    end if;
    insert into public.playbook_conflict_checks
      (id, entity_id, directive_id, other_id, distance, label, reason)
    values ((v_pair->>'id')::uuid, v.entity_id, v.id, (v_pair->>'otherId')::uuid,
            (v_pair->>'distance')::real, v_pair->>'label', v_pair->>'reason')
    on conflict (directive_id, other_id) do update
      set distance = excluded.distance, label = excluded.label, reason = excluded.reason
      where public.playbook_conflict_checks.resolved_at is null;
  end loop;
  select coalesce(pg_catalog.array_agg(c.other_id order by c.other_id), '{}'::uuid[]) into v_open
    from public.playbook_conflict_checks c
    join public.playbook_directives o on o.id = c.other_id
   where c.directive_id = v.id and c.resolved_at is null
     and coalesce(c.label, '') <> 'none' and o.state = 'approved';
  update public.playbook_directives
     set embedding = p_embedding::public.vector, checked_at = p_as_of, conflicts_with = v_open
   where id = v.id;
  return query select pg_catalog.cardinality(v_open), v.entity_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_playbook_check(uuid, text, timestamptz, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_playbook_check(uuid, text, timestamptz, text, jsonb) to app_user;
