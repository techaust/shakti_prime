CREATE TABLE "crew_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"crew_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "crew_members_person_unique" UNIQUE("crew_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"name" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "crews_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "crews_name_check" CHECK (length("crews"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "schedule_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"engineer_id" uuid,
	"crew_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"travel_min" smallint,
	"state" text DEFAULT 'proposed' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"done_note" text,
	"cancel_reason" text,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "schedule_slots_state_check" CHECK ("schedule_slots"."state" in ('proposed', 'confirmed', 'done', 'cancelled')),
	CONSTRAINT "schedule_slots_assignee_check" CHECK (("schedule_slots"."engineer_id" is null) <> ("schedule_slots"."crew_id" is null)),
	CONSTRAINT "schedule_slots_time_check" CHECK ("schedule_slots"."ends_at" > "schedule_slots"."starts_at" and "schedule_slots"."ends_at" - "schedule_slots"."starts_at" <= interval '12 hours'),
	CONSTRAINT "schedule_slots_travel_check" CHECK ("schedule_slots"."travel_min" is null or "schedule_slots"."travel_min" >= 0),
	CONSTRAINT "schedule_slots_confirmed_check" CHECK (("schedule_slots"."state" in ('confirmed', 'done')) = ("schedule_slots"."confirmed_at" is not null and "schedule_slots"."confirmed_by" is not null)),
	CONSTRAINT "schedule_slots_done_check" CHECK (("schedule_slots"."state" = 'done') = ("schedule_slots"."done_at" is not null and "schedule_slots"."done_by" is not null)),
	CONSTRAINT "schedule_slots_cancel_reason_check" CHECK (("schedule_slots"."state" = 'cancelled') = ("schedule_slots"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "unavailability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "unavailability_kind_check" CHECK ("unavailability"."kind" in ('leave', 'training', 'other')),
	CONSTRAINT "unavailability_time_check" CHECK ("unavailability"."ends_at" > "unavailability"."starts_at" and "unavailability"."ends_at" - "unavailability"."starts_at" <= interval '90 days')
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_person_id_principals_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_fk" FOREIGN KEY ("crew_id","entity_id") REFERENCES "public"."crews"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_lead_id_principals_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_engineer_id_principals_id_fk" FOREIGN KEY ("engineer_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_proposed_by_principals_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_confirmed_by_principals_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_done_by_principals_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_project_fk" FOREIGN KEY ("project_id","entity_id") REFERENCES "public"."projects"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_crew_fk" FOREIGN KEY ("crew_id","entity_id") REFERENCES "public"."crews"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_person_id_principals_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_members_person_idx" ON "crew_members" USING btree ("person_id","crew_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crews_entity_name_unique" ON "crews" USING btree ("entity_id",lower("name")) WHERE "crews"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "schedule_slots_entity_starts_idx" ON "schedule_slots" USING btree ("entity_id","starts_at");--> statement-breakpoint
CREATE INDEX "schedule_slots_engineer_starts_idx" ON "schedule_slots" USING btree ("engineer_id","starts_at") WHERE "schedule_slots"."engineer_id" is not null and "schedule_slots"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "schedule_slots_crew_starts_idx" ON "schedule_slots" USING btree ("crew_id","starts_at") WHERE "schedule_slots"."crew_id" is not null and "schedule_slots"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "schedule_slots_project_idx" ON "schedule_slots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "schedule_slots_milestone_idx" ON "schedule_slots" USING btree ("milestone_id") WHERE "schedule_slots"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "unavailability_person_starts_idx" ON "unavailability" USING btree ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "unavailability_entity_starts_idx" ON "unavailability" USING btree ("entity_id","starts_at");