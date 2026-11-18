CREATE TABLE "whatsapp_milestone_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"milestone" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"outcome" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_milestone_sends_subject_unique" UNIQUE("milestone","subject_kind","subject_id"),
	CONSTRAINT "whatsapp_milestone_sends_milestone_check" CHECK ("whatsapp_milestone_sends"."milestone" in ('quote_sent', 'order_confirmed', 'dispatched', 'visit_booked', 'visit_reminder', 'installed', 'payment_due', 'handover_kit')),
	CONSTRAINT "whatsapp_milestone_sends_subject_kind_check" CHECK ("whatsapp_milestone_sends"."subject_kind" in ('quote', 'sales_order')),
	CONSTRAINT "whatsapp_milestone_sends_outcome_check" CHECK ("whatsapp_milestone_sends"."outcome" in ('queued', 'held')),
	CONSTRAINT "whatsapp_milestone_sends_shape_check" CHECK (("whatsapp_milestone_sends"."outcome" = 'queued') = ("whatsapp_milestone_sends"."message_id" is not null)
          and ("whatsapp_milestone_sends"."message_id" is null or "whatsapp_milestone_sends"."thread_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"milestone" text NOT NULL,
	"template_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "whatsapp_milestones_entity_milestone_unique" UNIQUE("entity_id","milestone"),
	CONSTRAINT "whatsapp_milestones_milestone_check" CHECK ("whatsapp_milestones"."milestone" in ('quote_sent', 'order_confirmed', 'dispatched', 'visit_booked', 'visit_reminder', 'installed', 'payment_due', 'handover_kit'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" DROP CONSTRAINT "whatsapp_templates_purpose_check";--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_id_entity_unique" UNIQUE("id","entity_id");--> statement-breakpoint
ALTER TABLE "whatsapp_milestone_sends" ADD CONSTRAINT "whatsapp_milestone_sends_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestone_sends" ADD CONSTRAINT "whatsapp_milestone_sends_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestone_sends" ADD CONSTRAINT "whatsapp_milestone_sends_thread_fk" FOREIGN KEY ("thread_id","entity_id") REFERENCES "public"."whatsapp_threads"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestones" ADD CONSTRAINT "whatsapp_milestones_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestones" ADD CONSTRAINT "whatsapp_milestones_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestones" ADD CONSTRAINT "whatsapp_milestones_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_milestones" ADD CONSTRAINT "whatsapp_milestones_template_fk" FOREIGN KEY ("template_id","entity_id") REFERENCES "public"."whatsapp_templates"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_milestone_sends_thread_idx" ON "whatsapp_milestone_sends" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "whatsapp_milestone_sends_message_idx" ON "whatsapp_milestone_sends" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "whatsapp_milestones_template_idx" ON "whatsapp_milestones" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_purpose_check" CHECK ("whatsapp_templates"."purpose" is null or "whatsapp_templates"."purpose" in ('welcome', 'opt_out_confirmation', 'acceptance_code', 'quote_expired')) NOT VALID;