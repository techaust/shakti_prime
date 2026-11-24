CREATE TABLE "bins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"pair_a_warehouse_id" uuid,
	"pair_b_warehouse_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "bins_id_warehouse_unique" UNIQUE("id","warehouse_id"),
	CONSTRAINT "bins_kind_check" CHECK ("bins"."kind" in ('storage', 'receiving', 'dispatch', 'quarantine', 'surplus', 'transit')),
	CONSTRAINT "bins_code_check" CHECK ("bins"."code" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,40}$'),
	CONSTRAINT "bins_pair_check" CHECK (("bins"."kind" = 'transit') = ("bins"."pair_a_warehouse_id" is not null and "bins"."pair_b_warehouse_id" is not null)
          and ("bins"."pair_a_warehouse_id" is null or "bins"."pair_a_warehouse_id" < "bins"."pair_b_warehouse_id"))
);
--> statement-breakpoint
CREATE TABLE "serials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_no" text NOT NULL,
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bin_id" uuid,
	"account_id" uuid,
	"site_id" uuid,
	"vendor_id" uuid,
	"receipt_line_id" uuid,
	"delivered_at" timestamp with time zone,
	"warranty_until" date,
	"supplier_warranty_until" date,
	"dcr_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "serials_id_entity_item_unique" UNIQUE("id","entity_id","item_id"),
	CONSTRAINT "serials_state_check" CHECK ("serials"."state" in ('in_stock', 'reserved', 'picked', 'in_transit', 'with_customer', 'faulty', 'with_supplier', 'scrapped')),
	CONSTRAINT "serials_serial_no_check" CHECK ("serials"."serial_no" = btrim("serials"."serial_no") and char_length("serials"."serial_no") between 1 and 100),
	CONSTRAINT "serials_bin_check" CHECK (("serials"."state" in ('in_stock', 'reserved', 'picked', 'faulty') and "serials"."bin_id" is not null)
          or ("serials"."state" in ('with_customer', 'with_supplier', 'scrapped') and "serials"."bin_id" is null)
          or "serials"."state" = 'in_transit')
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"bin_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_on_hand" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_reserved" numeric(12, 3) DEFAULT '0' NOT NULL,
	"last_moved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_key_unique" UNIQUE("entity_id","warehouse_id","bin_id","item_id"),
	CONSTRAINT "stock_balances_on_hand_check" CHECK ("stock_balances"."qty_on_hand" >= 0),
	CONSTRAINT "stock_balances_reserved_check" CHECK ("stock_balances"."qty_reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movement_costs" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_costs_unit_cost_check" CHECK ("stock_movement_costs"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"serial_id" uuid,
	"from_bin_id" uuid,
	"to_bin_id" uuid,
	"qty" numeric(12, 3) NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"reverses_id" uuid,
	"note" text,
	"batch_id" uuid NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_by" uuid NOT NULL,
	"request_id" text,
	CONSTRAINT "stock_movements_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "stock_movements_qty_check" CHECK ("stock_movements"."qty" > 0),
	CONSTRAINT "stock_movements_bins_check" CHECK (("stock_movements"."from_bin_id" is not null or "stock_movements"."to_bin_id" is not null)
          and "stock_movements"."from_bin_id" is distinct from "stock_movements"."to_bin_id"),
	CONSTRAINT "stock_movements_serial_qty_check" CHECK ("stock_movements"."serial_id" is null or "stock_movements"."qty" = 1),
	CONSTRAINT "stock_movements_reason_check" CHECK ("stock_movements"."reason" in ('opening', 'receipt', 'transfer', 'pick', 'issue', 'return_customer', 'return_supplier', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'warranty_replacement', 'surplus_in', 'surplus_out', 'reversal')),
	CONSTRAINT "stock_movements_reversal_check" CHECK (("stock_movements"."reason" = 'reversal') = ("stock_movements"."reverses_id" is not null)),
	CONSTRAINT "stock_movements_ref_check" CHECK (("stock_movements"."ref_type" is null) = ("stock_movements"."ref_id" is null)),
	CONSTRAINT "stock_movements_note_check" CHECK ("stock_movements"."note" is null or char_length("stock_movements"."note") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"address" text,
	"state_code" text,
	"pin_code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "warehouses_kind_check" CHECK ("warehouses"."kind" in ('godown', 'factory', 'transit')),
	CONSTRAINT "warehouses_code_check" CHECK ("warehouses"."code" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,19}$'),
	CONSTRAINT "warehouses_state_code_check" CHECK ("warehouses"."state_code" is null or "warehouses"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "warehouses_pin_code_check" CHECK ("warehouses"."pin_code" is null or "warehouses"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "warehouses_site_check" CHECK ("warehouses"."kind" = 'transit' or ("warehouses"."state_code" is not null and "warehouses"."pin_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "import_mapping_templates" DROP CONSTRAINT "import_mapping_templates_kind_check";--> statement-breakpoint
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_created_type_check";--> statement-breakpoint
ALTER TABLE "item_costs" ADD COLUMN "last_positive_avg_cost" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_pair_a_warehouse_id_warehouses_id_fk" FOREIGN KEY ("pair_a_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_pair_b_warehouse_id_warehouses_id_fk" FOREIGN KEY ("pair_b_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serials" ADD CONSTRAINT "serials_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_bin_fk" FOREIGN KEY ("bin_id","warehouse_id") REFERENCES "public"."bins"("id","warehouse_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_costs" ADD CONSTRAINT "stock_movement_costs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_costs" ADD CONSTRAINT "stock_movement_costs_movement_fk" FOREIGN KEY ("movement_id","entity_id") REFERENCES "public"."stock_movements"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_bin_id_bins_id_fk" FOREIGN KEY ("from_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_bin_id_bins_id_fk" FOREIGN KEY ("to_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reverses_id_stock_movements_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_moved_by_principals_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_serial_fk" FOREIGN KEY ("serial_id","entity_id","item_id") REFERENCES "public"."serials"("id","entity_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bins_warehouse_code_unique" ON "bins" USING btree ("warehouse_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "bins_warehouse_kind_unique" ON "bins" USING btree ("warehouse_id","kind") WHERE "bins"."kind" in ('receiving', 'dispatch') and "bins"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bins_pair_unique" ON "bins" USING btree ("warehouse_id","pair_a_warehouse_id","pair_b_warehouse_id") WHERE "bins"."kind" = 'transit';--> statement-breakpoint
CREATE UNIQUE INDEX "serials_item_serial_no_unique" ON "serials" USING btree ("item_id",lower("serial_no"));--> statement-breakpoint
CREATE INDEX "serials_entity_item_idx" ON "serials" USING btree ("entity_id","item_id");--> statement-breakpoint
CREATE INDEX "serials_bin_idx" ON "serials" USING btree ("bin_id") WHERE "serials"."bin_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_balances_entity_item_idx" ON "stock_balances" USING btree ("entity_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_balances_bin_idx" ON "stock_balances" USING btree ("bin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_reverses_unique" ON "stock_movements" USING btree ("reverses_id") WHERE "stock_movements"."reverses_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_card_idx" ON "stock_movements" USING btree ("entity_id","item_id","moved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movements_from_bin_idx" ON "stock_movements" USING btree ("from_bin_id","moved_at" DESC NULLS LAST) WHERE "stock_movements"."from_bin_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_to_bin_idx" ON "stock_movements" USING btree ("to_bin_id","moved_at" DESC NULLS LAST) WHERE "stock_movements"."to_bin_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_serial_idx" ON "stock_movements" USING btree ("serial_id","moved_at" DESC NULLS LAST) WHERE "stock_movements"."serial_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id") WHERE "stock_movements"."ref_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_batch_idx" ON "stock_movements" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stock_movements_opening_idx" ON "stock_movements" USING btree ("entity_id") WHERE "stock_movements"."reason" = 'opening';--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_code_unique" ON "warehouses" USING btree (lower("code"));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters', 'opening_stock')) NOT VALID;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_kind_check" CHECK ("import_mapping_templates"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters', 'opening_stock')) NOT VALID;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity', 'account', 'account_link', 'pin_code', 'item', 'stock_movement')) NOT VALID;