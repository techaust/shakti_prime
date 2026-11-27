CREATE TABLE "reservation_needs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_needed" numeric(12, 3) NOT NULL,
	"qty_backordered" numeric(12, 3) NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_needs_line_item_unique" UNIQUE("sales_order_line_id","item_id"),
	CONSTRAINT "reservation_needs_qty_check" CHECK ("reservation_needs"."qty_needed" > 0),
	CONSTRAINT "reservation_needs_backordered_check" CHECK ("reservation_needs"."qty_backordered" >= 0 and "reservation_needs"."qty_backordered" <= "reservation_needs"."qty_needed")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone,
	"extended_by" uuid,
	"extended_at" timestamp with time zone,
	"extend_reason" text,
	"release_kind" text,
	"released_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_qty_check" CHECK ("reservations"."qty" > 0),
	CONSTRAINT "reservations_state_check" CHECK ("reservations"."state" in ('active', 'picked', 'released', 'lapsed')),
	CONSTRAINT "reservations_extended_check" CHECK (("reservations"."extended_by" is null) = ("reservations"."extended_at" is null)
          and ("reservations"."extended_by" is null) = ("reservations"."extend_reason" is null)
          and ("reservations"."extend_reason" is null or char_length(btrim("reservations"."extend_reason")) between 1 and 300)),
	CONSTRAINT "reservations_release_kind_check" CHECK ("reservations"."release_kind" is null or "reservations"."release_kind" in ('by_hand', 'order_cancelled', 'moved')),
	CONSTRAINT "reservations_released_check" CHECK (("reservations"."state" = 'released') = ("reservations"."release_kind" is not null)
          and ("reservations"."released_reason" is null or ("reservations"."release_kind" in ('by_hand', 'order_cancelled')
               and char_length(btrim("reservations"."released_reason")) between 1 and 300)))
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "qty_backordered" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "pin_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation_needs" ADD CONSTRAINT "reservation_needs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_needs" ADD CONSTRAINT "reservation_needs_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_needs" ADD CONSTRAINT "reservation_needs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_needs" ADD CONSTRAINT "reservation_needs_order_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_extended_by_principals_id_fk" FOREIGN KEY ("extended_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_need_fk" FOREIGN KEY ("sales_order_line_id","item_id") REFERENCES "public"."reservation_needs"("sales_order_line_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bin_fk" FOREIGN KEY ("bin_id","warehouse_id") REFERENCES "public"."bins"("id","warehouse_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_needs_order_idx" ON "reservation_needs" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "reservation_needs_queue_idx" ON "reservation_needs" USING btree ("entity_id","item_id","queued_at","id") WHERE "reservation_needs"."qty_backordered" > 0;--> statement-breakpoint
CREATE INDEX "reservation_needs_item_idx" ON "reservation_needs" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "reservations_active_bin_idx" ON "reservations" USING btree ("entity_id","bin_id","item_id") WHERE "reservations"."state" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_order_idx" ON "reservations" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "reservations_line_idx" ON "reservations" USING btree ("sales_order_line_id","item_id");--> statement-breakpoint
CREATE INDEX "reservations_expiry_idx" ON "reservations" USING btree ("entity_id","expires_at") WHERE "reservations"."state" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_item_idx" ON "reservations" USING btree ("entity_id","item_id") WHERE "reservations"."state" = 'active';--> statement-breakpoint
CREATE INDEX "reservations_warehouse_idx" ON "reservations" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "reservations_bin_idx" ON "reservations" USING btree ("bin_id");--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_backordered_check" CHECK ("sales_order_lines"."qty_backordered" >= 0 and "sales_order_lines"."qty_backordered" <= "sales_order_lines"."qty");--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_on_hand_check" CHECK ("stock_balances"."qty_reserved" <= "stock_balances"."qty_on_hand");--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_pin_codes_check" CHECK (array_to_string("warehouses"."pin_codes", ',') ~ '^([1-9][0-9]{5}(,[1-9][0-9]{5})*)?$' and cardinality("warehouses"."pin_codes") <= 2000);