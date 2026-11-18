-- A3 WhatsApp Concierge, the thread binding (docs/03-roadmap-appendix/phase2.md §7.2, §4): an
-- agent principal's run is bound to one WhatsApp thread through the transaction setting
-- `app.agent_thread_id`, which only `withRequestContext()` sets, and only for an agent principal.
-- For an agent, the `own` scope of the customer, lead and task read policies then matches that
-- thread's customer (in the thread's company) and its lead alone, and nothing when the setting is
-- unset: an agent never reads by owning a row. The thread policy keeps a bound run to its one
-- thread; messages, contacts, phones, consents and a chat's files are read through the thread and
-- the customer, so they follow. A bound run also reads the approved Playbook directives for
-- customers, its only knowledge. Every policy below is the newest definition on main (0064 for
-- account_entities_read, 0028 for opportunities_read, 0078 for tasks_read, 0183 for
-- whatsapp_threads_read, 0166 for playbook_directives_read) with the agent clause added; `alter
-- policy` keeps each policy's roles. The agent's write policies are unchanged: its own scope
-- writes nothing (`scope_ok` matches rows it owns, and it owns none), since a person runs every
-- Concierge action while Automatic is unavailable.

-- 1. Whether the request is an agent principal's: by its role key, which the context sets from the
--    principal and a person's role never carries.
create or replace function app.is_agent_request() returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
$$;
--> statement-breakpoint
grant execute on function app.is_agent_request() to app_user, app_reader;
--> statement-breakpoint

-- 2. The thread an agent's run is bound to: the setting, read only in an agent's request and only
--    when it is a well-formed id; null otherwise, which binds nothing.
create or replace function app.agent_thread_id() returns uuid
  language sql stable set search_path = '' as $$
  select case
           when app.is_agent_request()
            and coalesce(pg_catalog.current_setting('app.agent_thread_id', true), '')
                  ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then pg_catalog.current_setting('app.agent_thread_id', true)::uuid
         end
$$;
--> statement-breakpoint
grant execute on function app.agent_thread_id() to app_user, app_reader;
--> statement-breakpoint

-- 3. The bound thread's company, customer and lead, read past the thread's own policy (which
--    reads the customer's, so the customer's policy cannot read the thread under row security
--    without a cycle). It answers only an agent principal (the request's role and its principals
--    row both say so) bound to a thread of a company of the request, and nothing otherwise, so
--    the policies that call it fail closed. It tells the agent only the ids of its own thread.
create or replace function app.agent_thread_binding()
  returns table (entity_id smallint, account_id uuid, opportunity_id uuid)
  language sql stable security definer set search_path = '' as $$
  select t.entity_id, t.account_id, t.opportunity_id
    from public.whatsapp_threads t
   where t.id = app.agent_thread_id()
     and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and exists (select 1 from public.principals p
                  where p.id = app.user_id() and p.kind = 'agent')
$$;
--> statement-breakpoint
revoke execute on function app.agent_thread_binding() from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.agent_thread_binding() to app_user, app_reader;
--> statement-breakpoint

-- 4. Customers (0064): a person's own scope is the relationships they own; an agent's own scope is
--    the bound thread's customer in the thread's company. Every other clause is unchanged.
alter policy account_entities_read on account_entities using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.account.read:entity'))
    or ((select app.has_perm('crm.account.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.account.read:own'))
        and ((not (select app.is_agent_request()) and owner_id = (select app.user_id()))
          or (account_id = (select b.account_id from app.agent_thread_binding() b)
              and entity_id = (select b.entity_id from app.agent_thread_binding() b))))
    or ((select coalesce(current_setting('app.role', true), '') not like 'agent:%'
               and coalesce(current_setting('app.role', true), '') not like 'system:%'
               and not exists (select 1 from principals p
                                where p.id = app.user_id() and p.kind in ('agent', 'system')))
        and exists (select 1 from opportunities o
                     where o.account_id = account_entities.account_id
                       and o.entity_id = account_entities.entity_id
                       and o.archived_at is null))));
--> statement-breakpoint

-- 5. Leads (0028): an agent's own scope is the bound thread's lead.
alter policy opportunities_read on opportunities using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.lead.read:entity'))
    or ((select app.has_perm('crm.lead.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.lead.read:own'))
        and ((not (select app.is_agent_request()) and owner_id = (select app.user_id()))
          or id = (select b.opportunity_id from app.agent_thread_binding() b)))));
--> statement-breakpoint

-- 6. Tasks (0078): an agent's own scope is the bound thread's lead's tasks (its open callbacks).
alter policy tasks_read on tasks using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.lead.read:entity'))
    or ((select app.has_perm('crm.lead.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.lead.read:own'))
        and ((not (select app.is_agent_request()) and assignee_id = (select app.user_id()))
          or opportunity_id = (select b.opportunity_id from app.agent_thread_binding() b))))
  and exists (select 1 from opportunities o where o.id = tasks.opportunity_id));
--> statement-breakpoint

-- 7. Threads (0183): a run bound to a thread reads that thread alone, whatever else its customer
--    holds; messages, and a chat's files, are read through the thread.
alter policy whatsapp_threads_read on whatsapp_threads using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((account_id is not null
        and exists (select 1 from account_entities ae
                     where ae.account_id = whatsapp_threads.account_id
                       and ae.entity_id = whatsapp_threads.entity_id
                       and whatsapp_threads.account_id is not null))
    or (account_id is null and (select app.has_perm('messaging.send:entity'))))
  and ((select app.agent_thread_id()) is null or id = (select app.agent_thread_id())));
--> statement-breakpoint

-- 8. Playbook directives (0166): a bound run reads the approved directives for customers of its
--    company and of the whole group, and nothing else of the Playbook.
alter policy playbook_directives_read on playbook_directives using (
  (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0))
  and ((audience in ('customer', 'staff') and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (audience = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))
    or (audience = 'customer' and state = 'approved'
        and (select b.entity_id from app.agent_thread_binding() b) is not null))
  and (state = 'approved'
    or (select app.has_perm('knowledge.playbook.draft:all'))
    or (select app.has_perm('knowledge.playbook.approve:all'))));
