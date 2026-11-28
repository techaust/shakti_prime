CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"segment" text NOT NULL,
	"step_key" text NOT NULL,
	"version" integer NOT NULL,
	"items_json" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid NOT NULL,
	CONSTRAINT "checklists_version_unique" UNIQUE("entity_id","segment","step_key","version"),
	CONSTRAINT "checklists_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "checklists_segment_check" CHECK ("checklists"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc')),
	CONSTRAINT "checklists_step_key_check" CHECK ("checklists"."step_key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "checklists_version_check" CHECK ("checklists"."version" >= 1),
	CONSTRAINT "checklists_items_check" CHECK (jsonb_typeof("checklists"."items_json") = 'array' and jsonb_array_length("checklists"."items_json") <= 40)
);
--> statement-breakpoint
CREATE TABLE "project_cost_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"vendor_id" uuid,
	"quantity" numeric(12, 3) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"note" text,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "project_cost_lines_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "project_cost_lines_reverses_unique" UNIQUE("reverses_id"),
	CONSTRAINT "project_cost_lines_kind_check" CHECK ("project_cost_lines"."kind" in ('labour', 'contractor', 'other_direct')),
	CONSTRAINT "project_cost_lines_vendor_check" CHECK (("project_cost_lines"."kind" = 'contractor') = ("project_cost_lines"."vendor_id" is not null)),
	CONSTRAINT "project_cost_lines_rate_check" CHECK ("project_cost_lines"."rate" > 0),
	CONSTRAINT "project_cost_lines_quantity_check" CHECK (("project_cost_lines"."reverses_id" is null) = ("project_cost_lines"."quantity" > 0) and "project_cost_lines"."quantity" <> 0),
	CONSTRAINT "project_cost_lines_amount_check" CHECK ("project_cost_lines"."amount" = round("project_cost_lines"."quantity" * "project_cost_lines"."rate", 2)),
	CONSTRAINT "project_cost_lines_note_check" CHECK ("project_cost_lines"."note" is null or length("project_cost_lines"."note") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "qc_inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"state" text DEFAULT 'submitted' NOT NULL,
	"answers_json" jsonb NOT NULL,
	"photo_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_by" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qc_inspections_state_check" CHECK ("qc_inspections"."state" in ('submitted', 'signed_off', 'rejected')),
	CONSTRAINT "qc_inspections_answers_check" CHECK (jsonb_typeof("qc_inspections"."answers_json") = 'array'),
	CONSTRAINT "qc_inspections_photos_check" CHECK (cardinality("qc_inspections"."photo_file_ids") <= 200 and array_position("qc_inspections"."photo_file_ids", null) is null),
	CONSTRAINT "qc_inspections_decided_check" CHECK (("qc_inspections"."state" = 'submitted') = ("qc_inspections"."decided_at" is null and "qc_inspections"."decided_by" is null)),
	CONSTRAINT "qc_inspections_reject_reason_check" CHECK (("qc_inspections"."state" = 'rejected') = ("qc_inspections"."reject_reason" is not null)),
	CONSTRAINT "qc_inspections_reason_length_check" CHECK ("qc_inspections"."reject_reason" is null or length("qc_inspections"."reject_reason") between 1 and 300),
	CONSTRAINT "qc_inspections_signer_check" CHECK ("qc_inspections"."decided_by" is distinct from "qc_inspections"."submitted_by")
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "kind" text DEFAULT 'supplier' NOT NULL;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_published_by_principals_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_lines" ADD CONSTRAINT "project_cost_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_lines" ADD CONSTRAINT "project_cost_lines_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_lines" ADD CONSTRAINT "project_cost_lines_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_lines" ADD CONSTRAINT "project_cost_lines_project_fk" FOREIGN KEY ("project_id","entity_id") REFERENCES "public"."projects"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_lines" ADD CONSTRAINT "project_cost_lines_reverses_fk" FOREIGN KEY ("reverses_id","entity_id") REFERENCES "public"."project_cost_lines"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_submitted_by_principals_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_project_fk" FOREIGN KEY ("project_id","entity_id") REFERENCES "public"."projects"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_checklist_fk" FOREIGN KEY ("checklist_id","entity_id") REFERENCES "public"."checklists"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_cost_lines_project_idx" ON "project_cost_lines" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "project_cost_lines_vendor_idx" ON "project_cost_lines" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qc_inspections_milestone_live_unique" ON "qc_inspections" USING btree ("milestone_id") WHERE "qc_inspections"."state" <> 'rejected';--> statement-breakpoint
CREATE INDEX "qc_inspections_project_idx" ON "qc_inspections" USING btree ("project_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "qc_inspections_checklist_idx" ON "qc_inspections" USING btree ("checklist_id");--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_kind_check" CHECK ("vendors"."kind" in ('supplier', 'contractor'));