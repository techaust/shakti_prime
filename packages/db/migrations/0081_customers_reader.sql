-- The customers screens read through `app_reader` as through `app_user` (docs/design/phase1.md
-- §5.2): `select` on the timeline, task and tag tables, their read policies naming the reader
-- beside `app_user`, and the customer search definer the list calls. The reader holds no write
-- privilege on any of them.
grant select on activities, tasks, tags, opportunity_tags to app_reader;
--> statement-breakpoint
alter policy activities_read on activities to app_user, app_reader;
--> statement-breakpoint
alter policy tasks_read on tasks to app_user, app_reader;
--> statement-breakpoint
alter policy tags_read on tags to app_user, app_reader;
--> statement-breakpoint
alter policy opportunity_tags_read on opportunity_tags to app_user, app_reader;
--> statement-breakpoint
-- The candidates of the customers search; it still checks the caller's customer read in its body.
grant execute on function app.customer_search_ids(text, text, integer) to app_reader;
