-- Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, docs/05-database.md §6.9, SECURITY
-- §3.2 and §7): a conversation and its messages are their person's alone. A person reads their
-- own rows in a request that covers every company the conversation covers, since an answer may
-- hold figures of each; nobody else reads them, the reporting role included. The commands
-- `knowledge.ask.record` and `knowledge.ask.delete` write them, as the person, with
-- knowledge.ask; a message is written once and never changed. The retention sweep removes a
-- conversation 90 days after it was last used, and a message 90 days after it was asked
-- (`WORKSHOP_DEFAULTS.retention.askDays`, which a security test keeps equal to the job's days).

-- 1. ask_conversations.
alter table ask_conversations enable row level security;
--> statement-breakpoint
alter table ask_conversations force row level security;
--> statement-breakpoint
create policy ask_conversations_read on ask_conversations for select to app_user, app_reader using (
  user_id = (select app.user_id())
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
create policy ask_conversations_insert on ask_conversations for insert to app_user with check (
  (select app.has_perm('knowledge.ask:team'))
  and user_id = (select app.user_id())
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
-- Only its last-used time changes (a column grant), when a follow-up is asked.
create policy ask_conversations_update on ask_conversations for update to app_user
  using ((select app.has_perm('knowledge.ask:team'))
         and user_id = (select app.user_id())
         and entity_ids::int[] <@ (select app.entity_ids())::int[])
  with check (user_id = (select app.user_id())
              and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
-- The person removes their own conversation; its messages go with it (the foreign key's cascade).
create policy ask_conversations_delete on ask_conversations for delete to app_user using (
  user_id = (select app.user_id())
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
revoke all on ask_conversations from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on ask_conversations to app_user, app_reader;
--> statement-breakpoint
grant insert, delete on ask_conversations to app_user;
--> statement-breakpoint
grant update (updated_at) on ask_conversations to app_user;
--> statement-breakpoint

-- 2. ask_messages: the composite foreign key keeps a message's person and companies equal to its
--    conversation's, so the same rule reads both.
alter table ask_messages enable row level security;
--> statement-breakpoint
alter table ask_messages force row level security;
--> statement-breakpoint
create policy ask_messages_read on ask_messages for select to app_user, app_reader using (
  user_id = (select app.user_id())
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
create policy ask_messages_insert on ask_messages for insert to app_user with check (
  (select app.has_perm('knowledge.ask:team'))
  and user_id = (select app.user_id())
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
revoke all on ask_messages from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on ask_messages to app_user, app_reader;
--> statement-breakpoint
grant insert on ask_messages to app_user;
--> statement-breakpoint

-- 3. The retention sweep (pg_cron, as the table owner): messages asked `p_days` days ago, then
--    conversations last used `p_days` days ago with the rest of their messages. Answers how many
--    rows it removed. No request role may call it.
create or replace function app.purge_ask_conversations(p_days integer) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_messages pg_catalog.int4;
  v_conversations pg_catalog.int4;
begin
  if p_days is null or p_days < 1 then
    raise exception 'the days to keep must be at least 1' using errcode = '22023';
  end if;
  delete from public.ask_messages
   where created_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days);
  get diagnostics v_messages = row_count;
  delete from public.ask_conversations
   where updated_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days);
  get diagnostics v_conversations = row_count;
  return v_messages + v_conversations;
end
$$;
--> statement-breakpoint
revoke execute on function app.purge_ask_conversations(integer) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
-- The limits match `JOB_RUN_LIMIT_MINUTES` (packages/domain/src/queries/platform/scheduled-jobs.ts).
select cron.schedule('ask-conversations-purge', '50 2 * * *',
  'set lock_timeout = ''5s''; set statement_timeout = ''5min''; select app.purge_ask_conversations(90)');
