-- A3 WhatsApp Concierge, the fix round (the review of A3, 18-11-2026, M3): a run bound to a
-- WhatsApp chat (app.agent_thread_id) reads no internal note of the chat's lead. Each policy keeps
-- every line of its latest definition (A2's 0207) and adds that the request is bound to no chat;
-- `alter policy` keeps its roles (app_user, app_reader). A person's request, the Co-pilot's and the
-- workers' are bound to none, so what they read is unchanged.

-- 1. The Caller Co-pilot's briefs and call summaries: read with the lead, never by a bound run.
alter policy copilot_notes_read on copilot_notes using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.agent_thread_id()) is null
  and exists (select 1 from opportunities o where o.id = copilot_notes.opportunity_id));
--> statement-breakpoint

-- 2. A call's transcript: read with its call, never by a bound run.
alter policy files_call_transcript_read on files using (
  purpose = 'call_transcript'
  and entity_id = any ((select app.entity_ids())::int[])
  and (select app.agent_thread_id()) is null
  and exists (select 1 from provider_calls pc
               where pc.transcript_file_id = files.id and pc.entity_id = files.entity_id
                 and files.purpose = 'call_transcript'));
