CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"count_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_id" uuid,
	"expected_qty" numeric(12, 3) NOT NULL,
	"counted_qty" numeric(12, 3),
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"recount_requested_at" timestamp with time zone,
	"recount_requested_by" uuid,
	"recount_qty" numeric(12, 3),
	"recounted_by" uuid,
	"recounted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_lines_qty_check" CHECK ("stock_count_lines"."expected_qty" >= 0 and coalesce("stock_count_lines"."counted_qty", 0) >= 0 and coalesce("stock_count_lines"."recount_qty", 0) >= 0),
	CONSTRAINT "stock_count_lines_serial_qty_check" CHECK ("stock_count_lines"."serial_id" is null
          or ("stock_count_lines"."expected_qty" in (0, 1) and coalesce("stock_count_lines"."counted_qty", 0) in (0, 1)
              and coalesce("stock_count_lines"."recount_qty", 0) in (0, 1))),
	CONSTRAINT "stock_count_lines_counted_check" CHECK (("stock_count_lines"."counted_qty" is null) = ("stock_count_lines"."counted_at" is null)
          and ("stock_count_lines"."counted_qty" is null) = ("stock_count_lines"."counted_by" is null)),
	CONSTRAINT "stock_count_lines_recount_check" CHECK (("stock_count_lines"."recount_qty" is null) = ("stock_count_lines"."recounted_at" is null)
          and ("stock_count_lines"."recount_qty" is null) = ("stock_count_lines"."recounted_by" is null)
          and ("stock_count_lines"."recount_requested_at" is null) = ("stock_count_lines"."recount_requested_by" is null)
          and ("stock_count_lines"."recount_qty" is null or "stock_count_lines"."recount_requested_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_bin_ids" uuid[],
	"scope_item_ids" uuid[],
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"post_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "stock_counts_state_check" CHECK ("stock_counts"."state" in ('open', 'counting', 'review', 'posted', 'cancelled')),
	CONSTRAINT "stock_counts_scope_check" CHECK ("stock_counts"."scope" in ('hub', 'bins', 'items')),
	CONSTRAINT "stock_counts_scope_lists_check" CHECK (("stock_counts"."scope" = 'hub' and "stock_counts"."scope_bin_ids" is null and "stock_counts"."scope_item_ids" is null)
          or ("stock_counts"."scope" = 'bins' and cardinality("stock_counts"."scope_bin_ids") between 1 and 200 and "stock_counts"."scope_item_ids" is null)
          or ("stock_counts"."scope" = 'items' and cardinality("stock_counts"."scope_item_ids") between 1 and 200 and "stock_counts"."scope_bin_ids" is null)),
	CONSTRAINT "stock_counts_posted_check" CHECK (("stock_counts"."state" = 'posted') = ("stock_counts"."posted_at" is not null and "stock_counts"."posted_by" is not null and "stock_counts"."post_note" is not null)),
	CONSTRAINT "stock_counts_cancelled_check" CHECK (("stock_counts"."state" = 'cancelled') = ("stock_counts"."cancelled_at" is not null and "stock_counts"."cancelled_by" is not null and "stock_counts"."cancel_reason" is not null)),
	CONSTRAINT "stock_counts_notes_check" CHECK (("stock_counts"."post_note" is null or char_length("stock_counts"."post_note") between 3 and 300)
          and ("stock_counts"."cancel_reason" is null or char_length("stock_counts"."cancel_reason") between 3 and 300))
);
--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_counted_by_principals_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_recount_requested_by_principals_id_fk" FOREIGN KEY ("recount_requested_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_recounted_by_principals_id_fk" FOREIGN KEY ("recounted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("count_id","entity_id") REFERENCES "public"."stock_counts"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_serial_fk" FOREIGN KEY ("serial_id","entity_id","item_id") REFERENCES "public"."serials"("id","entity_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_started_by_principals_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_submitted_by_principals_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_principals_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_cancelled_by_principals_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_item_unique" ON "stock_count_lines" USING btree ("count_id","bin_id","item_id") WHERE "stock_count_lines"."serial_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_serial_unique" ON "stock_count_lines" USING btree ("count_id","bin_id","serial_id") WHERE "stock_count_lines"."serial_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_count_lines_group_idx" ON "stock_count_lines" USING btree ("count_id","bin_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_count_lines_serial_idx" ON "stock_count_lines" USING btree ("count_id","serial_id") WHERE "stock_count_lines"."serial_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_live_unique" ON "stock_counts" USING btree ("entity_id","warehouse_id") WHERE "stock_counts"."state" in ('open', 'counting', 'review');--> statement-breakpoint
CREATE INDEX "stock_counts_list_idx" ON "stock_counts" USING btree ("entity_id","state","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_counts_warehouse_idx" ON "stock_counts" USING btree ("warehouse_id");