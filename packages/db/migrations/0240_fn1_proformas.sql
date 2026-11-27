CREATE TABLE "payment_milestone_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"segment" text NOT NULL,
	"version" integer NOT NULL,
	"steps_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "payment_milestone_templates_version_unique" UNIQUE("entity_id","segment","version"),
	CONSTRAINT "payment_milestone_templates_segment_check" CHECK ("payment_milestone_templates"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')),
	CONSTRAINT "payment_milestone_templates_version_check" CHECK ("payment_milestone_templates"."version" >= 1),
	CONSTRAINT "payment_milestone_templates_steps_check" CHECK (jsonb_typeof("payment_milestone_templates"."steps_json") = 'array' and jsonb_array_length("payment_milestone_templates"."steps_json") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "payment_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"template_id" uuid,
	"seq" smallint NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"percent" numeric(5, 2),
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"due_rule" text NOT NULL,
	"due_days" smallint,
	"loan_gate" text DEFAULT 'none' NOT NULL,
	"state" text NOT NULL,
	"due_on" date,
	"waived_at" timestamp with time zone,
	"waived_by" uuid,
	"waive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_milestones_order_seq_unique" UNIQUE("sales_order_id","seq"),
	CONSTRAINT "payment_milestones_order_key_unique" UNIQUE("sales_order_id","key"),
	CONSTRAINT "payment_milestones_seq_check" CHECK ("payment_milestones"."seq" between 1 and 10),
	CONSTRAINT "payment_milestones_key_check" CHECK ("payment_milestones"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "payment_milestones_label_check" CHECK (length(btrim("payment_milestones"."label")) between 2 and 60),
	CONSTRAINT "payment_milestones_percent_check" CHECK ("payment_milestones"."percent" is null or "payment_milestones"."percent" > 0),
	CONSTRAINT "payment_milestones_amounts_check" CHECK ("payment_milestones"."amount" >= 0 and "payment_milestones"."paid_amount" >= 0 and "payment_milestones"."paid_amount" <= "payment_milestones"."amount"),
	CONSTRAINT "payment_milestones_due_rule_check" CHECK ("payment_milestones"."due_rule" in ('on_confirmation', 'before_dispatch', 'on_installation', 'days_after_invoice')),
	CONSTRAINT "payment_milestones_due_days_check" CHECK (("payment_milestones"."due_rule" = 'days_after_invoice') = ("payment_milestones"."due_days" is not null)
       and ("payment_milestones"."due_days" is null or "payment_milestones"."due_days" between 1 and 365)),
	CONSTRAINT "payment_milestones_loan_gate_check" CHECK ("payment_milestones"."loan_gate" in ('none', 'customer_loan')),
	CONSTRAINT "payment_milestones_state_check" CHECK ("payment_milestones"."state" in ('pending', 'due', 'part_paid', 'paid', 'waived')),
	CONSTRAINT "payment_milestones_paid_check" CHECK (("payment_milestones"."state" not in ('pending', 'due') or "payment_milestones"."paid_amount" = 0)
       and ("payment_milestones"."state" <> 'part_paid' or ("payment_milestones"."paid_amount" > 0 and "payment_milestones"."paid_amount" < "payment_milestones"."amount"))
       and ("payment_milestones"."state" <> 'paid' or "payment_milestones"."paid_amount" = "payment_milestones"."amount")),
	CONSTRAINT "payment_milestones_due_on_check" CHECK ("payment_milestones"."state" <> 'due' or "payment_milestones"."due_on" is not null),
	CONSTRAINT "payment_milestones_waive_check" CHECK (("payment_milestones"."state" = 'waived') = ("payment_milestones"."waived_at" is not null)
       and ("payment_milestones"."waived_at" is null) = ("payment_milestones"."waived_by" is null)
       and ("payment_milestones"."waived_at" is null) = ("payment_milestones"."waive_reason" is null)
       and ("payment_milestones"."waive_reason" is null or length(btrim("payment_milestones"."waive_reason")) between 1 and 300))
);
--> statement-breakpoint
CREATE TABLE "proforma_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"proforma_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid,
	"kit_id" uuid,
	"sku" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"hsn" text,
	"works_contract" boolean DEFAULT false NOT NULL,
	"tax_rate_id" uuid,
	"tax_rate_pct" numeric(5, 2),
	"composite_rule_id" uuid,
	"goods_rate_pct" numeric(5, 2),
	"services_rate_pct" numeric(5, 2),
	"taxable_value" numeric(14, 2) NOT NULL,
	"goods_taxable" numeric(14, 2),
	"services_taxable" numeric(14, 2),
	"cgst" numeric(14, 2) NOT NULL,
	"sgst" numeric(14, 2) NOT NULL,
	"igst" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proforma_lines_proforma_position_unique" UNIQUE("proforma_id","position"),
	CONSTRAINT "proforma_lines_position_check" CHECK ("proforma_lines"."position" >= 1),
	CONSTRAINT "proforma_lines_qty_check" CHECK ("proforma_lines"."qty" > 0),
	CONSTRAINT "proforma_lines_amounts_check" CHECK ("proforma_lines"."unit_price" >= 0 and "proforma_lines"."taxable_value" >= 0 and "proforma_lines"."cgst" >= 0 and "proforma_lines"."sgst" >= 0 and "proforma_lines"."igst" >= 0 and "proforma_lines"."line_total" = "proforma_lines"."taxable_value" + "proforma_lines"."cgst" + "proforma_lines"."sgst" + "proforma_lines"."igst")
);
--> statement-breakpoint
CREATE TABLE "proformas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"proforma_no" text NOT NULL,
	"fy" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"state" text DEFAULT 'issued' NOT NULL,
	"place_of_supply_state" text NOT NULL,
	"supply_kind" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) NOT NULL,
	"sgst" numeric(14, 2) NOT NULL,
	"igst" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"round_off" numeric(14, 2) NOT NULL,
	"grand_total" numeric(14, 2) NOT NULL,
	"pdf_file_id" uuid,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "proformas_entity_no_unique" UNIQUE("entity_id","proforma_no"),
	CONSTRAINT "proformas_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "proformas_state_check" CHECK ("proformas"."state" in ('issued', 'cancelled')),
	CONSTRAINT "proformas_supply_kind_check" CHECK ("proformas"."supply_kind" in ('intra', 'inter')),
	CONSTRAINT "proformas_place_of_supply_check" CHECK ("proformas"."place_of_supply_state" ~ '^[0-9]{2}$'),
	CONSTRAINT "proformas_fy_check" CHECK ("proformas"."fy" ~ '^[0-9]{4}-[0-9]{2}$' and right("proformas"."fy", 2)::int = (left("proformas"."fy", 4)::int + 1) % 100),
	CONSTRAINT "proformas_totals_check" CHECK ("proformas"."subtotal" >= 0 and "proformas"."cgst" >= 0 and "proformas"."sgst" >= 0 and "proformas"."igst" >= 0 and "proformas"."tax_total" = "proformas"."cgst" + "proformas"."sgst" + "proformas"."igst" and "proformas"."grand_total" = "proformas"."subtotal" + "proformas"."tax_total" + "proformas"."round_off"),
	CONSTRAINT "proformas_gst_split_check" CHECK (("proformas"."supply_kind" = 'intra' and "proformas"."igst" = 0) or ("proformas"."supply_kind" = 'inter' and "proformas"."cgst" = 0 and "proformas"."sgst" = 0)),
	CONSTRAINT "proformas_round_off_check" CHECK ("proformas"."round_off" between -0.49 and 0.50),
	CONSTRAINT "proformas_cancel_check" CHECK (("proformas"."state" = 'cancelled') = ("proformas"."cancel_reason" is not null)
       and ("proformas"."cancel_reason" is null) = ("proformas"."cancelled_at" is null)
       and ("proformas"."cancel_reason" is null) = ("proformas"."cancelled_by" is null)
       and ("proformas"."cancel_reason" is null or length(btrim("proformas"."cancel_reason")) between 1 and 300))
);
--> statement-breakpoint
ALTER TABLE "payment_milestone_templates" ADD CONSTRAINT "payment_milestone_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestone_templates" ADD CONSTRAINT "payment_milestone_templates_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_waived_by_principals_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_order_entity_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_template_fk" FOREIGN KEY ("template_id") REFERENCES "public"."payment_milestone_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_lines" ADD CONSTRAINT "proforma_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_lines" ADD CONSTRAINT "proforma_lines_proforma_entity_fk" FOREIGN KEY ("proforma_id","entity_id") REFERENCES "public"."proformas"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_lines" ADD CONSTRAINT "proforma_lines_order_line_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_cancelled_by_principals_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_order_entity_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_milestones_template_idx" ON "payment_milestones" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "proforma_lines_order_line_idx" ON "proforma_lines" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proformas_order_live_unique" ON "proformas" USING btree ("sales_order_id") WHERE "proformas"."state" = 'issued';--> statement-breakpoint
CREATE INDEX "proformas_order_idx" ON "proformas" USING btree ("sales_order_id","created_at");--> statement-breakpoint
CREATE INDEX "proformas_pdf_file_idx" ON "proformas" USING btree ("pdf_file_id");