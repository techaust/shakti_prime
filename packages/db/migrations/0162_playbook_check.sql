-- The Playbook's conflict check (docs/03-roadmap-appendix/phase2.md §5.4, SECURITY §3.3): the
-- platform's worker (`system:workers`) holds the platform-only knowledge.playbook.check and no
-- directive read permission; it reaches the directives only through the three definers below,
-- each of which checks the permission. A conflict is a matter of the whole group's Playbook (a
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

-- 2. The drafts a change asks to check: the directive itself when it is a draft whose check has not
--    run on its wording, or, for a directive just approved, the drafts of the same type for an
--    overlapping company whose check ran before that approval (they were never compared with it).
--    Each with its wording, the SHA-256 of its text (the record compares it under lock) and its
--    embedding when it has one (a recheck reuses it).
create or replace function app.playbook_check_targets(p_directive_id uuid)
  returns table (directive_id uuid, entity_id smallint, type text, title text, body text,
                 text_sha256 text, embedding text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v public.playbook_directives;
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or pg_catalog.cardinality(app.entity_ids()) = 0 then
    raise exception 'knowledge.playbook.check is required' using errcode = '42501';
  end if;
  select d.* into v from public.playbook_directives d where d.id = p_directive_id;
  if not found then
    return;
  end if;
  return query
    select d.id, d.entity_id, d.type, d.title, d.text,
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(d.text, 'UTF8')), 'hex'),
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

-- 3. A draft's conflict candidates: approved directives of its type for an overlapping company
--    whose embedding lies within p_max_distance (cosine) of p_embedding, nearest first, at most
--    p_limit. The HNSW index of 0160 serves the order.
create or replace function app.playbook_check_candidates(p_directive_id uuid, p_embedding text,
                                                         p_max_distance real, p_limit integer)
  returns table (other_id uuid, title text, body text, distance real)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v public.playbook_directives;
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or pg_catalog.cardinality(app.entity_ids()) = 0 then
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
  return query
    select n.id, n.title, n.text, n.distance::real
      from (select o.id, o.title, o.text,
                   o.embedding OPERATOR(public.<=>) p_embedding::public.vector as distance
              from public.playbook_directives o
             where o.state = 'approved'
               and o.type = v.type
               and o.id <> v.id
               and o.embedding is not null
               and (v.entity_id is null or o.entity_id is null or o.entity_id = v.entity_id)
             order by o.embedding OPERATOR(public.<=>) p_embedding::public.vector
             limit p_limit) n
     where n.distance <= p_max_distance
     order by n.distance;
end
$$;
--> statement-breakpoint
revoke execute on function app.playbook_check_candidates(uuid, text, real, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.playbook_check_candidates(uuid, text, real, integer) to app_user;
--> statement-breakpoint

-- 4. Records what the check found on a draft: its embedding, and the pairs `[{id, otherId,
--    distance, label, reason}]` (label null when the model could not label one). The draft is
--    locked; a draft no longer a draft, or whose text is no longer the one checked (an edit came
--    in between, and its own check follows), is left as it is and the answer is null. New wording
--    (no embedding yet) drops every earlier pair, resolutions included; a recheck of the same
--    wording keeps a resolved pair as it stands, updates an open one and drops an open one that is
--    no longer a candidate. Each pair names an approved directive of the draft's type. Answers how
--    many pairs are left open, which `conflicts_with` then names.
create or replace function app.record_playbook_check(p_directive_id uuid, p_text_sha256 text,
                                                     p_embedding text, p_pairs jsonb)
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v public.playbook_directives;
  v_pair jsonb;
  v_open uuid[];
begin
  if not app.has_perm('knowledge.playbook.check:entity')
     or pg_catalog.cardinality(app.entity_ids()) = 0 then
    raise exception 'knowledge.playbook.check is required' using errcode = '42501';
  end if;
  if p_pairs is null or pg_catalog.jsonb_typeof(p_pairs) <> 'array' or p_embedding is null then
    raise exception 'a check records an embedding and its pairs' using errcode = '22023';
  end if;
  select d.* into v from public.playbook_directives d where d.id = p_directive_id for update;
  if not found then
    raise exception 'no such directive' using errcode = 'P0002';
  end if;
  if v.state <> 'draft'
     or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.text, 'UTF8')), 'hex') <> p_text_sha256 then
    return null;
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
     set embedding = p_embedding::public.vector, checked_at = pg_catalog.now(),
         conflicts_with = v_open
   where id = v.id;
  return pg_catalog.cardinality(v_open);
end
$$;
--> statement-breakpoint
revoke execute on function app.record_playbook_check(uuid, text, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_playbook_check(uuid, text, text, jsonb) to app_user;
