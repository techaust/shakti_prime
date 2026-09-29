-- The customer timeline (docs/DATABASE.md §6.2, §7): monthly partitions, append-only, fail-closed RLS.

-- Partitions live in a schema no request role can use, so a partition can never be read or
-- written around the policies on the parent. Rows reach them only through `activities`.
create schema if not exists crm_partitions;
--> statement-breakpoint
revoke all on schema crm_partitions from public;
--> statement-breakpoint

-- A row whose month has no partition lands here instead of failing the command it records.
create table crm_partitions.activities_default partition of public.activities default;
--> statement-breakpoint

-- Creates the partition of the current UTC month and of the next `p_months_ahead` months.
-- Idempotent; run by the migrator and by pg_cron, never by a request role.
create or replace function app.ensure_activity_partitions(p_months_ahead int default 3) returns int
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
declare
  first_month timestamp := date_trunc('month', now() at time zone 'UTC');
  lo timestamptz;
  hi timestamptz;
  part text;
  created int := 0;
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 24 then
    raise exception 'months ahead must be between 0 and 24' using errcode = 'invalid_parameter_value';
  end if;
  for i in 0..p_months_ahead loop
    lo := (first_month + make_interval(months => i)) at time zone 'UTC';
    hi := (first_month + make_interval(months => i + 1)) at time zone 'UTC';
    part := 'activities_' || to_char(lo at time zone 'UTC', 'YYYY_MM');
    if to_regclass(format('crm_partitions.%I', part)) is null then
      execute format(
        'create table crm_partitions.%I partition of public.activities for values from (%L) to (%L)',
        part, lo, hi);
      created := created + 1;
    end if;
  end loop;
  return created;
end
$$;
--> statement-breakpoint
revoke execute on function app.ensure_activity_partitions(int) from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select app.ensure_activity_partitions(3);
--> statement-breakpoint

-- Next months' partitions are made on the 25th, well before they are needed (DATABASE §7).
select cron.schedule('activities-partitions', '5 3 25 * *', 'select app.ensure_activity_partitions(3)');
--> statement-breakpoint

-- Append-only for every role (DATABASE §5): no update or delete grant, and a trigger as well.
create trigger activities_append_only before update or delete on activities
  for each row execute function app.raise_append_only();
--> statement-breakpoint

alter table activities enable row level security;
--> statement-breakpoint
alter table activities force row level security;
--> statement-breakpoint

-- A row is readable when its lead is readable (the exists runs under opportunities_read), or, for
-- a row of no lead, when its customer is readable in the row's company (account_entities_read,
-- which never shows a customer to an agent through a lead, 0057). Both exists are index probes:
-- the lead's primary key, and account_entities (account_id, entity_id).
create policy activities_read on activities for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.entity_id = activities.entity_id))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = activities.account_id
                       and ae.entity_id = activities.entity_id))));
--> statement-breakpoint

-- Commands write as the caller, in a company of the request, about a lead or customer the caller
-- reads at that moment; a lead's row names the lead's own customer and company, so a row can
-- never tie a lead to another customer. A command that hands a lead to someone else records the
-- row before the lead leaves the caller's scope.
create policy activities_insert on activities for insert to app_user with check (
  actor_principal_id = (select app.user_id())
  and entity_id = any ((select app.entity_ids())::int[])
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.account_id = activities.account_id
                       and o.entity_id = activities.entity_id))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = activities.account_id
                       and ae.entity_id = activities.entity_id))));
--> statement-breakpoint

grant select, insert on activities to app_user;
