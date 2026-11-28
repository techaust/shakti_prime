CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "project_assignments_person_unique" UNIQUE("project_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "project_flow_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"segment" text NOT NULL,
	"version" integer NOT NULL,
	"steps_json" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid NOT NULL,
	CONSTRAINT "project_flow_templates_version_unique" UNIQUE("entity_id","segment","version"),
	CONSTRAINT "project_flow_templates_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "project_flow_templates_segment_check" CHECK ("project_flow_templates"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc')),
	CONSTRAINT "project_flow_templates_version_check" CHECK ("project_flow_templates"."version" >= 1),
	CONSTRAINT "project_flow_templates_steps_check" CHECK (jsonb_typeof("project_flow_templates"."steps_json") = 'array' and jsonb_array_length("project_flow_templates"."steps_json") between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"state" text DEFAULT 'open' NOT NULL,
	"skip_reason" text,
	"requires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_position_unique" UNIQUE("project_id","position"),
	CONSTRAINT "project_milestones_key_unique" UNIQUE("project_id","key"),
	CONSTRAINT "project_milestones_state_check" CHECK ("project_milestones"."state" in ('open', 'done', 'skipped')),
	CONSTRAINT "project_milestones_key_check" CHECK ("project_milestones"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "project_milestones_position_check" CHECK ("project_milestones"."position" >= 1),
	CONSTRAINT "project_milestones_requires_check" CHECK (jsonb_typeof("project_milestones"."requires") = 'array'),
	CONSTRAINT "project_milestones_done_check" CHECK (("project_milestones"."state" = 'done') = ("project_milestones"."done_at" is not null and "project_milestones"."done_by" is not null)),
	CONSTRAINT "project_milestones_skip_check" CHECK (("project_milestones"."state" = 'skipped') = ("project_milestones"."skip_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"project_no" text NOT NULL,
	"fy" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"site_id" uuid,
	"segment" text NOT NULL,
	"scheme" text NOT NULL,
	"flow" text NOT NULL,
	"template_version_id" uuid,
	"state" text DEFAULT 'active' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid,
	"sanctioned_load_kw" numeric(8, 2),
	"hold_reason" text,
	"cancel_reason" text,
	"handed_over_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "projects_entity_project_no_unique" UNIQUE("entity_id","project_no"),
	CONSTRAINT "projects_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "projects_segment_check" CHECK ("projects"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc')),
	CONSTRAINT "projects_scheme_check" CHECK ("projects"."scheme" in ('none', 'pm_surya_ghar', 'pm_kusum')),
	CONSTRAINT "projects_flow_check" CHECK ("projects"."flow" in ('standard', 'surya_ghar')),
	CONSTRAINT "projects_flow_scheme_check" CHECK (("projects"."flow" = 'surya_ghar') = ("projects"."scheme" = 'pm_surya_ghar')),
	CONSTRAINT "projects_state_check" CHECK ("projects"."state" in ('active', 'on_hold', 'completed', 'cancelled')),
	CONSTRAINT "projects_fy_check" CHECK ("projects"."fy" ~ '^[0-9]{4}-[0-9]{2}$' and right("projects"."fy", 2)::int = (left("projects"."fy", 4)::int + 1) % 100),
	CONSTRAINT "projects_hold_reason_check" CHECK (("projects"."state" = 'on_hold') = ("projects"."hold_reason" is not null)),
	CONSTRAINT "projects_cancel_reason_check" CHECK (("projects"."state" = 'cancelled') = ("projects"."cancel_reason" is not null)),
	CONSTRAINT "projects_sanctioned_load_check" CHECK ("projects"."sanctioned_load_kw" is null or "projects"."sanctioned_load_kw" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_doc_type_check";--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_person_id_principals_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_fk" FOREIGN KEY ("project_id","entity_id") REFERENCES "public"."projects"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_flow_templates" ADD CONSTRAINT "project_flow_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_flow_templates" ADD CONSTRAINT "project_flow_templates_published_by_principals_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_done_by_principals_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_fk" FOREIGN KEY ("project_id","entity_id") REFERENCES "public"."projects"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sales_order_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_fk" FOREIGN KEY ("template_version_id","entity_id") REFERENCES "public"."project_flow_templates"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_assignments_person_idx" ON "project_assignments" USING btree ("person_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_sales_order_live_unique" ON "projects" USING btree ("sales_order_id") WHERE "projects"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "projects_sales_order_idx" ON "projects" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "projects_entity_state_updated_idx" ON "projects" USING btree ("entity_id","state","updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "projects_account_idx" ON "projects" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_doc_type_check" CHECK ("document_sequences"."doc_type" in ('quote', 'sales_order', 'proforma', 'challan', 'purchase_order', 'project')) NOT VALID;