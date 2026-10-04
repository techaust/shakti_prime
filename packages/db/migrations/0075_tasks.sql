-- The unique keys a lead's tasks and tags refer to come first, before the foreign key that needs them.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_id_entity_unique" UNIQUE("id","entity_id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_id_entity_account_unique" UNIQUE("id","entity_id","account_id");--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"team_id" uuid,
	"kind" text NOT NULL,
	"title" text,
	"due_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tasks_kind_check" CHECK ("tasks"."kind" in ('callback', 'follow_up', 'nurture', 'review')),
	CONSTRAINT "tasks_state_check" CHECK ("tasks"."state" in ('open', 'done', 'cancelled')),
	CONSTRAINT "tasks_done_at_check" CHECK (("tasks"."state" <> 'done') = ("tasks"."done_at" is null)),
	CONSTRAINT "tasks_title_length_check" CHECK (char_length("tasks"."title") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_principals_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_assignee_state_due_idx" ON "tasks" USING btree ("assignee_id","state","due_at");--> statement-breakpoint
CREATE INDEX "tasks_opportunity_idx" ON "tasks" USING btree ("opportunity_id","entity_id","account_id");--> statement-breakpoint
CREATE INDEX "tasks_account_state_due_idx" ON "tasks" USING btree ("account_id","state","due_at");--> statement-breakpoint
CREATE INDEX "tasks_team_idx" ON "tasks" USING btree ("team_id");