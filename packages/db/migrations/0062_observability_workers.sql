-- Phase 1, slice P1: observability and workers (docs/design/phase1.md §5.2).
--
-- 1. Audit retention: partitions of `audit_logs` whose month ended more than eight years ago
--    (BLUEPRINT §7.9) are detached into `audit_archive`, a schema no request role may use, so the
--    rows are kept for the auditors and leave every request's reach. The procedure records its
--    run in `retention_runs` and commits it first, detaches in one block, and on a failure records
--    the error, commits that and raises, so pg_cron reports the run failed (the pattern of
--    app.purge_outbox_events()). A procedure that commits may not pin a search path, so every
--    name, type and operator is qualified. Run only by pg_cron and the migrator as the owner.
create schema if not exists audit_archive;
--> statement-breakpoint
revoke all on schema audit_archive from public;
--> statement-breakpoint
create or replace procedure app.detach_audit_partitions()
language plpgsql as $$
declare
  v_run pg_catalog.uuid := app.uuid_v7();
  v_detached pg_catalog.int4 := 0;
  v_error pg_catalog.text;
  v_names pg_catalog.text[];
  v_name pg_catalog.text;
  v_cutoff pg_catalog.timestamp :=
    pg_catalog.timezone('UTC', pg_catalog.now()) operator(pg_catalog.-) '8 years'::pg_catalog.interval;
begin
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'audit-logs-detach', pg_catalog.clock_timestamp());
  commit;
  begin
    -- Monthly partitions are named by app.ensure_audit_partitions(): audit_logs_YYYY_MM, whose
    -- month ends a month after the first day it names. The default partition is never detached.
    select pg_catalog.array_agg(c.relname::pg_catalog.text order by c.relname)
      into v_names
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid operator(pg_catalog.=) i.inhrelid
      join pg_catalog.pg_namespace n on n.oid operator(pg_catalog.=) c.relnamespace
     where i.inhparent operator(pg_catalog.=) 'public.audit_logs'::pg_catalog.regclass
       and n.nspname operator(pg_catalog.=) 'audit_partitions'
       and c.relname operator(pg_catalog.~) '^audit_logs_[0-9]{4}_[0-9]{2}$'
       and (pg_catalog.to_date(pg_catalog.substr(c.relname, 12, 7), 'YYYY_MM')::pg_catalog.timestamp
              operator(pg_catalog.+) '1 month'::pg_catalog.interval)
           operator(pg_catalog.<=) v_cutoff;
    if v_names is not null then
      foreach v_name in array v_names loop
        execute pg_catalog.format(
          'alter table public.audit_logs detach partition audit_partitions.%I', v_name);
        execute pg_catalog.format('alter table audit_partitions.%I set schema audit_archive', v_name);
        v_detached := v_detached operator(pg_catalog.+) 1;
      end loop;
    end if;
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is not null then
    update public.retention_runs
       set finished_at = pg_catalog.clock_timestamp(), error = pg_catalog.left(v_error, 500)
     where id operator(pg_catalog.=) v_run;
    commit;
    raise exception 'audit-logs-detach failed: %', v_error;
  end if;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(), rows_affected = v_detached
   where id operator(pg_catalog.=) v_run;
end
$$;
--> statement-breakpoint
revoke execute on procedure app.detach_audit_partitions() from public, app_user, readonly_reporter, auth_service, outbox_publisher, app_reader;
--> statement-breakpoint
-- On the 1st of each month at 03:30 UTC, after the month before has closed.
select cron.schedule('audit-logs-detach', '30 3 1 * *', 'call app.detach_audit_partitions()');
--> statement-breakpoint

-- 2. Integration Health reads the outbox through this definer: `app_user` reads no outbox row.
--    It answers, for the request's companies only, the counts by type and one page of dead
--    letters (ids, type, attempts, times and the last error when it is a code, `other` when it is
--    not), newest first after the keyset cursor, one row more than the limit so the caller knows
--    a next page exists. Never a payload.
create or replace function app.outbox_health(p_cursor_at timestamptz, p_cursor_id uuid, p_limit integer)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entities integer[] := app.entity_ids();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_types jsonb;
  v_total integer;
  v_items jsonb;
begin
  if app.user_id() is null or not app.has_perm('admin.integrations.write:all')
     or coalesce(cardinality(v_entities), 0) = 0 then
    raise exception 'admin.integrations.write:all is required' using errcode = '42501';
  end if;
  -- Two reads, each on its partial index: the pending rows and the dead letters.
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', t.type, 'pending', t.pending, 'due', t.due, 'deadLettered', t.dead_lettered,
           'oldestPendingAt', t.oldest_pending_at) order by t.type), '[]'::jsonb)
    into v_types
    from (select o.type,
                 (count(*) filter (where not o.dead))::integer as pending,
                 (count(*) filter (where o.due))::integer as due,
                 (count(*) filter (where o.dead))::integer as dead_lettered,
                 min(o.created_at) filter (where not o.dead) as oldest_pending_at
            from (select e.type, e.created_at, false as dead,
                         (e.next_attempt_at is null or e.next_attempt_at <= now())
                           and (e.claimed_until is null or e.claimed_until <= now()) as due
                    from public.outbox_events e
                   where e.published_at is null and e.dead_lettered_at is null
                     and e.entity_id = any (v_entities)
                  union all
                  select e.type, e.created_at, true, false
                    from public.outbox_events e
                   where e.dead_lettered_at is not null
                     and e.entity_id = any (v_entities)) o
           group by o.type) t;
  select count(*)::integer into v_total
    from public.outbox_events e
   where e.dead_lettered_at is not null and e.entity_id = any (v_entities);
  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', d.id, 'type', d.type, 'entityId', d.entity_id,
           'aggregateType', d.aggregate_type, 'aggregateId', d.aggregate_id,
           'attempts', d.attempts, 'errorCode', d.error_code, 'createdAt', d.created_at,
           'deadLetteredAt', d.dead_lettered_at, 'cursorAt', d.dead_lettered_at::text)
           order by d.dead_lettered_at desc, d.id desc), '[]'::jsonb)
    into v_items
    from (select e.id, e.type, e.entity_id, e.aggregate_type, e.aggregate_id, e.attempts,
                 e.created_at, e.dead_lettered_at,
                 case when e.last_error is null then null
                      when e.last_error ~ '^[A-Za-z][A-Za-z0-9_.]{0,63}$' then e.last_error
                      else 'other' end as error_code
            from public.outbox_events e
           where e.dead_lettered_at is not null
             and e.entity_id = any (v_entities)
             and (p_cursor_at is null or (e.dead_lettered_at, e.id) < (p_cursor_at, p_cursor_id))
           order by e.dead_lettered_at desc, e.id desc
           limit v_limit + 1) d;
  return jsonb_build_object('byType', v_types,
                            'deadLetters', jsonb_build_object('total', v_total, 'items', v_items));
end
$$;
--> statement-breakpoint
revoke execute on function app.outbox_health(timestamptz, uuid, integer) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.outbox_health(timestamptz, uuid, integer) to app_user, app_reader;
--> statement-breakpoint

-- 3. `app_reader`, the queries' own login role (created by src/migrate.ts): `select` on exactly
--    what `app_user` may select, table by table and column by column, under the same policies.
--    Every policy that names `app_user` for select (or for every command) names `app_reader` too;
--    a policy for every command gives the reader no write, since it holds no write privilege.
grant usage on schema public, app to app_reader;
--> statement-breakpoint
do $$
declare
  r record;
begin
  for r in
    select t.table_name
      from information_schema.role_table_grants t
     where t.grantee = 'app_user' and t.privilege_type = 'SELECT' and t.table_schema = 'public'
  loop
    execute format('grant select on public.%I to app_reader', r.table_name);
  end loop;
  -- Column grants (`sessions`), for tables `app_user` may not select whole.
  for r in
    select c.table_name, string_agg(format('%I', c.column_name), ', ') as columns
      from information_schema.column_privileges c
     where c.grantee = 'app_user' and c.privilege_type = 'SELECT' and c.table_schema = 'public'
       and not exists (select 1 from information_schema.role_table_grants t
                        where t.grantee = 'app_user' and t.privilege_type = 'SELECT'
                          and t.table_schema = 'public' and t.table_name = c.table_name)
     group by c.table_name
  loop
    execute format('grant select (%s) on public.%I to app_reader', r.columns, r.table_name);
  end loop;
end
$$;
--> statement-breakpoint
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, roles
      from pg_policies
     where 'app_user' = any (roles) and not 'app_reader' = any (roles) and cmd in ('SELECT', 'ALL')
  loop
    execute format('alter policy %I on %I.%I to %s', p.policyname, p.schemaname, p.tablename,
                   (select string_agg(quote_ident(r), ', ')
                      from unnest(p.roles || array['app_reader']::name[]) r));
  end loop;
end
$$;
--> statement-breakpoint
-- The definers a read calls: those a select policy names, and the lead search behind ⌘K. Each
-- still checks its permission in its body; none of them writes.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prosecdef
       and (p.proname = 'lead_search_ids'
            or exists (select 1 from pg_policies pol
                        where 'app_user' = any (pol.roles) and pol.cmd in ('SELECT', 'ALL')
                          and coalesce(pol.qual, '') ~ ('app\.' || p.proname || '\(')))
  loop
    execute format('grant execute on function %s to app_reader', f.fn);
  end loop;
end
$$;
