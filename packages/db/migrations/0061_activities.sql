-- Partitioned by month (docs/DATABASE.md §7). drizzle-kit cannot emit the PARTITION BY clause, so
-- it was added to the generated statement before the file was applied.
CREATE TABLE "activities" (
	"id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"opportunity_id" uuid,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_principal_id" uuid NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "activities_type_check" CHECK ("activities"."type" in ('lead_created', 'stage_moved', 'assigned', 'nurtured', 'reopened', 'won', 'lost', 'task_created', 'task_done', 'task_rescheduled', 'task_cancelled', 'note', 'customer_updated', 'site_updated', 'consent_recorded', 'consent_withdrawn', 'tagged', 'untagged')),
	CONSTRAINT "activities_body_check" CHECK (("activities"."type" <> 'note') = ("activities"."body" is null) and ("activities"."body" is null or char_length("activities"."body") between 1 and 2000)),
	CONSTRAINT "activities_payload_check" CHECK (jsonb_typeof("activities"."payload_json") = 'object' and octet_length("activities"."payload_json"::text) <= 2000)
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_account_created_idx" ON "activities" USING btree ("account_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "activities_opportunity_created_idx" ON "activities" USING btree ("opportunity_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);