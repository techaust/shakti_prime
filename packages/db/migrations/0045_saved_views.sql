CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"screen" text NOT NULL,
	"name" text NOT NULL,
	"settings_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_name_unique" UNIQUE("principal_id","screen","name"),
	CONSTRAINT "saved_views_screen_check" CHECK ("saved_views"."screen" in ('leads', 'team_members', 'price_lists', 'imports')),
	CONSTRAINT "saved_views_name_check" CHECK (char_length("saved_views"."name") between 1 and 60 and "saved_views"."name" = btrim("saved_views"."name")),
	CONSTRAINT "saved_views_settings_check" CHECK (jsonb_typeof("saved_views"."settings_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Saved views (DESIGN.md §6): each person reads, writes and removes their own views only, in any
-- company, as idempotency keys are kept (migration 0037). The owner of a view never changes, and
-- the reporting role has no grant at all.
create trigger set_updated_at before update on saved_views for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table saved_views enable row level security;
--> statement-breakpoint
alter table saved_views force row level security;
--> statement-breakpoint
create policy saved_views_read on saved_views for select to app_user
  using (principal_id = (select app.user_id()));
--> statement-breakpoint
create policy saved_views_insert on saved_views for insert to app_user
  with check (principal_id = (select app.user_id()));
--> statement-breakpoint
create policy saved_views_update on saved_views for update to app_user
  using (principal_id = (select app.user_id()))
  with check (principal_id = (select app.user_id()));
--> statement-breakpoint
create policy saved_views_delete on saved_views for delete to app_user
  using (principal_id = (select app.user_id()));
--> statement-breakpoint
grant select, insert, update (name, settings_json), delete on saved_views to app_user;
