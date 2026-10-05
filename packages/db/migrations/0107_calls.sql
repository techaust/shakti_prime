-- The calls log (docs/design/phase1.md §7.2). A logged call is a row of the customer timeline; the
-- check names the column alone: the table is partitioned, and each partition takes the check under
-- its own name.
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"number_series" text NOT NULL,
	"disposition_id" uuid NOT NULL,
	"attempt_no" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_s" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_direction_check" CHECK ("calls"."direction" in ('outbound', 'inbound')),
	CONSTRAINT "calls_number_series_check" CHECK ("calls"."number_series" in ('manual', '140', '160', 'inbound')),
	CONSTRAINT "calls_attempt_no_check" CHECK ("calls"."attempt_no" between 1 and 1000),
	CONSTRAINT "calls_duration_check" CHECK ("calls"."duration_s" is null or "calls"."duration_s" between 0 and 14400)
);
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_type_check";--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_principals_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_disposition_id_call_dispositions_id_fk" FOREIGN KEY ("disposition_id") REFERENCES "public"."call_dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_opportunity_entity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_opportunity_started_idx" ON "calls" USING btree ("opportunity_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_caller_started_idx" ON "calls" USING btree ("caller_id","started_at");--> statement-breakpoint
CREATE INDEX "calls_disposition_idx" ON "calls" USING btree ("disposition_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_type_check" CHECK ("type" in ('lead_created', 'stage_moved', 'assigned', 'nurtured', 'reopened', 'won', 'lost', 'task_created', 'task_done', 'task_rescheduled', 'task_cancelled', 'note', 'customer_updated', 'site_updated', 'consent_recorded', 'consent_withdrawn', 'tagged', 'untagged', 'sizing_recorded', 'call_logged'));