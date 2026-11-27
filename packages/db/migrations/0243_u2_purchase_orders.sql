CREATE TABLE "goods_receipt_line_rates" (
	"receipt_line_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"unit_rate" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_line_rates_rate_check" CHECK ("goods_receipt_line_rates"."unit_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"po_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"stock_qty" numeric(12, 3) NOT NULL,
	"is_serial_tracked" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "goods_receipt_lines_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "goods_receipt_lines_receipt_po_line_unique" UNIQUE("receipt_id","po_line_id"),
	CONSTRAINT "goods_receipt_lines_qty_check" CHECK ("goods_receipt_lines"."qty" > 0 and "goods_receipt_lines"."stock_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"grn_no" text NOT NULL,
	"po_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"state" text DEFAULT 'posted' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"received_by" uuid NOT NULL,
	"vendor_invoice_no" text,
	"vendor_invoice_date" date,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "goods_receipts_entity_no_unique" UNIQUE("entity_id","grn_no"),
	CONSTRAINT "goods_receipts_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "goods_receipts_state_check" CHECK ("goods_receipts"."state" in ('posted', 'reversed')),
	CONSTRAINT "goods_receipts_reversed_check" CHECK (("goods_receipts"."state" = 'reversed') = ("goods_receipts"."reversed_at" is not null)
          and ("goods_receipts"."reversed_at" is null) = ("goods_receipts"."reversed_by" is null)
          and ("goods_receipts"."reversed_at" is null) = ("goods_receipts"."reverse_reason" is null)
          and ("goods_receipts"."reverse_reason" is null or char_length("goods_receipts"."reverse_reason") between 1 and 300)),
	CONSTRAINT "goods_receipts_invoice_check" CHECK ("goods_receipts"."vendor_invoice_no" is null or char_length("goods_receipts"."vendor_invoice_no") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "po_line_rates" (
	"po_line_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"unit_rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "po_line_rates_rate_check" CHECK ("po_line_rates"."unit_rate" > 0),
	CONSTRAINT "po_line_rates_amount_check" CHECK ("po_line_rates"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"purchase_unit" text NOT NULL,
	"unit_factor" numeric(12, 3) NOT NULL,
	"qty_received" numeric(12, 3) DEFAULT '0' NOT NULL,
	"hsn" text NOT NULL,
	"tax_rate_id" uuid,
	"tax_rate_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "po_lines_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "po_lines_po_item_unique" UNIQUE("po_id","item_id"),
	CONSTRAINT "po_lines_po_line_no_unique" UNIQUE("po_id","line_no"),
	CONSTRAINT "po_lines_line_no_check" CHECK ("po_lines"."line_no" between 1 and 200),
	CONSTRAINT "po_lines_qty_check" CHECK ("po_lines"."qty" > 0),
	CONSTRAINT "po_lines_factor_check" CHECK ("po_lines"."unit_factor" >= 1),
	CONSTRAINT "po_lines_received_check" CHECK ("po_lines"."qty_received" >= 0 and "po_lines"."qty_received" <= "po_lines"."qty"),
	CONSTRAINT "po_lines_hsn_check" CHECK ("po_lines"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
	CONSTRAINT "po_lines_tax_rate_check" CHECK (("po_lines"."tax_rate_id" is null) = ("po_lines"."tax_rate_pct" is null)
          and ("po_lines"."tax_rate_pct" is null or "po_lines"."tax_rate_pct" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"po_no" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"deliver_to_warehouse_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"expected_at" date,
	"drafted_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_via" text,
	"cancel_reason" text,
	"close_reason" text,
	"vendor_state_code" text,
	"place_of_supply_state_code" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "purchase_orders_entity_no_unique" UNIQUE("entity_id","po_no"),
	CONSTRAINT "purchase_orders_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "purchase_orders_state_check" CHECK ("purchase_orders"."state" in ('draft', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled')),
	CONSTRAINT "purchase_orders_source_check" CHECK ("purchase_orders"."source" in ('manual', 'reorder')),
	CONSTRAINT "purchase_orders_sent_via_check" CHECK ("purchase_orders"."sent_via" is null or "purchase_orders"."sent_via" in ('email', 'by_hand')),
	CONSTRAINT "purchase_orders_approved_check" CHECK (("purchase_orders"."approved_by" is null) = ("purchase_orders"."approved_at" is null)
          and ("purchase_orders"."state" in ('draft') or "purchase_orders"."state" = 'cancelled' or "purchase_orders"."approved_at" is not null)),
	CONSTRAINT "purchase_orders_sent_check" CHECK (("purchase_orders"."sent_at" is null) = ("purchase_orders"."sent_via" is null)
          and ("purchase_orders"."state" not in ('sent', 'partially_received', 'received') or "purchase_orders"."sent_at" is not null)),
	CONSTRAINT "purchase_orders_cancel_check" CHECK (("purchase_orders"."state" = 'cancelled') = ("purchase_orders"."cancel_reason" is not null)
          and ("purchase_orders"."cancel_reason" is null or char_length("purchase_orders"."cancel_reason") between 1 and 300)),
	CONSTRAINT "purchase_orders_close_check" CHECK (("purchase_orders"."close_reason" is null or "purchase_orders"."state" = 'closed')
          and ("purchase_orders"."close_reason" is null or char_length("purchase_orders"."close_reason") between 1 and 300)),
	CONSTRAINT "purchase_orders_state_codes_check" CHECK (("purchase_orders"."vendor_state_code" is null or "purchase_orders"."vendor_state_code" ~ '^[0-9]{2}$')
          and "purchase_orders"."place_of_supply_state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "purchase_orders_notes_check" CHECK ("purchase_orders"."notes" is null or char_length("purchase_orders"."notes") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "reorder_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"reorder_level" numeric(12, 3) NOT NULL,
	"reorder_qty" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "reorder_rules_entity_item_hub_unique" UNIQUE("entity_id","item_id","warehouse_id"),
	CONSTRAINT "reorder_rules_level_check" CHECK ("reorder_rules"."reorder_level" >= 0),
	CONSTRAINT "reorder_rules_qty_check" CHECK ("reorder_rules"."reorder_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_doc_type_check";--> statement-breakpoint
ALTER TABLE "goods_receipt_line_rates" ADD CONSTRAINT "goods_receipt_line_rates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line_rates" ADD CONSTRAINT "goods_receipt_line_rates_line_fk" FOREIGN KEY ("receipt_line_id","entity_id") REFERENCES "public"."goods_receipt_lines"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_fk" FOREIGN KEY ("receipt_id","entity_id") REFERENCES "public"."goods_receipts"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_fk" FOREIGN KEY ("po_line_id","entity_id") REFERENCES "public"."po_lines"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_principals_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reversed_by_principals_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_fk" FOREIGN KEY ("po_id","entity_id") REFERENCES "public"."purchase_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_rates" ADD CONSTRAINT "po_line_rates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_rates" ADD CONSTRAINT "po_line_rates_quote_id_vendor_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."vendor_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_rates" ADD CONSTRAINT "po_line_rates_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_rates" ADD CONSTRAINT "po_line_rates_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_rates" ADD CONSTRAINT "po_line_rates_line_fk" FOREIGN KEY ("po_line_id","entity_id") REFERENCES "public"."po_lines"("id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_fk" FOREIGN KEY ("po_id","entity_id") REFERENCES "public"."purchase_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_deliver_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("deliver_to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_drafted_by_principals_id_fk" FOREIGN KEY ("drafted_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_principals_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_po_line_idx" ON "goods_receipt_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_item_idx" ON "goods_receipt_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_bin_idx" ON "goods_receipt_lines" USING btree ("bin_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_entity_received_idx" ON "goods_receipts" USING btree ("entity_id","received_at","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_warehouse_idx" ON "goods_receipts" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "po_line_rates_quote_idx" ON "po_line_rates" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "po_lines_item_idx" ON "po_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_entity_state_idx" ON "purchase_orders" USING btree ("entity_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "purchase_orders_vendor_idx" ON "purchase_orders" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_warehouse_idx" ON "purchase_orders" USING btree ("deliver_to_warehouse_id");--> statement-breakpoint
CREATE INDEX "reorder_rules_item_idx" ON "reorder_rules" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "reorder_rules_warehouse_idx" ON "reorder_rules" USING btree ("warehouse_id");--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serials_receipt_line_idx" ON "serials" USING btree ("receipt_line_id") WHERE "serials"."receipt_line_id" is not null;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_doc_type_check" CHECK ("document_sequences"."doc_type" in ('quote', 'sales_order', 'proforma', 'challan', 'purchase_order', 'goods_receipt')) NOT VALID;